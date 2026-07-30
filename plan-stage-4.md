# Plan — Стадия 4: Библия проекта (@kitana-sdk/bible)

Цель стадии: персистентный контекст агентных пайплайнов на диске (`.kitana/bible/`). Пайплайн падает на шаге 2 — перезапускаем с шага 2. Failover на слабую модель — контекст сжимается и передаётся дальше. Срок — 3 недели (самая долгая и сложная стадия).

Делаем маленькими шагами, каждый — проверяемый результат перед переходом к следующему.

## Шаг 0 — пакет `packages/bible` — скелет ✅

- [x] `packages/bible/package.json` (имя `@kitana-sdk/bible`, зависит от `@kitana-sdk/core` — compressor будет дёргать router для сжатия)
- [x] `packages/bible/tsconfig.json`
- [x] `packages/bible/src/index.ts`
- [x] `packages/bible/src/types.ts` — `BibleContext`, `UpdateStepInput`, `CompressOptions`, `Snapshot` (по формату из bible.md)

Проверка: `pnpm --filter @kitana-sdk/bible build` компилируется.

## Шаг 1 — форматы файлов ✅

- [x] `packages/bible/src/formats.ts`
- [x] `mission.md` — не требует парсера, читаем как raw markdown (создаётся руками, по контракту)
- [x] `formatProgressEntry()` / `parseProgress()` — append-only лог шагов (формат из bible.md: `## Step N — name [timestamp]` + Provider/Tokens/Status/Summary)

Проверка: подтверждено — round-trip тест (2 снапшота → сериализация → парсинг обратно) дал точное совпадение всех полей (`step`, `tokens`, `provider`, `summary`).

## Шаг 2 — класс `Bible` — базовые read/update ✅

- [x] `packages/bible/src/Bible.ts`
- [x] `new Bible({ path: '.kitana' })`
- [x] `bible.read()` — читает `mission.md` + `progress.md`, возвращает `{ mission, progress, lastStep, snapshots }`
- [x] `bible.update({ step, stepIndex, result, tokensUsed, provider })` — создаёт `snapshots/NN_step.json`, аппендит в `progress.md`
- [x] `bible.getSnapshot(index)` — читает конкретный JSON-снапшот
- [x] Инициализация: директории создаются лениво при первом `update()`, `mission.md` не создаётся автоматически (ручной файл по контракту)

Проверка: подтверждено двумя отдельными Node-процессами — процесс 1 сделал `update()` для двух шагов, процесс 2 (новый `new Bible()`, чистая память) корректно прочитал `lastStep: 'copywriter'`, оба снапшота и содержимое `getSnapshot(1)` — персистентность на диске работает, не в памяти.

## Шаг 3 — восстановление после падения (Проблема 1 из bible.md) ✅

- [x] Симуляция: пайплайн из 3 шагов (analyst → copywriter → reviewer), падение на шаге 3 (искусственный `throw`)
- [x] Перезапуск: `bible.read()` → `lastStep: 'copywriter'`, пайплайн определяет completedIndex и продолжает с шага 3, пропуская 1-2
- [x] Паттерн resume-логики (`completedIndex` по `lastStep`, `continue` для уже сделанных шагов) — референс для реального использования Bible в пайплайнах

Проверка: подтверждено — двухпрогонный тест показал `analyst: 1 вызов, copywriter: 1 вызов, reviewer: 2 вызова` (упал → retry → успех). Завершённые шаги не повторились ни разу, только упавший шаг был перезапущен.

## Шаг 4 — compressor ✅

- [x] `packages/bible/src/compressor.ts`
- [x] `bible.compress({ targetTokens, strategy })` — читает все снапшоты
- [x] Стратегия `facts-only` — через `router.complete()` из `@kitana-sdk/core` с промптом "сожми до N токенов, только факты"
- [x] Стратегия `last-n` — без вызова модели, чисто механически берёт последние N шагов (дешёвый путь, не тратит токены)
- [x] Стратегия `summary` — по одному краткому summary на шаг через модель (тот же путь через модель, что и facts-only, другой промпт)

Проверка: подтверждено дважды —
1. `last-n` (2 из 3 шагов) — механически вернул только `copywriter`+`reviewer`, без `analyst`, без вызова модели
2. `facts-only` — реальный вызов через `router.complete()` → Claude сжал 3 шага (2600 токенов исходных) в компактный факт-текст (226 символов), сохранив все ключевые данные

**Важный найденный и исправленный баг (влияет не только на compressor, а на весь `@kitana-sdk/core`):** многострочный prompt, переданный как CLI-аргумент (`claude -p "многострочный текст"`), молча обрывается/пустеет на Windows — `cmd.exe` разбивает командную строку по символам новой строки внутри аргумента, даже в кавычках. Исправлено: `callClaude()` и `streamClaude()` теперь передают prompt через **stdin** (`claude -p` без позиционного аргумента, `--input`/`options.input` в `spawnSync`/`child.stdin.write()`), а не через argv. Подтверждено: `claude -p` реально поддерживает чтение prompt из stdin (задокументированное поведение CLI, не хак).

