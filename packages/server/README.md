# @kitana-sdk/server

An OpenAI-compatible HTTP server backed by your Claude subscription, from [Kitana SDK](https://github.com/ataztech910/kitana). No API keys — it calls `claude -p` under the hood via [@kitana-sdk/core](https://www.npmjs.com/package/@kitana-sdk/core).

## Install

```bash
npm install @kitana-sdk/server
```

## Run

```bash
npx @kitana-sdk/server
# or, if installed as a dependency:
PORT=4141 kitana-server
```

On first run it auto-installs the Claude CLI if missing and prompts you to sign in (`claude auth login`).

## Endpoints

```
POST /v1/chat/completions   OpenAI-compatible chat completions (supports "stream": true)
GET  /v1/models             hardcoded model list
GET  /health                server + Claude CLI status
```

## Example

```bash
curl -X POST http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"say PONG"}]}'
```

Works as a drop-in provider for anything that speaks the OpenAI Chat Completions API — n8n, OpenClaw, Continue.dev, the Vercel AI SDK, etc. See [`integrations.md`](https://github.com/ataztech910/kitana/blob/master/integrations.md) in the main repo for verified setup guides.

## Requirements

- Node.js 18+
- Claude CLI subscription (Claude Max, Pro, Team, or Enterprise)

See the [main repo](https://github.com/ataztech910/kitana) for full documentation.
