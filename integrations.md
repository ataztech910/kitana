# Integrations

## n8n

### Flow
```
n8n HTTP Request node
        ↓
http://localhost:4141/v1/chat/completions
        ↓
@kitana-sdk/server
        ↓
claude -p
```

### Setup in n8n

HTTP Request node:
- Method: POST
- URL: `http://localhost:4141/v1/chat/completions`
- Headers: `Content-Type: application/json`
- Body (must use raw/JSON mode, not the key-value "Body Parameters" builder — see note below):
```json
{
  "model": "auto",
  "messages": [
    { "role": "user", "content": "{{ $json.prompt }}" }
  ]
}
```

**Body mode gotcha (found during testing):** in n8n's HTTP Request node, the Body section must be switched to **raw JSON** mode with the object above pasted directly. If you instead add a field named `messages` under the key-value "Body Parameters" builder, n8n wraps your JSON as `{"messages": "<the whole JSON string>"}` — a string, not an array — and the server correctly rejects it with `400`.

**Running n8n in Docker:** if n8n runs in a container and Kitana runs on the host, use `http://host.docker.internal:4141/...` instead of `localhost` — the container can't otherwise reach the host's loopback interface. Verified working: `docker run -d --name kitana-n8n -p 5678:5678 -v kitana_n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n`.

### Via ngrok (external access)

```bash
ngrok http 4141
# Get: https://abc123.ngrok.io
```

Use the ngrok URL instead of localhost — for external webhooks, cron, or n8n running on another server.

A stable URL needs a paid ngrok plan (~$10/mo) or Cloudflare Tunnel (free).

### Cloudflare Tunnel (ngrok alternative)

```bash
cloudflared tunnel --url http://localhost:4141
```

Free, stable URL, no traffic limits.

---

## OpenClaw

### Flow

```
OpenClaw
    ↓
openclaw.json (kitana provider)
    ↓
http://localhost:4141
    ↓
@kitana-sdk/server
    ↓
claude -p
```

### openclaw.json

The real config schema (verified against a live OpenClaw 2026.7.1-2 install, `~/.openclaw/openclaw.json`). Differences from an earlier draft version: `"api"` is `"openai-completions"`, not `"openai"`; `baseUrl` includes `/v1`; each model needs full metadata (`cost`, `contextWindow`, `maxTokens`), otherwise defaults are applied.

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "kitana": {
        "api": "openai-completions",
        "apiKey": "local",
        "baseUrl": "http://localhost:4141/v1",
        "models": [
          {
            "id": "auto",
            "name": "Kitana Auto",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 8192
          },
          {
            "id": "claude-sonnet-4-6",
            "name": "Kitana Claude Sonnet",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

Verification (real test):
```bash
openclaw config validate
openclaw agent --local --model "kitana/auto" --session-key "agent:main:kitana-test" --message "say PONG" --json
```
Expect `"text":"PONG"`, `winnerProvider:"kitana"`, `fallbackUsed:false` in the response.

### Why this is legal

Anthropic blocked browser-based OAuth (which OpenClaw used to do). Kitana uses `claude -p` — the official programmatic mode of the Claude Code CLI. That's a different mechanism. Anthropic hasn't blocked `claude -p` and is unlikely to — it's their own product, built for automation.

### Security advantage

Kitana as a middle layer protects against reckless instructions OpenClaw might pass through:
- Filters prompt injection
- Rate limiting — OpenClaw can't burn through the whole subscription's limits
- Model whitelist — OpenClaw can't request just anything

---

## VSCode Extension

Status: later

The Kitana server is compatible with any VSCode extension that supports an OpenAI-compatible endpoint. For example, Continue.dev:

```json
// .continue/config.json
{
  "models": [{
    "title": "Kitana",
    "provider": "openai",
    "model": "auto",
    "apiBase": "http://localhost:4141/v1"
  }]
}
```

---

## MCP Server

Status: later

Kitana can be exposed as an MCP server for Claude Desktop and other MCP clients.

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "kitana": {
      "command": "npx",
      "args": ["kitana", "mcp"]
    }
  }
}
```

---

## Vercel AI SDK

Direct integration, no HTTP server needed:

```typescript
import { kitana } from '@kitana-sdk/core'
import { generateText, streamText } from 'ai'

// generateText
const { text } = await generateText({
  model: kitana('auto'),
  prompt: 'Hello'
})

// streamText
const { textStream } = await streamText({
  model: kitana('claude-sonnet-4-6'),
  messages: [{ role: 'user', content: 'Hello' }]
})
```

---

## Example use cases

### n8n + Kitana — automation without API keys

1. The user pays $20/mo for Claude Max
2. Runs the Kitana server locally
3. n8n calls localhost:4141
4. Claude responds through the subscription
5. No API tokens are spent

### OpenClaw + Kitana — a safe local agent

1. OpenClaw uses Kitana as a provider
2. Kitana filters incoming requests
3. The user controls what reaches the model

### Agentic pipeline with the Bible

1. Run a 5-agent pipeline
2. Each agent reads and updates the Bible
3. At step 3, Claude is overloaded — failover to Ollama
4. The Bible compresses to fit Ollama's context
5. The pipeline continues without losing data
