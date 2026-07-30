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

| Package | What it does |
|---------|---------------|
| `@kitana-sdk/core` | detector, router, Vercel AI SDK adapter |
| `@kitana-sdk/server` | OpenAI-compatible HTTP server |
| `@kitana-sdk/bible` | project Bible, compressor |
| `@kitana-sdk/tracker` | OTel middleware, cost calculator |
| `@kitana-sdk/cli` | `kitana doctor`, `kitana report` |

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
