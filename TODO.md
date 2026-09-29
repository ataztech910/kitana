# TODO

Найдено во время подготовки воркшопа (2026-08-09), сознательно отложено —
не блокер для альфа/бета-версии.

## Диагностика при ENOTEMPTY в `ensureClaudeInstalled()`

**Файл:** `packages/core/src/providers/claude.ts` (функция `ensureClaudeInstalled`, ~строка 67)

**Проблема:** если `npm install -g @anthropic-ai/claude-code` падает с `ENOTEMPTY`
(осиротевший temp-каталог от прошлой прерванной установки — известный класс npm-проблем),
сервер просто пишет "Automatic install failed. Install manually: ..." и завершается
(`process.exit(1)` в `server.ts`). Никакой подсказки, что именно пошло не так и как
именно починить (`rm -rf` конкретного temp-каталога), — пользователь должен сам
гуглить `ENOTEMPTY`.

**Почему не сейчас:** это эдж-кейс (нужен именно осиротевший temp-каталог от
прошлой неудачной установки) — у большинства пользователей просто не будет
`@anthropic-ai/claude-code`, и `npm install -g` пройдёт с первого раза без ошибок.
Не блокер для текущей стадии.

**Если будем чинить:** `run()` в `platform.ts` сейчас зовёт `npm install` с
`stdio: 'inherit'` — стдерр никуда не попадает, кроме экрана. Нужно `pipe`,
распарсить `npm error dest <path>`, и напечатать точный `rm -rf <path>` пользователю.

## Список моделей в `/v1/models` захардкожен

**Файл:** `packages/server/src/server.ts`, `GET /v1/models`

Список (`claude-sonnet-4-6`, `claude-haiku-4-5-20251001`) не включает `claude-sonnet-5`,
хотя `auto` реально в него резолвится (проверено 2026-08-09). Docs (`providers.md`)
хардкодят похожий, тоже не совпадающий список. Для альфа-версии — приемлемое
упрощение, не приоритет. Если руки дойдут — либо обновить список вручную,
либо (лучше) не хардкодить, а спрашивать `claude` CLI напрямую.

## 2026-08-31: streaming для tool-enabled запросов в `KitanaLlm`

**Файлы:** `packages/adk/src/KitanaLlm.ts`, `packages/core/src/router.ts`,
`packages/core/src/providers/{claude,codex,ollama,apiKey}.ts`

**Текущее ограничение:** `KitanaLlm.generateContentAsync()` при наличии хотя бы
одного ADK-инструмента всегда вызывает `router.complete()`, даже если ADK передал
`stream=true`. Поэтому буферизуется не только JSON-вызов инструмента, но и обычный
текстовый ответ модели после выполнения инструмента.

**Почему так сделано:** function calling реализован текстовым протоколом. Модель
либо отвечает обычным текстом, либо возвращает JSON
`{"tool_call":{"name":"...","args":{...}}}`. Текущий `parseToolCall()` определяет
тип ответа только после получения полного текста.

**Что уже проверено:**

- Claude CLI реально стримит через `stream-json --include-partial-messages`.
- Ollama, Anthropic API и OpenAI API отдают настоящие text deltas.
- `streamCodex()` сейчас не является настоящим streaming: ждёт завершения
  `callCodex()` и затем отдаёт весь ответ одним `onDelta()`.
- ADK допускает partial text events и последующий завершённый event с
  `functionCall`; partial events не сохраняются в истории session.
- `router.stream()` запрещает fallback после первого provider delta. Это важно,
  даже если `KitanaLlm` ещё не показал delta пользователю, а держит его в своём
  классификаторе.

**Предлагаемый вариант:** добавить опциональный режим
`toolStreaming: "buffered" | "detect"`. Сохранить `buffered` как совместимый
режим, а в `detect` вызывать `router.stream()` и классифицировать начало ответа:

1. Обычный текст начинать отдавать в ADK сразу.
2. Ответ, начинающийся с `{` или markdown JSON fence, буферизовать полностью.
3. После завершения валидный разрешённый tool-call преобразовать в
   `functionCall`; нераспознанный JSON вернуть как обычный текст.
4. Для streaming-режима принимать tool call только как самостоятельный JSON или
   fenced JSON. Не пытаться находить JSON внутри уже показанного обычного текста,
   поскольку отправленные deltas невозможно отозвать.

**Статусы для UI:** не отправлять `provider: ...` как модельный текст. Добавить
отдельный `onStatus`/telemetry callback для событий `provider.started`,
`provider.failed`, `toolCall.detected`. Этот же канал позднее использовать в
`@kitana-sdk/tracker`.

**Что решить 2026-08-31:**

- Оставить ли `buffered` режимом по умолчанию или сразу включить `detect`.
- Приемлемо ли документировать отсутствие fallback после начала streaming, либо
  расширять контракт router callback подтверждением реально опубликованного delta.
- Делать ли отдельную доработку Codex `--json`, учитывая, что JSONL lifecycle
  events не гарантируют token-level deltas.
- Нужны ли status events в этом же релизе или вместе с будущим tracker.

**Критерий готовности:** через Claude, Ollama и API-key обычный текстовый ответ при
наличии tools приходит partial events; чистый tool-call JSON не попадает в UI и
выполняется ADK; malformed/unknown JSON не вызывает инструмент; существующий
non-tool streaming и обработка ошибок не регрессируют.
