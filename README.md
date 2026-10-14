# openai-relay

A small AWS Lambda that forwards requests to the OpenAI API. Use it when your server can't reach `api.openai.com` directly, for example because OpenAI blocks the region it runs in.

The relay checks a shared token, passes the request through unchanged and streams the response back, so streaming completions and TTS keep working.

## How it works

```
your app ──► Lambda Function URL (allowed region) ──► api.openai.com
            x-relay-token: <token>
            Authorization: Bearer <your OpenAI key>
```

- Requests without a valid `x-relay-token` get `403`.
- Only `Authorization`, `Content-Type`, `Accept` and `OpenAI-*` headers go upstream. The relay token is never forwarded.
- The base URL works with or without `/v1`.
- The relay doesn't store or log request bodies.

## Deploy

1. Create a Lambda function:
   - runtime: Node.js 24 (`nodejs24.x`)
   - handler: `index.handler`
   - memory: 256 MB
   - timeout: 120 s
2. Upload the code:
   ```bash
   npm run package
   aws lambda update-function-code --function-name openai-relay --zip-file fileb://function.zip
   ```
3. Add a Function URL with auth type `NONE` and invoke mode `RESPONSE_STREAM`.
4. Set the tokens (see below).

## Tokens

| Variable | Meaning |
|---|---|
| `RELAY_TOKENS` | Comma-separated list of accepted tokens |
| `RELAY_TOKEN` | A single token, kept for older setups |

Give each client its own token. That way you can revoke one client by removing its token, and nobody else is affected. To generate a token:

```bash
openssl rand -hex 32
```

## Client setup

Point the OpenAI base URL at the Function URL and send the token in `x-relay-token`.

Python SDK:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://<id>.lambda-url.<region>.on.aws/v1",
    default_headers={"x-relay-token": RELAY_TOKEN},
)
```

Plain HTTP:

```bash
curl https://<id>.lambda-url.<region>.on.aws/v1/models \
  -H "x-relay-token: $RELAY_TOKEN" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

## Limits

- Requests are capped at **6 MB** by Lambda. Large images in base64 can exceed that, so downscale them before sending.
- Responses can be up to 200 MB when streamed.
- A request can't run longer than the function timeout.

## Security

The Function URL is public. Anyone who knows it can call it, but without a valid token they only get `403`. Keep the URL and the tokens out of public repos and logs.

## Development

```bash
npm test
```

Tests run against a mocked Lambda runtime and `fetch`, with no network calls.

## License

MIT
