# Roadmap

## Constraints

- One developer
- ~3 hours/day on average
- Claude Code helps write the code
- Start: late July 2026

---

## Current execution order (priorities revisited after Stage 1)

The stage numbering below stayed as originally assigned (for consistency with the content plan), but the **execution order** is:

1. Stage 1 — ✅ done
2. **Stage 3** — Router + Failover (core product value, killer feature #1) — ✅ done
3. Stage 5 — OpenClaw integration — ✅ done
4. Stage 4 — Project Bible — ✅ done
5. Stage 6 — Tracker + CLI — next
6. **Stage 2** — ngrok + Security (moved to the end — only critical once the server is actually exposed publicly; doesn't block anything for local use)
7. Stage 7 — Kitana App
8. Stage 8 — DocLaunch bundle (no timeline)

---

## Stages

### Stage 0 — POC ✅ DONE

Done:
- `claude -p "prompt" --output-format json` works programmatically
- `claude auth status` returns JSON with the subscription type
- CLI binary detection via `which` works
- HTTP ping of local servers (Ollama, LM Studio) works

---

### Stage 1 — Minimal HTTP server ✅ DONE
**Planned: 1 week**

Task: a minimal `@kitana-sdk/server`

Done:
- `POST /v1/chat/completions` → `claude -p` → OpenAI-format response
- `GET /health` — status
- `GET /v1/models` — model list (hardcoded)
- n8n connects and works (verified against a real n8n instance in Docker)

Out of scope for this stage:
- No streaming
- No auth
- No rate limiting
- Claude-only provider

**Milestone:** first video, "Claude without an API key in n8n in 15 minutes"

---

### Stage 2 — ngrok + Security
**Planned: 1 week**

Task: expose the server externally and secure it

To do:
- ngrok / Cloudflare Tunnel integration
- Rate limiting (requests per minute per IP)
- Basic prompt-injection filtering
- Model whitelist
- Request logging

**Milestone:** video, "Exposing a local AI to the internet safely"

---

### Stage 3 — Router + Failover ✅ DONE
**Planned: 2 weeks**

Task: the `@kitana-sdk/core` router

Done:
- Failover chain: Claude → Ollama → API key
- Transparent switching (the client doesn't know)
- Detects when a provider is unavailable
- Logs every switch
- Baseline `detect()` API
- Real streaming (`claude -p --output-format stream-json`), wired into the server as OpenAI-compatible SSE

**Milestone:** video, "My AI switches models on its own when one goes down"

---

### Stage 4 — Project Bible ✅ DONE
**Planned: 3 weeks**

Task: `@kitana-sdk/bible`

Done:
- `.kitana/bible/` on-disk structure
- `Bible.read()` and `Bible.update()`
- `progress.md` auto-updates
- `snapshots/` result storage
- `compressor.ts` — compression on failover
- Router integration via an `onProviderSwitch` hook (compressed context handed to the next provider through each provider's real system-prompt channel, not embedded prompt text — see `bible.md`)
- Vitest test suite (15 tests) across all packages

**Milestone:** video, "Why AI agents forget everything, and how to fix it"

---

### Stage 5 — OpenClaw integration ✅ DONE

Task: Kitana as a custom provider in OpenClaw

Done:
- Installed OpenClaw (`npm install -g openclaw`), requires Node 22.22.3+/24.x — had to upgrade Node via nvm-windows (blocked by a separate, unmanaged Node install at `C:\Program Files\nodejs`, had to be removed manually via Windows Settings)
- Added a `kitana` provider to `~/.openclaw/openclaw.json` (`models.providers.kitana`, `api: "openai-completions"`, `baseUrl: "http://localhost:4141/v1"`) alongside the existing `ollama` one, without changing the default model
- The real config schema turned out slightly different from the draft in integrations.md (`"api": "openai-completions"`, not `"openai"`; needs a full `models[]` with cost/contextWindow/maxTokens) — integrations.md has been updated
- `openclaw config validate` — config is valid
- Real test: `openclaw agent --local --model kitana/auto --message "say PONG"` → `"text":"PONG"`, `winnerProvider:"kitana"`, `fallbackUsed:false`, correctly handled OpenClaw's full system prompt (~26KB: AGENTS.md/SOUL.md/tools/skills)

Bug found and fixed (surfaced by real load from OpenClaw): a large system prompt (~26KB) passed as a positional CLI argument triggered `"Claude CLI error: The command line is too long."` on Windows — this demonstrated exactly why the stdin fix from Stage 4 was needed, not a new bug (the running server happened to still be on the old, pre-fix branch at test time — after switching to the right branch and restarting the server, everything worked)

**Milestone:** video, "OpenClaw + Kitana — set up in 20 minutes"

---

### Stage 6 — Tracker + CLI
**Planned: 2 weeks**

Task: `@kitana-sdk/tracker` and `@kitana-sdk/cli`

To do:
- Log every request to `.kitana/usage.jsonl`
- Calculate real savings
- `kitana doctor` — nice terminal output
- `kitana report` — a per-provider table
- `kitana report --watch` — live mode

**Milestone:** video, "How much I saved this month — real numbers"

---

### Stage 7 — Kitana App v0.1
**Planned: after MVP**

Task: an Electron + Next.js desktop app

To do:
- Electron shell around Next.js
- Terminal UI — an interface wrapped around the terminal tools
- Project Bible — visual editor
- Model Router UI — toggle providers on/off
- Cost Report — a savings dashboard
- macOS / Windows / Linux builds

---

### Stage 8 — DocLaunch bundle (idea, no timeline yet)

Task: package Kitana + n8n as a one-click Docker bundle, deployable through the sibling project **DocLaunch** (an App Store for Docker apps on the desktop — see its own `CLAUDE.md`).

Idea:
- `n8n` — fully containerized (already verified in Stage 1 — works via `host.docker.internal`)
- `kitana-server` — either containerized with a volume-mounted host `claude auth` session (realistic since DocLaunch runs locally on the user's own machine, not a remote server), or left as a native host process if mounting the config turns out to be fragile
- Result — a `.doclaunch` file/icon that spins up n8n + Kitana in one click, no terminal

Status: technically feasible (see prior discussion), but not scheduled — revisit once both projects (Kitana MVP and DocLaunch MVP) hit their own milestones.

---

## Summary

| Stage | Planned | Cumulative |
|-------|---------|-----------|
| 0 | done | done |
| 1 | 1 wk | 1 wk |
| 2 | 1 wk | 2 wk |
| 3 | 2 wk | 4 wk |
| 4 | 3 wk | 7 wk |
| 5 | 1 wk | 8 wk |
| 6 | 2 wk | 10 wk |
| 7 | TBD | after MVP |

**MVP target: ~mid-October 2026**

---

## Parallel content plan

Each stage = one video for Instagram/YouTube:

1. "Claude without an API key in n8n — $0 instead of $5/day"
2. "Exposing a local AI to the internet safely"
3. "AI switches models on its own when one goes down"
4. "Why AI agents forget everything after a restart"
5. "OpenClaw + your own model in 20 minutes"
6. "How much I saved this month — real numbers"

Plus a weekly "what I'm building" post — a dev diary.

---

## Monetization

**Short term (while building):**
- Content → audience → workshops for businesses
- n8n + Kitana workshop: "AI automation without API keys"

**After MVP:**
- `@kitana-sdk` — open source, free
- Kitana App — freemium or a one-time purchase
- Courses: "The vibe-coder SaaS stack" (DO + Supabase + n8n + Kitana + Stripe)
- Subscription agents built on Kitana infrastructure
