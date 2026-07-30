# Kitana SDK

Open-source TypeScript SDK for using AI subscriptions programmatically, without API keys.

## What is this

Instead of paying for API tokens — use subscriptions you already pay for (Claude Max, ChatGPT Plus, Gemini) programmatically through their CLI tools.

**Real savings:** $5/day on API calls vs $0 through a Claude CLI subscription.

## Three killer features

**1. Routing without API keys**
Claude Max subscription → `claude -p` → response. No keys, no tokens.

**2. Security layer**
Kitana sits between the client and the model. Filters prompt injection, rate limiting, model whitelisting.

**3. Project Bible**
Persistent context for agentic pipelines. An agent crashes at step 2 — restart from step 2, not from scratch. The model switches — context gets compressed and carried forward.

## Two products

`@kitana-sdk` — an npm package for developers. Embedded into their own products.

**Kitana App** — a native desktop app (Electron + Next.js). macOS / Windows / Linux. A UI wrapped around the terminal tools with all the SDK's features.

## Packages

| Package | What it does | Status |
|---------|---------------|--------|
| [`@kitana-sdk/server`](https://www.npmjs.com/package/@kitana-sdk/server) | OpenAI-compatible HTTP server | published |
| [`@kitana-sdk/core`](https://www.npmjs.com/package/@kitana-sdk/core) | detector, router, Vercel AI SDK adapter | published |
| [`@kitana-sdk/bible`](https://www.npmjs.com/package/@kitana-sdk/bible) | project Bible, compressor | published |
| `@kitana-sdk/tracker` | OTel middleware, cost calculator | not implemented yet |
| `@kitana-sdk/cli` | `kitana doctor`, `kitana report` | not implemented yet |

**Dependency graph:** `server` depends on `core`. `bible` also depends on `core`, but is otherwise standalone — installing `server` does **not** pull in `bible`. Install `bible` separately if you're building an agentic pipeline that needs persistent context; skip it if you just want an HTTP endpoint.

### Which package do I actually need?

**"I just want to point n8n / OpenClaw / any OpenAI-compatible tool at my Claude subscription"** → install only `@kitana-sdk/server`.

```bash
npx @kitana-sdk/server
# listens on http://localhost:4141
# first run: auto-installs the Claude CLI if missing, prompts `claude auth login` if not signed in
```

```bash
curl -X POST http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"say PONG"}]}'
```

Point any OpenAI-compatible client at `http://localhost:4141/v1` — see `integrations.md` for verified n8n and OpenClaw configs.

**"I'm building my own tool/agent in TypeScript and want the router + failover logic directly, without an HTTP layer"** → install `@kitana-sdk/core`.

```bash
npm install @kitana-sdk/core
```
```typescript
import { createRouter, detect } from '@kitana-sdk/core'

const router = createRouter({ chain: ['claude', 'ollama', 'api-key'] })
const result = await router.complete({ messages: [{ role: 'user', content: 'Hello' }] })
```

**"I'm building a multi-step agentic pipeline and need it to survive crashes / model switches"** → install `@kitana-sdk/bible` (in addition to `@kitana-sdk/core`, which it depends on).

```bash
npm install @kitana-sdk/bible
```
```typescript
import { Bible } from '@kitana-sdk/bible'

const bible = new Bible({ path: '.kitana' })
const context = await bible.read()       // what's already been done
await bible.update({ step: 'analyst', stepIndex: 1, result: {...}, tokensUsed: 1500, provider: 'claude-sonnet-4-6' })
```

See each package's own README for full API details, and `bible.md` in this repo for the design rationale.

## Integrations

- **n8n** — HTTP node → localhost:4141 → Kitana → Claude
- **OpenClaw** — custom provider via openclaw.json
- **VSCode Extension** — via MCP or an OpenAI-compatible endpoint
- **MCP Server** — any MCP-compatible client

## Stack

- TypeScript everywhere
- pnpm workspaces + Turborepo
- Vercel AI SDK compatible
- Electron + Next.js (desktop app)
- SQLite + drizzle-orm (desktop)
- OpenTelemetry (observability)

## Status

- Stage 0 (POC) — done
- Stage 1 (`@kitana-sdk/server`, minimal HTTP server) — done, verified end-to-end with n8n
- Stage 3 (`@kitana-sdk/core`, router + failover + streaming) — done
- Stage 4 (`@kitana-sdk/bible`, persistent pipeline context) — done
- Stage 5 (OpenClaw integration) — done, verified against a real OpenClaw install
- Stage 2 (ngrok + security), Stage 6 (tracker + CLI), Stage 7 (desktop app) — not started yet

See `roadmap.md` for the full stage breakdown and current priority order.

## Documentation

- `architecture.md` — all packages, monorepo structure
- `stage-1.md` — the original Stage 1 task spec
- `providers.md` — claude -p, ollama, formats
- `bible.md` — the project Bible
- `integrations.md` — n8n, OpenClaw, MCP
- `roadmap.md` — stages and priorities
