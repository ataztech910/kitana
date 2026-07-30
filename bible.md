# Project Bible (@kitana-sdk/bible)

## The problem it solves

**Problem 1 — the pipeline crashes halfway through**
A three-step agentic pipeline crashes at step 2. Without the Bible — start over, burn tokens, lose step 1's result. With the Bible — read what's already done and continue from step 2.

**Problem 2 — failover between models**
Claude goes down, we switch to Ollama. But Ollama doesn't know the context from the previous steps. The Bible carries that context over, compressed.

## Analogies

- Bible = git + checkpoint
- `progress.md` = git log (what's been done)
- `snapshots/` = CI artifacts (full results)
- `mission.md` = README (never changes, explains why)

## On-disk structure

```
.kitana/
  bible/
    mission.md              — project goal, ICP, never changes
    progress.md             — log of what each agent did
    snapshots/
      01_analyst.json       — full result of step 1
      02_copywriter.json    — full result of step 2
```

## mission.md format

```markdown
# Project Mission

## Goal
[What we're building and why]

## ICP (ideal customer)
[Who this is for]

## Key constraints
[What must not be done]

## Success looks like
[Readiness criteria]
```

This file is created once and never changes automatically. Hand-edited only.

## progress.md format

```markdown
# Progress Log

## Step 1 — analyst [2026-07-30T10:00:00Z]
Provider: claude-sonnet-4-6
Tokens: 1500
Status: completed
Summary: Analyzed the market, found 3 competitors: X, Y, Z

## Step 2 — copywriter [2026-07-30T10:05:00Z]
Provider: ollama/llama3 (failover from claude)
Tokens: 800
Status: completed
Summary: Wrote 5 headline variants, best one: "..."
```

## API

```typescript
import { Bible } from '@kitana-sdk/bible'

const bible = new Bible({ path: '.kitana' })

// Read context before a step
const context = await bible.read()
// {
//   mission: string,       — contents of mission.md
//   progress: string,      — contents of progress.md
//   lastStep: string,      — last completed step
//   snapshots: string[]    — list of available snapshots
// }

// Update after a step — MANDATORY
await bible.update({
  step: 'analyst',
  stepIndex: 1,
  result: { summary: '...', data: { competitors: [...] } },
  tokensUsed: 1500,
  provider: 'claude-sonnet-4-6'
})
// Creates: snapshots/01_analyst.json
// Updates: progress.md

// Read a specific snapshot
const snapshot = await bible.getSnapshot(1)

// Compress on failover to a weaker model
const compressed = await bible.compress({
  targetTokens: 2000,
  strategy: 'facts-only'
})
// Returns a string to hand off to the next agent
```

## Agent contract

Every agent in the pipeline must:

1. **Before working** — read the Bible: `bible.read()`
2. **After working** — update the Bible: `bible.update(step, result)`

This is not optional. It's part of the agent contract.

```typescript
// Example agent
async function analystAgent(task: string) {
  const bible = new Bible({ path: '.kitana' })

  // 1. Read context
  const context = await bible.read()

  // 2. Build a prompt with context
  const prompt = `
    Mission: ${context.mission}
    Previous progress: ${context.progress}

    Your task: ${task}
  `

  // 3. Make the request
  const result = await router.complete({ messages: [{ role: 'user', content: prompt }] })

  // 4. Must update the Bible
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

On failover to a weaker model (smaller context) — compress the Bible.

```typescript
const compressed = await bible.compress({
  targetTokens: 2000,    // fit inside the weaker model's context
  strategy: 'facts-only' // strip filler, keep facts
})
```

Strategies:
- `facts-only` — only concrete facts, numbers, decisions
- `summary` — a short summary of each step
- `last-n` — only the last N steps

Algorithm:
1. Reads all snapshots and progress.md
2. Sends them to the model with a "compress to N tokens" prompt
3. Returns a dense string to hand off to the agent
4. ~60-70% compression without losing key facts

## Package file structure

```
packages/bible/src/
├── index.ts
├── Bible.ts          — main class
├── compressor.ts      — compression logic
├── formats.ts          — mission.md and progress.md formats
└── types.ts
```
