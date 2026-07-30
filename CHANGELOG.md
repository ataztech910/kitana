# Changelog

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
