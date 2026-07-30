# Kitana SDK

Open-source TypeScript SDK для программного использования AI подписок без API ключей.

## Что это

Вместо того чтобы платить за API токены — используем уже оплаченные подписки (Claude Max, ChatGPT Plus, Gemini) программно через их CLI инструменты.

**Реальная экономия:** $5/день на API vs $0 через Claude CLI подписку.

## Три killer features

**1. Роутинг без API ключей**
Claude Max подписка → `claude -p` → ответ. Никаких ключей, никаких токенов.

**2. Security layer**
Kitana стоит между клиентом и моделью. Фильтрует prompt injection, rate limiting, whitelist моделей.

**3. Библия проекта**
Персистентный контекст агентного пайплайна. Агент упал на шаге 2 — перезапускаем с шага 2, не с начала. Модель переключилась — контекст сжимается и передаётся дальше.

## Два продукта

`@kitana-sdk` — npm пакет для разработчиков. Встраивают в свои продукты.

**Kitana App** — нативный десктоп (Electron + Next.js). macOS / Windows / Linux. Интерфейс вокруг терминалок со всеми фичами SDK.

## Пакеты

| Пакет | Что делает |
|-------|-----------|
| `@kitana-sdk/core` | detector, router, Vercel AI SDK adapter |
| `@kitana-sdk/server` | OpenAI-совместимый HTTP сервер |
| `@kitana-sdk/bible` | Библия проекта, compressor |
| `@kitana-sdk/tracker` | OTel middleware, cost calculator |
| `@kitana-sdk/cli` | `kitana doctor`, `kitana report` |

## Интеграции

- **n8n** — HTTP node → localhost:4141 → Kitana → Claude
- **OpenClaw** — кастомный провайдер через openclaw.json
- **VSCode Extension** — через MCP или OpenAI-совместимый endpoint
- **MCP Server** — любой MCP совместимый клиент

## Стек

- TypeScript везде
- pnpm workspaces + Turborepo
- Vercel AI SDK compatible
- Electron + Next.js (desktop app)
- SQLite + drizzle-orm (desktop)
- OpenTelemetry (observability)

## Статус

POC готов — `claude -p` работает программно, детекция CLI работает.
Сейчас: Стадия 1 — минимальный HTTP сервер.

## Документация

- `architecture.md` — все пакеты, структура монорепо
- `stage-1.md` — текущая задача
- `providers.md` — claude-p, ollama, форматы
- `bible.md` — Библия проекта
- `integrations.md` — n8n, OpenClaw, MCP
- `roadmap.md` — стадии и сроки
