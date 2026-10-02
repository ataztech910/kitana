# Changelog

## @kitana-sdk/adk 0.1.11

### Fixed

- **Tool calls with a missing closing brace are parsed instead of leaking as text.** Seen repeatedly with `claude -p`:
  `{"tool_call":{"name":"latency_agent","args":{"request":"…"}}` — two closing braces instead of three. The strict
  parser rejected it, the raw JSON came back as the agent's answer and the agent loop stopped (an orchestrator never
  called its second specialist). `parseToolCall` now retries an answer that *starts* like a tool call with up to three
  missing `}` appended; ordinary text, unknown tools and unterminated strings are still not treated as calls.
  Verified in next-observe's proactive investigation: 0/2 complete before, 2/2 after.

## @kitana-sdk/adk 0.1.10

### Fixed

- **0.1.8 and 0.1.9 were published with an unresolved `"@kitana-sdk/core": "workspace:^0.1.6"` dependency** and fail
  to install with npm (`Unsupported URL Type "workspace:"`). 0.1.10 has the same code as 0.1.9, published with
  `pnpm publish`, which rewrites `workspace:` ranges to real versions. Always publish from `packages/<name>` with
  `pnpm publish`, never `npm publish`.

### Deprecated

- **0.1.8, 0.1.9** — not installable with npm; use 0.1.10.

## @kitana-sdk/adk 0.1.9

### Fixed

- **Tool-calling prompt and history are English, and say what they are.** The text protocol used to be in Russian
  ("Доступные инструменты…", "Вызов инструмента…"), which made models answer in Russian. 0.1.8 translated it
  literally ("Available tools…"), and `claude -p` — an agent with native tools of its own — then looked the functions
  up in its own tool system, found nothing and answered "these tools are not available": specialist agents behind
  `AgentTool` stopped calling tools at all. 0.1.9 describes them as functions of a text protocol that are *not* the
  model's native tools, executed by the caller. Verified with a real Claude CLI: orchestrator + two specialists 3/3,
  single agent 2/2, English answers without any "answer in English" hint.
- Tests guard both: no Cyrillic in anything sent to the model, and the "not your native tools" wording.

### Deprecated

- **0.1.8** — use 0.1.9 (tool calls break with `claude -p`, see above).

## Stage 1 — Minimal HTTP server (@kitana-sdk/server)

### Added

- Monorepo scaffold: root `package.json` (pnpm workspaces), `pnpm-workspace.yaml`, `turbo.json`, root `tsconfig.json`
- `@kitana-sdk/server` package:
  - `POST /v1/chat/completions` — accepts OpenAI-format request, calls `claude -p`, returns OpenAI-format response
  - `GET /health` — server status, Claude CLI install/auth state, `runId`
  - `GET /v1/models` — hardcoded model list
  - CORS headers, `OPTIONS` handling
  - Configurable port via `PORT` env var (default 4141)
- `providers/claude.ts`:
  - `callClaude()` — spawns `claude -p --output-format json`
  - `checkClaudeInstalled()`, `checkClaudeAuth()` — environment detection
  - `ensureClaudeInstalled()` — auto-installs `@anthropic-ai/claude-code` via npm if missing
  - `ensureClaudeLoggedIn()` — auto-runs `claude auth login` if not authenticated
- Request logging in `completions.ts` (`[completions] request started/finished/failed` with duration) — stand-in for missing streaming, so the server's activity is visible while `claude -p` blocks

### Fixed

- **Windows**: `spawnSync('claude', ...)` without `shell` couldn't find the `.cmd` shim → added a `run()` helper that builds a properly quoted command-line string on Windows and uses `shell: true`
- **Windows**: naive `shell: true` with an args array split multi-word prompts into separate CLI arguments (e.g. "say PONG" → `-p say PONG`, dropping the actual prompt) → fixed by quoting each argument explicitly before building the command line
- Server crashed entirely on invalid/empty JSON body (e.g. malformed request from n8n) — `JSON.parse` and `messages.map()` ran outside any `try/catch` → added body validation (`400` on bad input) and a top-level `try/catch` around the request router (`500` instead of a crash)
- `EADDRINUSE` on port 4141 printed a raw stack trace → added a clear message pointing at `PORT=<other>` as a workaround

### Verified

- `curl` round-trip: `POST /v1/chat/completions` with `"say PONG"` → `"content":"PONG"` via real Claude CLI call (subscription: team)
- n8n (Docker) → `http://host.docker.internal:4141/v1/chat/completions` → correct response end-to-end

