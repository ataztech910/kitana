# Providers

## Claude CLI

### Что доказано POC

```bash
# Работает программно
claude -p "reply with only PONG" --output-format json
```

Ответ:
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

Возвращает JSON:
```json
{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "email": "user@example.com",
  "subscriptionType": "enterprise"
}
```

subscriptionType варианты: `"max"`, `"enterprise"`, `"pro"`, `null`

### Version detection

```bash
claude --version
# 2.1.195 (Claude Code)
```

### Доступные модели

Claude CLI не отдаёт список моделей динамически. Хардкодим известные:

```typescript
export const CLAUDE_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-5',
] as const

// Алиасы которые принимает --model флаг
export const CLAUDE_ALIASES = ['sonnet', 'opus', 'haiku', 'fable']
```

Реальную модель которая была использована берём из `modelUsage` в ответе.

### Флаги

```bash
claude -p "prompt"                     # базовый вызов
claude -p "prompt" --output-format json  # JSON ответ
claude -p "prompt" --model sonnet        # конкретная модель
claude -p "prompt" --model claude-sonnet-4-6  # полное имя
claude -p "prompt" --max-budget-usd 0.01    # лимит бюджета
```

### Важные детали

- `-p` = `--print` — non-interactive режим, обязателен для программного вызова
- Без `-p` Claude открывает интерактивную сессию, процесс не завершается
- `--output-format json` возвращает полную метаинформацию включая токены и стоимость
- Timeout рекомендуем 30000ms (30 сек)
- code 143 = SIGTERM — команда не существует, CLI открыл интерактивный режим и мы его убили

### Вызов через child_process

```typescript
import { spawnSync } from 'child_process'

function callClaude(prompt: string, model?: string) {
  const args = ['-p', prompt, '--output-format', 'json']
  if (model && model !== 'auto') {
    args.push('--model', model)
  }

  const result = spawnSync('claude', args, {
    encoding: 'utf8',
    timeout: 30000
  })

  if (result.status !== 0 || result.signal) {
    throw new Error(`Claude error: ${result.stderr}`)
  }

  return JSON.parse(result.stdout)
}
```

---

## Ollama

### Detection

```typescript
async function detectOllama() {
  // 1. Проверяем бинарник
  const binary = spawnSync('which', ['ollama'], { encoding: 'utf8' })
  const available = binary.status === 0

  // 2. Проверяем запущен ли сервер
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

### Вызов

Ollama поднимает OpenAI-совместимый сервер на порту 11434.

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

Статус: planned. Аналог Claude CLI от OpenAI.

```bash
codex -p "prompt"   # предположительно
```

Детектируем через `which codex`. API формат уточняем когда добавляем.

---

## Gemini CLI

Статус: planned. Экспериментально.

```bash
gemini -p "prompt"  # предположительно
```

---

## API Keys (fallback)

Когда все CLI провайдеры недоступны — fallback на прямой API.

```typescript
// Используем официальные SDK как fallback
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
```

Это prod режим. Для dev используем CLI провайдеры.

---

## HTTP Servers

Порты которые проверяем:

| Сервис | Порт | Endpoint |
|--------|------|----------|
| Ollama | 11434 | GET /api/tags |
| LM Studio | 1234 | GET / |
| LocalAI | 8080 | GET / |
