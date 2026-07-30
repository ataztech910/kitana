# Plan — Стадия 3: Router + Failover

Цель стадии: `@kitana-sdk/core` — failover chain между провайдерами (Claude → Ollama → API key), прозрачное для клиента переключение, `detect()` API. Срок — 2 недели.

Делаем маленькими шагами, каждый — проверяемый результат перед переходом к следующему.

## Шаг 0 — пакет `packages/core` — скелет ✅

- [x] `packages/core/package.json` (по образцу `packages/server`, имя `@kitana-sdk/core`, `publishConfig.access: public`)
- [x] `packages/core/tsconfig.json`
- [x] `packages/core/src/index.ts`
- [x] `packages/core/src/types.ts` — общие типы (`ProviderName`, `CompleteRequest`, `CompleteResponse`, `DetectResult`)

Проверка: `pnpm --filter @kitana-sdk/core build` компилируется.

## Шаг 1 — `detect()` — детекция окружения ✅

- [x] `packages/core/src/detector.ts`
- [x] Детект Claude (available/version/auth) — с Windows shell-квотированием
- [x] Детект Ollama: `which ollama` + `GET http://localhost:11434/api/tags`
- [x] Детект LM Studio: `GET http://localhost:1234`
- [x] Собрать в единый `detect()` возвращающий структуру из architecture.md (providers.claude/ollama/openai/gemini/codex + httpServers)

Проверка: подтверждено в реальном терминале пользователя — `claude.available: true`, `auth.loggedIn: true`, `subscriptionType: "team"`, версия и email корректны.

Найденный и исправленный баг: квотирование в кавычки самого имени команды (`"claude"` целиком) иногда мешает `cmd.exe` резолвить `.cmd`-бинарник через PATH → теперь квотируется только сама команда/аргументы, содержащие пробелы или кавычки, а не всё подряд (`quoteArgWindows` теперь условный).

## Шаг 2 — рефакторинг: провайдеры как общий модуль ✅

- [x] `packages/core/src/platform.ts` — общий `run()`/`isBinaryAvailable()` (Windows shell-фикс в одном месте вместо дублирования)
- [x] `packages/core/src/providers/claude.ts` — перенесена полная логика (`callClaude`, `ensureClaudeInstalled`, `ensureClaudeLoggedIn`)
- [x] `packages/core/src/providers/ollama.ts` — вызов через `http://localhost:11434/v1/chat/completions`
- [x] `@kitana-sdk/server` подключает `@kitana-sdk/core` как workspace-зависимость, дубликат `providers/claude.ts` удалён из server

Проверка: `@kitana-sdk/server` собирается и работает как раньше (curl "say PONG" всё ещё возвращает PONG), но теперь через `@kitana-sdk/core`.

**Известная проблема:** `pnpm build` (через `turbo run build`) падает с `Unable to find package manager binary` на этой машине (конфликт turbo/corepack). Обходной путь — собирать вручную по порядку зависимостей: `pnpm --filter @kitana-sdk/core build && pnpm --filter @kitana-sdk/server build`. Разобраться с turbo отдельно, не блокирует разработку.

## Шаг 3 — router: failover chain ✅

- [x] `packages/core/src/router.ts` — `createRouter({ chain, apiKeys })`
- [x] `router.complete({ messages, model })` — пробует провайдеры по цепочке по порядку, при ошибке — следующий
- [x] Логирование каждого переключения в консоль (`[router] ollama failed (...), falling back to claude`)
- [x] Ошибка провайдера (throw/reject) детектится через try/catch на каждом шаге цепочки

Проверка: подтверждено в реальном терминале — chain `['ollama','claude']` с неработающим Ollama корректно переключился на Claude, лог `[router] ollama failed (fetch failed), falling back to claude`, результат `{"content":"PONG","provider":"claude",...}`.

## Шаг 4 — API key fallback ✅

- [x] `packages/core/src/providers/apiKey.ts` — `callAnthropicApi()` и `callOpenAiApi()`, выбор SDK по наличию ключа (`apiKeys.anthropic`/`ANTHROPIC_API_KEY` приоритетнее, иначе `apiKeys.openai`/`OPENAI_API_KEY`)
- [x] Подключено в router как последнее звено цепочки (`apiKeyHandler`)
- [x] Graceful error, если ни одного ключа нет: "No API key configured..." вместо краша

