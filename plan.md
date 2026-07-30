# Plan — Стадия 1: минимальный HTTP сервер

Цель стадии: `@kitana-sdk/server` принимает OpenAI-совместимый запрос, вызывает `claude -p`, отдаёт OpenAI-совместимый ответ. n8n подключается без проблем. Срок — 1 неделя.

Делаем маленькими шагами, каждый шаг — проверяемый результат перед переходом к следующему.

## Шаг 0 — каркас монорепо ✅

- [x] Корневой `package.json` (workspaces: `packages/*`, `apps/*`, scripts `build`/`dev` через turbo)
- [x] `pnpm-workspace.yaml`
- [x] `turbo.json`
- [x] Корневой `tsconfig.json` (base config, наследуется пакетами)
- [x] `.gitignore` (node_modules, dist, .kitana)

Проверка: `pnpm install` проходит без ошибок, структура каталогов создана.

## Шаг 1 — пакет `packages/server` — скелет ✅

- [x] `packages/server/package.json` (по образцу из stage-1.md)
- [x] `packages/server/tsconfig.json`
- [x] `packages/server/src/index.ts` (пустой экспорт-заглушка)

Проверка: `pnpm --filter @kitana-sdk/server build` компилируется.

## Шаг 2 — провайдер Claude ✅

- [x] `packages/server/src/providers/claude.ts` — `callClaude(prompt, model?)` через `spawnSync('claude', ['-p', ...])`
- [x] Обработка ошибок: ненулевой статус / сигнал → `throw`
- [x] `checkClaudeInstalled()` — детект бинарника (`where claude` на Windows / `which claude` на Unix) перед вызовом
- [x] Если не установлен — понятная ошибка/сообщение с инструкцией установки (ссылка на офиц. установку Claude Code CLI + `claude auth login` для входа в подписку), сервер не падает молча
- [ ] При старте сервера (Шаг 4) — одноразовая проверка `checkClaudeInstalled()` + `claude auth status`, лог в консоль: установлен/авторизован или нет

Проверка: на машине без `claude` в PATH — `callClaude()` даёт понятную ошибку с инструкцией (проверено — работает), а не невнятный crash. На машине с `claude` — проверить позже (CLI не установлен в текущей среде разработки).

## Шаг 3 — HTTP handler `/v1/chat/completions` ✅

- [x] `packages/server/src/handlers/completions.ts`
- [x] Парсинг OpenAI-формата запроса (`model`, `messages`)
- [x] Сборка prompt из messages
- [x] Вызов `callClaude` (с try/catch → 500 + понятная ошибка вместо краша сервера)
- [x] Формирование OpenAI-совместимого ответа (id, choices, usage)

Проверка: код компилируется (`tsc` — чисто). Полноценная проверка запрос/ответ — после Шага 4, когда появится сам `server.ts` со слушающим портом.

## Шаг 4 — HTTP сервер и остальные роуты ✅

- [x] `packages/server/src/server.ts` — `http.createServer`, роутинг
- [x] `GET /health` (плюс claudeInstalled/claudeLoggedIn/subscriptionType)
- [x] `GET /v1/models` (хардкод списка моделей)
- [x] CORS заголовки, обработка `OPTIONS`
- [x] Слушает порт 4141
- [x] При старте: если Claude CLI не найден — интерактивный вопрос в терминале (y/n) и автоустановка `npm install -g @anthropic-ai/claude-code` при согласии (`ensureClaudeInstalled()` в `providers/claude.ts`)

Проверка (нужно запустить руками — сервер интерактивный, спрашивает в терминале, фоновый запуск не подходит):
```bash
pnpm --filter @kitana-sdk/server dev
```
(запускать из корня репозитория). Затем в отдельном терминале:
```bash
curl http://localhost:4141/health
curl -X POST http://localhost:4141/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"say PONG"}]}'
```
Ожидаем ответ с `"PONG"` в OpenAI-формате (или понятную ошибку, если Claude не авторизован).

**Проверено и подтверждено ✅** — `curl` вернул `"content":"PONG"`, `runId` в `/health` меняется при каждом перезапуске (используется как доказательство свежего запуска).

