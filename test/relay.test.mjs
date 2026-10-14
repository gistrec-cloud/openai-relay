import { test } from "node:test";
import assert from "node:assert/strict";
import { invoke } from "./harness.mjs";

const { handler } = await import("../index.mjs");

test("rejects requests without a valid relay token", async () => {
  assert.equal((await invoke(handler, { path: "/v1/models" })).status, 403);
  const wrong = await invoke(handler, { headers: { "x-relay-token": "nope" }, path: "/v1/models" });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.upstream, undefined);
});

test("accepts RELAY_TOKEN and every token in RELAY_TOKENS", async () => {
  for (const token of ["legacy", "alpha", "beta"]) {
    const res = await invoke(handler, { headers: { "x-relay-token": token }, path: "/v1/models" });
    assert.equal(res.status, 200, token);
  }
});

test("normalizes the /v1 prefix and keeps the query string", async () => {
  const headers = { "x-relay-token": "alpha" };
  assert.equal((await invoke(handler, { headers, path: "/models" })).upstream.url, "https://api.openai.com/v1/models");
  const res = await invoke(handler, { headers, path: "/v1/files", query: "limit=1" });
  assert.equal(res.upstream.url, "https://api.openai.com/v1/files?limit=1");
});

test("forwards auth and openai-* headers, never the relay token", async () => {
  const res = await invoke(handler, {
    headers: { "x-relay-token": "alpha", authorization: "Bearer sk", "openai-beta": "x", cookie: "c" },
    path: "/v1/chat/completions",
    method: "POST",
    body: "{}",
  });
  assert.deepEqual(res.upstream.headers, { authorization: "Bearer sk", "openai-beta": "x" });
  assert.equal(res.upstream.body, "{}");
});

test("streams the upstream response without stale framing headers", async () => {
  const res = await invoke(handler, { headers: { "x-relay-token": "alpha" }, path: "/v1/models" });
  assert.equal(res.body, '{"ok":true}');
  assert.equal(res.headers["content-length"], undefined);
  assert.equal(res.headers["x-upstream"], "1");
});
