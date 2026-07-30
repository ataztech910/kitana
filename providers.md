# Providers

## Claude CLI

### What the POC proved

```bash
# Works programmatically
claude -p "reply with only PONG" --output-format json
```

Response:
```json
{
  "type": "result",
  "subtype": "success",
  "result": "PONG",
  "total_cost_usd": 0.0057084,
  "usage": {
    "input_tokens": 3,
    "output_tokens": 6,
    "cache_read_input_tokens": 16788
  },
  "modelUsage": {
    "claude-sonnet-4-6": {
      "inputTokens": 3,
      "outputTokens": 6,
      "costUSD": 0.0051354,
      "contextWindow": 200000
    }
  }
}
```

### Auth detection

```bash
claude auth status
```

Returns JSON:
```json
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "email": "user@example.com",
  "subscriptionType": "enterprise"
}
```

subscriptionType values: `"max"`, `"enterprise"`, `"pro"`, `null`

### Version detection

```bash
claude --version
# 2.1.195 (Claude Code)
```

### Available models

The Claude CLI doesn't return a model list dynamically. We hardcode the known ones:

```typescript
export const CLAUDE_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-5',
] as const

// Aliases accepted by the --model flag
export const CLAUDE_ALIASES = ['sonnet', 'opus', 'haiku', 'fable']
```

The real model that was actually used is read from `modelUsage` in the response.

### Flags

```bash
claude -p "prompt"                     # basic call
claude -p "prompt" --output-format json  # JSON response
claude -p "prompt" --model sonnet        # specific model
claude -p "prompt" --model claude-sonnet-4-6  # full name
claude -p "prompt" --max-budget-usd 0.01    # budget cap
```

### Important details

- `-p` = `--print` — non-interactive mode, required for programmatic calls
- Without `-p`, Claude opens an interactive session and the process never exits
- `--output-format json` returns full metadata including tokens and cost
- Recommended timeout: 30000ms (30s)
- exit code 143 = SIGTERM — the command doesn't exist, the CLI opened an interactive session and we killed it

### Invocation via child_process

**Important, learned the hard way (see Stage 4):** pass the prompt via **stdin**, not as a positional CLI argument. A multi-line prompt passed as a positional argument gets silently mangled on Windows — `cmd.exe` treats embedded newlines as command separators even inside quotes, truncating or emptying the argument. `claude -p` (with no positional prompt) reads the prompt from stdin — this is documented, supported CLI behavior, not a workaround.

```typescript
import { spawnSync } from 'child_process'

function callClaude(prompt: string, model?: string) {
  const args = ['-p', '--output-format', 'json']
  if (model && model !== 'auto') {
    args.push('--model', model)
  }

  const result = spawnSync('claude', args, {
    encoding: 'utf8',
    timeout: 30000,
    input: prompt
  })

  if (result.status !== 0 || result.signal) {
    throw new Error(`Claude error: ${result.stderr}`)
  }

  return JSON.parse(result.stdout)
}
```

On Windows, `spawnSync('claude', ...)` also needs `shell: true` to resolve the `.cmd` shim — see `@kitana-sdk/core/src/platform.ts` for the actual implementation, including safe argument quoting (only quote arguments that contain spaces/quotes, not the bare command name, which can otherwise break `cmd.exe`'s PATH resolution).

For a system prompt (e.g. compressed Bible context on failover), use `--append-system-prompt-file <path>` with a temp file instead of embedding it in the prompt text — see `bible.md` for why that distinction matters.

---

## Ollama

### Detection

```typescript
async function detectOllama() {
  // 1. Check the binary
  const binary = spawnSync('which', ['ollama'], { encoding: 'utf8' })
  const available = binary.status === 0

  // 2. Check whether the server is running
  let running = false
  let models: string[] = []

  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000)
    })
    if (res.ok) {
      running = true
      const data = await res.json()
      models = data.models.map((m: any) => m.name)
    }
  } catch {}

  return { available, running, models }
}
```

### Invocation

Ollama exposes an OpenAI-compatible server on port 11434.

```typescript
async function callOllama(messages: Message[], model: string) {
  const res = await fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages })
  })
  return res.json()
}
```

---

## Codex CLI (OpenAI)

Status: planned. OpenAI's equivalent of the Claude CLI.

```bash
codex -p "prompt"   # presumably
```

Detected via `which codex`. API format to be confirmed once added.

---

## Gemini CLI

Status: planned. Experimental.

```bash
gemini -p "prompt"  # presumably
```

---

## API Keys (fallback)

When every CLI provider is unavailable — fall back to the direct API.

```typescript
// Use the official SDKs as a fallback
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
```

This is the prod-mode path. For dev, we use the CLI providers.

---

## HTTP Servers

Ports we probe:

| Service | Port | Endpoint |
|---------|------|----------|
| Ollama | 11434 | GET /api/tags |
| LM Studio | 1234 | GET / |
| LocalAI | 8080 | GET / |
