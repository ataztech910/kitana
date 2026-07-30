# Architecture

## Монорепо структура

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

## Слои сверху вниз

```
Kitana App (Electron)
        ↓
Consumers (@kitana-sdk users: n8n, OpenClaw, VSCode, сторонние девы)
        ↓
@kitana-sdk/server (OpenAI-compatible HTTP gateway)
        ↓
@kitana-sdk/core (detector + router + Vercel AI SDK adapter)
        ↓
Providers (Claude CLI, Ollama, Codex CLI, Gemini CLI, API keys)
        ↓
@kitana-sdk/bible (персистентный контекст пайплайна)
        ↓
@kitana-sdk/tracker (observability, cost tracking)
```

## @kitana-sdk/core

Три модуля:

### detector
Сканирует окружение. Что установлено, что запущено, авторизован ли пользователь.

```typescript
import { detect } from '@kitana-sdk/core'
const env = await detect()
```

Возвращает:
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

Как детектит:
- `which claude` / `where claude` (Windows)
- `claude auth status` → JSON в stdout
- `claude --version` → парсим версию
- GET `http://localhost:11434/api/tags` → ollama + список моделей
- GET `http://localhost:1234` → LM Studio

### router

Failover chain между провайдерами.

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

Логика:
1. Пробует первый провайдер в chain
2. Если упал — переходит к следующему
3. Если переключился на более слабую модель — вызывает `bible.compress()`
4. Логирует каждое переключение

### Vercel AI SDK adapter

```typescript
import { kitana } from '@kitana-sdk/core'
import { generateText } from 'ai'

const result = await generateText({
  model: kitana('auto'),
  messages: [{ role: 'user', content: 'Hello' }]
})
```

Имплементирует `LanguageModelV1` из `ai` пакета. Zero migration — меняешь только импорт провайдера.

## @kitana-sdk/server

OpenAI-совместимый HTTP сервер на localhost.

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
POST /v1/chat/completions   основной endpoint
GET  /v1/models             список доступных моделей
GET  /health                статус сервера и провайдеров
```

Файловая структура:
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

См. `bible.md`

## @kitana-sdk/tracker

```typescript
import { createTracker } from '@kitana-sdk/tracker'

const tracker = createTracker({
  output: 'file',
  outputPath: '.kitana/usage.jsonl'
})
```

Каждая запись:
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

## Монорепо setup

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