Проверка: подтверждено дважды —
1. Без ключа: `[router] api-key failed (No Anthropic API key configured...)`, чистая ошибка
2. С реальным OpenAI-ключом (передан через env var, не сохранён в файлах, отозван пользователем сразу после теста): `{"content":"PONG! 🎮","model":"gpt-4o-mini-2024-07-18","provider":"api-key",...}`

## Шаг 5 — интеграция router в `@kitana-sdk/server` ✅

- [x] `packages/server/src/handlers/completions.ts` использует `router.complete()` вместо прямого `callClaude()`
- [x] Конфигурация chain по умолчанию: `['claude', 'ollama', 'api-key']`
- [x] Лог теперь показывает через какого провайдера обработан запрос (`request finished in ...ms via claude`)

Проверка: подтверждено — curl "say PONG" продолжает работать через новый путь `router.complete()` → claude, `"content":"PONG"`. Ручной тест failover на Ollama уже проверен отдельно на Шаге 3 (router работает корректно вне зависимости от того кто его вызывает).

## Шаг 6 — Vercel AI SDK adapter (если время останется)

- [ ] `packages/core/src/ai-sdk-adapter.ts` — имплементация `LanguageModelV1`
- [ ] `kitana('auto')` работает с `generateText` из пакета `ai`

Проверка: маленький тестовый скрипт с `generateText({ model: kitana('auto'), ... })` возвращает текст.

## Шаг 6 — Streaming (реальный, не отложенный) ✅

Найдено: `claude -p --output-format stream-json --include-partial-messages` отдаёт NDJSON события в реальном времени (`stream_event` → `content_block_delta` с `delta.text`), плюс финальный `result` с полной статистикой (как в обычном `json` режиме).

- [x] `packages/core/src/platform.ts` — добавлен `spawnAsync()` (async-версия `run()` с той же Windows shell-логикой)
- [x] `packages/core/src/providers/claude.ts` — `streamClaude(prompt, model, onDelta)`: `spawn`, парсинг NDJSON построчно, вызов `onDelta(text)` на каждый `content_block_delta`, resolve с полным `ClaudeResponse` на событии `type === 'result'`
- [x] `packages/server/src/handlers/completions.ts` — если `body.stream === true`: `Content-Type: text/event-stream`, эмитим OpenAI-совместимые SSE-чанки (`data: {...}\n\n`), завершаем `data: [DONE]\n\n`
- [x] **Ограничение осознанно принято:** стриминг работает только для провайдера Claude напрямую (bypass router) — router с failover-цепочкой для стрима пока не поддерживается, это усложнение отдельного порядка (что делать с частично стриленным ответом при переключении на другой провайдер — открытый вопрос, не в скоупе сейчас)

Проверка: подтверждено — `curl -N` с `"stream":true` вернул несколько отдельных SSE-чанков с частями текста по мере генерации, корректный `finish_reason:"stop"` и `[DONE]` в конце.

## На будущее (не в этой стадии)

- **Собственный терминальный proxy-app** (идея пользователя) — отдельное приложение-клиент, которое держит стрим к `claude -p --output-format stream-json` и раздаёт его дальше (например, нескольким подключённым HTTP-клиентам одновременно, или как альтернативный UI). Отдельный продуктовый компонент, не часть `core`/`server` — рассмотреть отдельно, не сейчас.

## Явно НЕ делаем на этой стадии

- Streaming (перенесено на будущее ещё в Стадии 1)
- `bible.compress()` при failover — это Стадия 4, router просто логирует переключение
- Gemini CLI / Codex CLI провайдеры — только заглушки/planned, реальной интеграции нет

## После завершения

Milestone: видео "Мой AI сам переключается между моделями" (roadmap.md, Стадия 3).
Следующая по приоритету — Стадия 5 (OpenClaw интеграция) согласно пересмотренному порядку в roadmap.md.
