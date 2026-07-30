# Stage 1 — Минимальный HTTP сервер

## Цель

Написать `@kitana-sdk/server` минимальную версию которая:
1. Слушает `POST /v1/chat/completions`
2. Принимает OpenAI формат запроса
3. Вызывает `claude -p` через `child_process.spawnSync`
4. Возвращает ответ в OpenAI формате
5. Подключается к n8n без изменений

## Проверка успеха

```bash
# Запускаем
npx ts-node packages/server/src/server.ts

# Тестируем
curl -X POST http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"say PONG"}]}'

# Ожидаем OpenAI-совместимый ответ с "PONG"
```

## Файлы для создания

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

## claude.ts — вызов claude -p

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
  // Читаем body
  const body = await readBody(req)
  const { model, messages } = JSON.parse(body) as OpenAIRequest

  // Собираем prompt из messages
  const prompt = messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n')

  // Вызываем Claude
  const claudeRes = callClaude(prompt, model)

  // Определяем модель из ответа
  const usedModel = claudeRes.modelUsage
    ? Object.keys(claudeRes.modelUsage).pop()
    : 'claude-sonnet-4-6'

  // Формируем OpenAI-совместимый ответ
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

## server.ts — основной файл

```typescript
import { createServer } from 'http'
import { handleCompletions } from './handlers/completions'

const PORT = 4141

const server = createServer(async (req, res) => {
  const url = req.url || ''
  const method = req.method || ''

  // CORS для локальной разработки
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

## Что НЕ делаем в Stage 1

- Нет streaming
- Нет auth/api key validation
- Нет rate limiting
- Нет других провайдеров кроме Claude
- Нет error handling кроме базового

Всё это добавляется в Stage 2 и 3.
