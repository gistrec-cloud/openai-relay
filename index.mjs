import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, timingSafeEqual } from "node:crypto";

const UPSTREAM = "https://api.openai.com";

const TOKENS = [process.env.RELAY_TOKEN, ...(process.env.RELAY_TOKENS || "").split(",")]
  .map((t) => (t || "").trim())
  .filter(Boolean)
  .map(sha256);

// fetch() has already decoded the body, so these upstream headers no longer
// describe what we stream back.
const STRIP = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function authorized(token) {
  if (!token) return false;
  const digest = sha256(token);
  let ok = false;
  for (const known of TOKENS) ok = timingSafeEqual(digest, known) || ok;
  return ok;
}

function forwarded(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (["authorization", "content-type", "accept"].includes(key) || key.startsWith("openai-")) {
      out[key] = value;
    }
  }
  return out;
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const headers = event.headers || {};
  if (!authorized(headers["x-relay-token"])) {
    const out = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 403,
      headers: { "content-type": "application/json" },
    });
    out.write(JSON.stringify({ error: "forbidden" }));
    out.end();
    return;
  }

  // Clients may or may not include /v1 in their base URL.
  const path = "/v1" + (event.rawPath || "/").replace(/^\/v1(?=\/|$)/, "");
  const qs = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const method = event.requestContext.http.method;
  const body =
    method === "GET" || method === "HEAD" || event.body == null
      ? undefined
      : event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body;

  const upstream = await fetch(`${UPSTREAM}${path}${qs}`, { method, headers: forwarded(headers), body });

  const respHeaders = {};
  upstream.headers.forEach((value, name) => {
    if (!STRIP.has(name.toLowerCase())) respHeaders[name] = value;
  });
  const out = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: upstream.status,
    headers: respHeaders,
  });
  if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), out);
  else out.end();
});
