# Stage 1 — Minimal HTTP server

*This is the original task spec, kept as a historical reference. The shipped implementation evolved beyond it — see `CHANGELOG.md` for what actually landed (stdin-based prompt passing, request validation, router integration in later stages, etc.).*

## Goal

Write a minimal version of `@kitana-sdk/server` that:
1. Listens on `POST /v1/chat/completions`
2. Accepts an OpenAI-format request
3. Calls `claude -p` via `child_process.spawnSync`
4. Returns the response in OpenAI format
5. Connects to n8n with no changes needed

## Success check

```bash
# Start it
npx ts-node packages/server/src/server.ts

# Test it
curl -X POST http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"say PONG"}]}'

# Expect an OpenAI-compatible response containing "PONG"
```

## Files to create

```
packages/server/
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── handlers/
│   │   └── completions.ts
│   └── providers/
│       └── claude.ts
├── package.json
└── tsconfig.json
```

## package.json

```json
{
  "name": "@kitana-sdk/server",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/server.ts"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "ts-node": "^10.9.0",
    "@types/node": "^20.0.0"
  }
}
```

## claude.ts — calling claude -p

```typescript
import { spawnSync } from 'child_process'

export interface ClaudeResponse {
  type: string
  result: string
  total_cost_usd: number
  usage: {
    input_tokens: number
    output_tokens: number
  }
  modelUsage: Record<string, {
    inputTokens: number
    outputTokens: number
    costUSD: number
  }>
}

export function callClaude(prompt: string, model?: string): ClaudeResponse {
  const args = ['-p', prompt, '--output-format', 'json']

  if (model && model !== 'auto') {
    args.push('--model', model)
  }

  const result = spawnSync('claude', args, {
    encoding: 'utf8',
    timeout: 30000
  })

  if (result.status !== 0) {
    throw new Error(`Claude CLI error: ${result.stderr}`)
  }

  return JSON.parse(result.stdout)
}
```

## completions.ts — handler

```typescript
import { IncomingMessage, ServerResponse } from 'http'
import { callClaude } from '../providers/claude'

interface OpenAIRequest {
  model: string
  messages: Array<{ role: string; content: string }>
}

export async function handleCompletions(
  req: IncomingMessage,
  res: ServerResponse
) {
  // Read the body
  const body = await readBody(req)
  const { model, messages } = JSON.parse(body) as OpenAIRequest

  // Build the prompt from messages
  const prompt = messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n')

  // Call Claude
  const claudeRes = callClaude(prompt, model)

  // Determine the model from the response
  const usedModel = claudeRes.modelUsage
    ? Object.keys(claudeRes.modelUsage).pop()
    : 'claude-sonnet-4-6'

  // Build the OpenAI-compatible response
  const response = {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: usedModel,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: claudeRes.result
      },
      finish_reason: 'stop'
    }],
    usage: {
      prompt_tokens: claudeRes.usage.input_tokens,
      completion_tokens: claudeRes.usage.output_tokens,
      total_tokens: claudeRes.usage.input_tokens + claudeRes.usage.output_tokens
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(response))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}
```

## server.ts — main file

```typescript
import { createServer } from 'http'
import { handleCompletions } from './handlers/completions'

const PORT = 4141

const server = createServer(async (req, res) => {
  const url = req.url || ''
  const method = req.method || ''

  // CORS for local development
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Routes
  if (method === 'POST' && url === '/v1/chat/completions') {
    await handleCompletions(req, res)
    return
  }

  if (method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', provider: 'claude' }))
    return
  }

  if (method === 'GET' && url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'auto', object: 'model' },
        { id: 'claude-sonnet-4-6', object: 'model' },
        { id: 'claude-haiku-4-5-20251001', object: 'model' }
      ]
    }))
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`Kitana server running on http://localhost:${PORT}`)
})
```

## Out of scope for Stage 1

- No streaming
- No auth/API key validation
- No rate limiting
- No providers besides Claude
- No error handling beyond the basics

All of this gets added in Stage 2 and 3.
