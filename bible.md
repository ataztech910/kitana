# Библия проекта (@kitana-sdk/bible)

## Проблема которую решает

**Проблема 1 — пайплайн упал на середине**
Агентный пайплайн из трёх шагов упал на шаге 2. Без Библии — начинаем сначала, тратим токены, теряем результат шага 1. С Библией — читаем что уже сделано и продолжаем с шага 2.

**Проблема 2 — failover между моделями**
Claude упал, переключились на Ollama. Но Ollama не знает контекста предыдущих шагов. Библия передаёт этот контекст в сжатом виде.

## Аналогии

- Библия = git + checkpoint
- `progress.md` = git log (что было сделано)
- `snapshots/` = CI артефакты (полные результаты)
- `mission.md` = README (не меняется, объясняет зачем)

## Структура на диске

```
.kitana/
  bible/
    mission.md              — цель проекта, ICP, не меняется никогда
    progress.md             — лог что сделал каждый агент
    snapshots/
      01_analyst.json       — полный результат шага 1
      02_copywriter.json    — полный результат шага 2
```

## mission.md формат

```markdown
# Project Mission

## Цель
[Что мы строим и зачем]

## ICP (ideal customer)
[Для кого это]

## Ключевые ограничения
[Что нельзя делать]

## Успех выглядит как
[Критерии готовности]
```

Этот файл создаётся один раз и не меняется автоматически. Только руками.

## progress.md формат

```markdown
# Progress Log

## Step 1 — analyst [2026-07-30T10:00:00Z]
Provider: claude-sonnet-4-6
Tokens: 1500
Status: completed
Summary: Проанализировал рынок, выявил 3 конкурента: X, Y, Z

## Step 2 — copywriter [2026-07-30T10:05:00Z]
Provider: ollama/llama3 (failover от claude)
Tokens: 800
Status: completed
Summary: Написал 5 вариантов заголовка, лучший: "..."
```

## API

```typescript
import { Bible } from '@kitana-sdk/bible'

const bible = new Bible({ path: '.kitana' })

// Читаем контекст перед шагом
const context = await bible.read()
// {
//   mission: string,       — содержимое mission.md
//   progress: string,      — содержимое progress.md
//   lastStep: string,      — последний завершённый шаг
//   snapshots: string[]    — список доступных снапшотов
// }

// Обновляем после шага — ОБЯЗАТЕЛЬНО
await bible.update({
  step: 'analyst',
  stepIndex: 1,
  result: { summary: '...', data: { competitors: [...] } },
  tokensUsed: 1500,
  provider: 'claude-sonnet-4-6'
})
// Создаёт: snapshots/01_analyst.json
// Обновляет: progress.md

// Читаем конкретный снапшот
const snapshot = await bible.getSnapshot(1)

// Сжимаем при failover на слабую модель
const compressed = await bible.compress({
  targetTokens: 2000,
  strategy: 'facts-only'
})
// Возвращает строку для передачи в следующий агент
```

## Контракт агента

Каждый агент в пайплайне обязан:

1. **Перед работой** — прочитать Библию: `bible.read()`
2. **После работы** — обновить Библию: `bible.update(step, result)`

Это не опционально. Это часть контракта агента.

```typescript
// Пример агента
async function analystAgent(task: string) {
  const bible = new Bible({ path: '.kitana' })
  
  // 1. Читаем контекст
  const context = await bible.read()
  
  // 2. Строим промпт с контекстом
  const prompt = `
    Mission: ${context.mission}
    Previous progress: ${context.progress}
    
    Your task: ${task}
  `
  
  // 3. Делаем запрос
  const result = await router.complete({ messages: [{ role: 'user', content: prompt }] })
  
  // 4. Обязательно обновляем Библию
  await bible.update({
    step: 'analyst',
    stepIndex: 1,
    result: { raw: result.content, summary: extractSummary(result.content) },
    tokensUsed: result.usage.total_tokens,
    provider: result.model
  })
  
  return result
}
```

## Compressor

При failover на более слабую модель (меньший контекст) — сжимаем Библию.

```typescript
const compressed = await bible.compress({
  targetTokens: 2000,    // влезть в контекст слабой модели
  strategy: 'facts-only' // убираем воду, оставляем факты
})
```

Стратегии:
- `facts-only` — только конкретные факты, числа, решения
- `summary` — короткое саммари каждого шага
- `last-n` — только последние N шагов

Алгоритм:
1. Читает все снапшоты и progress.md
2. Отправляет в модель с промптом "сожми до N токенов"
3. Возвращает dense string для передачи в агент
4. Сжатие ~60-70% без потери ключевых фактов

## Файловая структура пакета

```
packages/bible/src/
├── index.ts
├── Bible.ts          — основной класс
├── compressor.ts     — логика сжатия
├── formats.ts        — форматы mission.md и progress.md
└── types.ts
```