### Not in scope for this stage

- Streaming responses
- Request queue / concurrency control (BullMQ candidate for a later stage)
- Auth, rate limiting, other providers besides Claude

## Stage 3 — Router + Failover (@kitana-sdk/core)

### Added

- `@kitana-sdk/core` package: `detect()`, `createRouter()`, provider modules for Claude/Ollama/Anthropic-API/OpenAI-API
- `detect()` — environment detection (Claude install/auth/version, Ollama install/running/models, LM Studio ping)
- `createRouter({ chain, apiKeys })` — tries providers in order, falls back on failure, logs every switch
- API-key fallback provider supporting both Anthropic (`@anthropic-ai/sdk`) and OpenAI (`openai`) SDKs, chosen by whichever key is configured
- Real streaming: `streamClaude()` using `claude -p --output-format stream-json --include-partial-messages`, wired into `@kitana-sdk/server`'s `/v1/chat/completions` as OpenAI-compatible SSE when `stream: true`
- `@kitana-sdk/server` now delegates to `router.complete()` instead of calling Claude directly; duplicate provider code removed from `server`, now lives once in `core`

### Fixed

- Same Windows shell-quoting logic duplicated between `server` and the new `core` package — consolidated into `core/src/platform.ts` (`run()`, `spawnAsync()`, `isBinaryAvailable()`)
- Quoting the bare command name (e.g. `"claude"`) sometimes broke `cmd.exe`'s PATH resolution on Windows — now only arguments containing spaces/quotes are quoted, not the command itself

### Verified

- `detect()` correctly reports Claude (installed/logged in/subscription/version) and Ollama (installed/running) on a real machine
- Failover: chain `['ollama','claude']` with Ollama down correctly falls back and returns a real Claude response
- API-key fallback verified with both a missing-key graceful error and a real OpenAI key (revoked immediately after the test)
- Streaming verified via `curl -N` — multiple incremental SSE chunks, correct `finish_reason` and `[DONE]`

## Stage 4 — Bible (@kitana-sdk/bible)

### Added

- `@kitana-sdk/bible` package: `Bible` class (`read()`, `update()`, `getSnapshot()`, `compress()`), `progress.md`/`mission.md` formats, `compressor.ts`
- Compress strategies: `last-n` (mechanical, no model call), `facts-only` and `summary` (via `router.complete()`)
- `RouterConfig.onProviderSwitch` hook in `@kitana-sdk/core` — lets callers (like Bible) inject context on provider fallback, without `core` depending on `bible`
- Vitest test suite across all packages (`pnpm test`) — 15 tests covering formats round-trip, Bible persistence/recovery, router edge cases, and server request validation

### Fixed

- **Critical**: a multi-line prompt passed as a positional CLI argument to `claude -p` silently got mangled on Windows (`cmd.exe` treats embedded newlines as command separators even inside quotes) → `callClaude()`/`streamClaude()` now send the prompt via **stdin** instead of argv (confirmed as documented, supported CLI behavior, not a workaround)
- **Architectural**: the first `onProviderSwitch` implementation injected compressed context by prepending a fake `system:`-labeled block into the flattened prompt text — Claude correctly identified this as a prompt-injection attempt and refused to use it (the same defense Kitana's own security layer is meant to provide, working against Kitana itself). Fixed by passing context through each provider's real trusted channel instead: `--append-system-prompt-file` for the Claude CLI, the `system` field for the Anthropic/OpenAI SDKs, and a real `system`-role message for Ollama's OpenAI-compatible endpoint

### Verified

- Bible persistence across separate process instances (no shared in-memory state)
- Pipeline crash recovery: completed steps are never re-run, only the failed step retries
- `compress()` with `last-n` (mechanical) and `facts-only`/`summary` (real model call) — model call verified to correctly compress 3 steps into a dense fact summary
- Router + Bible integration: compressed context correctly delivered via system prompt and used by Claude to answer a fact-retrieval question correctly ("Купи слона")
- Full 3-agent pipeline (analyst → copywriter → reviewer) run end-to-end with real router calls, correct `progress.md`/snapshot output on disk

### Not in scope for this stage

- UI for the Bible (Stage 7, Kitana App)
- Automatic `mission.md` creation/editing — manual-only by contract
- Automated tests for real model-calling paths (`callClaude`, `streamClaude`, `facts-only`/`summary` compress) — require a live subscription/API key, verified manually instead and documented in `plan-stage-3.md`/`plan-stage-4.md`