## Шаг 5 — интеграция с router (автовызов compress при failover) ✅

- [x] В `@kitana-sdk/core/src/router.ts` — `onProviderSwitch` hook: при переключении на другого провайдера, если задан, вызывается и возвращённый контекст передаётся следующему провайдеру
- [x] `core` не зависит от `bible` — hook передаётся как callback в `RouterConfig`, вызывающая сторона (bible-consumer) сама решает что вернуть
- [x] **Критическая архитектурная находка и фикс:** первая реализация мержила сжатый контекст в текст user-сообщения (или как отдельное fake `system:` сообщение) — Claude **корректно распознавал это как prompt injection и отказывался использовать** (ирония: наша же собственная защита из architecture.md сработала против нас). Исправлено: контекст передаётся как настоящий system prompt через нативный механизм каждого провайдера — `--append-system-prompt-file` (временный файл) для Claude CLI, `system` field для Anthropic/OpenAI API, `role: 'system'` сообщение для Ollama (OpenAI-совместимый эндпоинт) — это честный доверенный канал, а не текстовая имитация
- [x] Побочный найденный баг: `claude -p` с многострочным prompt как позиционным CLI-аргументом **молча портится на Windows** (`cmd.exe` обрывает аргумент на `\n` даже в кавычках) → зафиксировано и исправлено ещё в Шаге 4 (prompt теперь всегда через stdin)

Проверка: подтверждено — chain `['ollama','claude']` с недоступным Ollama, Bible с 2 существующими снапшотами, hook вызывает `bible.compress({strategy:'last-n'})`. Лог показал `[router] carrying 144 chars of compressed context to claude via system prompt`. Финальный ответ Claude на вопрос "какой был заголовок на шаге copywriter?" — точный факт `"Купи слона"` из сжатого контекста.

## Шаг 6 — пример полного агентного пайплайна (референс из bible.md) ✅

- [x] Демо-скрипт: пайплайн из 3 реальных агентов (analyst → copywriter → reviewer) через настоящий `router.complete()`, каждый читает/обновляет Bible по контракту
- [x] Прогон целиком без падений

Проверка: подтверждено реальным прогоном — Tesla → слоган → "Отклонено" (reviewer), все три шага через `provider=claude`. `progress.md` содержит 3 записи в точном формате из bible.md, все три снапшота (`01_analyst.json`, `02_copywriter.json`, `03_reviewer.json`) созданы и парсятся, `lastStep: reviewer`.

## Явно НЕ делаем на этой стадии

- UI для Библии (визуальный редактор — это Стадия 7, Kitana App)
- Автоматическое создание/редактирование `mission.md` — только руками, по контракту
- Интеграция в `@kitana-sdk/server` HTTP handler (Bible — это библиотека для агентных пайплайнов, а не часть простого chat-completions запроса; подключать туда смысла нет пока нет реального пайплайна-потребителя)

## Шаг 7 — автотесты (Vitest)

- [x] Добавлен Vitest в корень репо (`pnpm test` = `vitest run`)
- [x] `packages/bible/src/formats.test.ts` — round-trip сериализации/парсинга progress.md (3 теста)
- [x] `packages/bible/src/Bible.test.ts` — персистентность через отдельные инстансы, восстановление после падения (без повторного выполнения завершённых шагов), compress last-n (5 тестов)
- [x] `packages/core/src/router.test.ts` — пустая цепочка, ошибка без API-ключа, hook не вызывается когда нет fallback-цели (3 теста)
- [x] `packages/server/src/handlers/completions.test.ts` — валидация запроса (400 на невалидный JSON / отсутствие messages) без реальных вызовов Claude (4 теста)
- [x] Ручные одноразовые `test-*.ts` скрипты, использованные во время разработки Стадий 3-4, удалены — их место заняли настоящие тесты в репозитории

Проверка: `pnpm test` — 15/15 тестов проходят.

Осознанно не покрыто автотестами (требуют живой Claude CLI/API подписки, дорого и недетерминированно гонять в CI): `callClaude`/`streamClaude` реальные вызовы, `compress` со стратегиями `facts-only`/`summary` (вызывают модель), полный интеграционный сценарий Bible+router с реальным Claude. Эти пути проверены вручную и задокументированы в этом файле как пройденные проверки.

## После завершения

Milestone: видео "Почему AI агент забывает всё и как починить" (roadmap.md, Стадия 4).
Следующая по приоритету — Стадия 5 (OpenClaw интеграция) согласно пересмотренному порядку.
