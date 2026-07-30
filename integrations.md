# Integrations

## n8n

### Схема
```
n8n HTTP Request node
        ↓
http://localhost:4141/v1/chat/completions
        ↓
@kitana-sdk/server
        ↓
claude -p
```

### Настройка в n8n

HTTP Request node:
- Method: POST
- URL: `http://localhost:4141/v1/chat/completions`
- Headers: `Content-Type: application/json`
- Body:
```json
{
  "model": "auto",
  "messages": [
    { "role": "user", "content": "{{ $json.prompt }}" }
  ]
}
```

### Через ngrok (внешний доступ)

```bash
ngrok http 4141
# Получаем: https://abc123.ngrok.io
```

Используем ngrok URL вместо localhost — для внешних webhook, cron, n8n на другом сервере.

Для стабильного URL нужен платный план ngrok (~$10/мес) или Cloudflare Tunnel (бесплатно).

### Cloudflare Tunnel (альтернатива ngrok)

```bash
cloudflared tunnel --url http://localhost:4141
```

Бесплатно, стабильный URL, без ограничений на трафик.

---

## OpenClaw

### Схема

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

```json
{
  "models": {
    "providers": {
      "kitana": {
        "baseUrl": "http://localhost:4141",
        "apiKey": "local",
        "api": "openai",
        "models": [
          { "id": "auto", "name": "Kitana Auto" },
          { "id": "claude-sonnet-4-6", "name": "Claude Sonnet" }
        ]
      }
    }
  }
}
```

### Почему это легально

Anthropic заблокировал OAuth через браузер (что делал OpenClaw раньше). Kitana использует `claude -p` — официальный programmatic режим Claude Code CLI. Это разные механизмы. `claude -p` Anthropic не блокировал и вряд ли будет — это их собственный продукт для автоматизации.

### Security преимущество

Kitana как прослойка защищает от безумных инструкций которые OpenClaw может передавать:
- Фильтруем prompt injection
- Rate limiting — OpenClaw не сожжёт все лимиты подписки
- Whitelist моделей — OpenClaw не может запросить что попало

---

## VSCode Extension

Статус: later

Kitana сервер совместим с любым VSCode расширением которое поддерживает OpenAI-совместимый endpoint. Например Continue.dev:

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

Статус: later

Kitana может экспонироваться как MCP сервер для Claude Desktop и других MCP клиентов.

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

Прямая интеграция без HTTP сервера:

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

## Примеры use cases

### n8n + Kitana — автоматизация без API ключей

1. Пользователь платит $20/мес за Claude Max
2. Ставит Kitana сервер локально
3. n8n стучит в localhost:4141
4. Claude отвечает через подписку
5. API токены не тратятся

### OpenClaw + Kitana — безопасный локальный агент

1. OpenClaw использует Kitana как провайдер
2. Kitana фильтрует входящие запросы
3. Пользователь контролирует что проходит к модели

### Агентный пайплайн с Библией

1. Запускаем пайплайн из 5 агентов
2. Каждый агент читает и обновляет Библию
3. На шаге 3 Claude перегружен — failover на Ollama
4. Библия сжимается под контекст Ollama
5. Пайплайн продолжается без потери данных