Найденные и исправленные баги по пути:
- Windows: `spawnSync('claude', ...)` без shell не находит `.cmd`-бинарник → добавлен `shell: true` через свой `run()` helper
- Windows: при `shell: true` аргументы с пробелами разбивались на несколько CLI-аргументов → теперь строим одну command-line строку с явным квотированием каждого аргумента (`quoteArgWindows`)
- Порт 4141 иногда остаётся занят "осиротевшим" процессом → добавлен понятный `EADDRINUSE` месседж + настраиваемый `PORT`
- Auto-install Claude CLI (`npm install -g @anthropic-ai/claude-code`) и auto-login (`claude auth login`) при старте сервера, если не установлено/не авторизовано
- Невалидный/пустой JSON в `/v1/chat/completions` (например от n8n) крашил весь сервер (`messages.map` вне try/catch) → добавлена валидация тела запроса (400 вместо краша) + глобальный try/catch вокруг роутера в `server.ts` (500 вместо краша)

## Шаг 5 — проверка `/health` и `/v1/models` ✅

- [x] `curl http://localhost:4141/health` → `{"status":"ok","provider":"claude",...}` (подтверждено ранее в Шаге 4)
- [x] `curl http://localhost:4141/v1/models` → `{"object":"list","data":[{"id":"auto",...},{"id":"claude-sonnet-4-6",...},{"id":"claude-haiku-4-5-20251001",...}]}`

## Шаг 6 — интеграция с n8n ✅

- [x] n8n запущен в Docker (`docker run -d --name kitana-n8n -p 5678:5678 -v kitana_n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n`)
- [x] Настроен HTTP Request node на `http://host.docker.internal:4141/v1/chat/completions` (важно: не `localhost`, контейнер не видит хост так)
- [x] Прогнан реальный workflow — получен корректный ответ `"content":"PONG"`

**Стадия 1 полностью завершена и подтверждена.** Полный цикл: n8n → Kitana server → Claude CLI → ответ работает.

## На будущее (не в этой стадии)

- **Streaming** — переписать `callClaude`/handler на `spawn` (async) + SSE/chunked response вместо `spawnSync`. Нужно уточнить, поддерживает ли `claude -p` потоковый output-format.
  - Промежуточное решение (сделано, Шаг 4.5): пока нет стриминга — добавлено консольное логирование в `completions.ts` (`[completions] request started/finished/failed` с длительностью), чтобы видеть что сервер жив и обрабатывает запрос, а не завис молча.
- **Очередь запросов (BullMQ + Redis)** — сейчас `spawnSync` блокирует event loop, параллельные запросы просто выстраиваются последовательно без явной очереди. Если нагрузка вырастет (много запросов одновременно, retry, приоритеты) — подключить BullMQ. Требует Redis как зависимость, поэтому решать по факту необходимости, не сразу.
- Обе задачи логично разместить в Стадии 3 (Router + Failover) или отдельной подзадачей, когда появится реальная многопоточная нагрузка.

Проверка: n8n workflow успешно получает ответ от Claude через Kitana.

## Шаг 7 — привязка к npm (зарезервированным именам)

- [ ] Убедиться, что имена пакетов точно совпадают с зарезервированными на npm: `@kitana-sdk/cli`, `@kitana-sdk/server`, `@kitana-sdk/core`, `@kitana-sdk/bible`, `@kitana-sdk/tracker`
- [ ] В каждом `package.json`: `"publishConfig": { "access": "public" }` (scoped-пакеты по умолчанию приватные)
- [ ] Проверить `npm whoami` / что аккаунт залогинен и владеет scope `@kitana-sdk`
- [ ] Versioning: начинаем с `0.1.0`, дальше вручную/через changesets (решить позже)
- [ ] **Публикация (`npm publish`) — только по явному запросу пользователя**, отдельное подтверждение перед каждым релизом

Проверка: `npm view @kitana-sdk/server` (после первого публикейшена) отдаёт корректные метаданные.

## Явно НЕ делаем на этой стадии

- Streaming
- Auth / API key validation
- Rate limiting
- Другие провайдеры кроме Claude
- Продвинутый error handling

## После завершения

Milestone: видео "Claude без API ключа в n8n за 15 минут" (roadmap.md, Стадия 1).
Переход к Стадии 2 (ngrok + security) — отдельный план после ревью этой стадии.
