# Architecture

## Monorepo structure

```
kitana-sdk/
├── packages/
│   ├── core/          @kitana-sdk/core
│   ├── server/        @kitana-sdk/server
│   ├── bible/         @kitana-sdk/bible
│   ├── tracker/       @kitana-sdk/tracker
│   └── cli/           @kitana-sdk/cli
├── apps/
│   └── desktop/       Kitana App (Electron + Next.js)
├── package.json       pnpm workspaces root
├── pnpm-workspace.yaml
└── turbo.json
```

## Layers, top to bottom

```
Kitana App (Electron)
        ↓
Consumers (@kitana-sdk users: n8n, OpenClaw, VSCode, third-party devs)
        ↓
@kitana-sdk/server (OpenAI-compatible HTTP gateway)
        ↓
@kitana-sdk/core (detector + router + Vercel AI SDK adapter)
        ↓
Providers (Claude CLI, Ollama, Codex CLI, Gemini CLI, API keys)
        ↓
@kitana-sdk/bible (persistent pipeline context)
        ↓
@kitana-sdk/tracker (observability, cost tracking)
```

## @kitana-sdk/core

Three modules:

### detector
Scans the environment. What's installed, what's running, whether the user is authenticated.

```typescript
import { detect } from '@kitana-sdk/core'
const env = await detect()
```

Returns:
```typescript
{
  providers: {
    claude: {
      available: boolean
      path: string
      version: string
      auth: {
        loggedIn: boolean
        subscriptionType: 'max' | 'enterprise' | 'pro' | null
        email: string
      }
    }
    ollama: {
      available: boolean
      running: boolean
      models: string[]
    }
    openai: { available: boolean }
    gemini: { available: boolean }
    codex: { available: boolean }
  }
  httpServers: {
    ollama: { running: boolean, url: string }
    lmstudio: { running: boolean }
  }
}
```

How it detects:
- `which claude` / `where claude` (Windows)
- `claude auth status` → JSON on stdout
- `claude --version` → parse the version
- GET `http://localhost:11434/api/tags` → ollama + model list
- GET `http://localhost:1234` → LM Studio

### router

Failover chain across providers.

```typescript
import { createRouter } from '@kitana-sdk/core'

const router = createRouter({
  chain: ['claude', 'ollama', 'api-key'],
  apiKeys: {
    anthropic: process.env.ANTHROPIC_API_KEY
  }
})

const response = await router.complete({
  messages: [{ role: 'user', content: 'Hello' }],
  model: 'auto'
})
```

Logic:
1. Tries the first provider in the chain
2. On failure, moves to the next one
3. On switching to a weaker model, calls `bible.compress()`
4. Logs every switch

### Vercel AI SDK adapter

```typescript
import { kitana } from '@kitana-sdk/core'
import { generateText } from 'ai'

const result = await generateText({
  model: kitana('auto'),
  messages: [{ role: 'user', content: 'Hello' }]
})
```

Implements `LanguageModelV1` from the `ai` package. Zero migration — you only change the provider import.

## @kitana-sdk/server

OpenAI-compatible HTTP server on localhost.

```typescript
import { createServer } from '@kitana-sdk/server'

const server = createServer({
  port: 4141,
  security: {
    rateLimit: { requests: 100, window: '1m' },
    filterPromptInjection: true,
    allowedModels: ['auto', 'claude-sonnet-4-6']
  }
})

await server.start()
```

Endpoints:
```
POST /v1/chat/completions   main endpoint
GET  /v1/models              list of available models
GET  /health                 server and provider status
```

File structure:
```
packages/server/src/
├── index.ts
├── server.ts
├── handlers/
│   ├── completions.ts
│   ├── models.ts
│   └── health.ts
└── providers/
    └── claude.ts
```

## @kitana-sdk/bible

See `bible.md`

## @kitana-sdk/tracker

```typescript
import { createTracker } from '@kitana-sdk/tracker'

const tracker = createTracker({
  output: 'file',
  outputPath: '.kitana/usage.jsonl'
})
```

Each entry:
```json
{
  "timestamp": "2026-07-30T10:00:00Z",
  "provider": "claude",
  "model": "claude-sonnet-4-6",
  "inputTokens": 100,
  "outputTokens": 50,
  "actualCostUSD": 0,
  "wouldCostUSD": 0.00153,
  "savedUSD": 0.00153,
  "durationMs": 2300
}
```

## @kitana-sdk/cli

```bash
npx kitana doctor
npx kitana report
npx kitana report --watch
npx kitana serve
```

## Kitana App (Electron + Next.js)

```
apps/desktop/
├── electron/
│   ├── main.ts
│   └── preload.ts
├── renderer/          Next.js
│   ├── app/
│   │   ├── page.tsx
│   │   ├── bible/
│   │   ├── router/
│   │   └── report/
│   └── components/
└── package.json
```

## Monorepo setup

```bash
mkdir kitana-sdk && cd kitana-sdk

# root package.json
{
  "name": "kitana-sdk",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  }
}

# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'apps/*'
```
