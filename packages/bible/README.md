# @kitana-sdk/bible

Persistent context for agentic pipelines, from [Kitana SDK](https://github.com/ataztech910/kitana). If a pipeline crashes at step 2, resume from step 2 — don't burn tokens re-running steps 1 and 2. If the router falls back to a weaker model, hand it a compressed summary of what happened so far.

## Install

```bash
npm install @kitana-sdk/bible
```

## Usage

```typescript
import { Bible } from '@kitana-sdk/bible'

const bible = new Bible({ path: '.kitana' })

// Before doing any work, read what's already been done
const context = await bible.read()
// { mission, progress, lastStep, snapshots }

// After a step completes, record it — this is mandatory by contract
await bible.update({
  step: 'analyst',
  stepIndex: 1,
  result: { summary: 'Found 3 competitors: X, Y, Z' },
  tokensUsed: 1500,
  provider: 'claude-sonnet-4-6'
})

// Compress history to fit a smaller model's context window
const compressed = await bible.compress({
  targetTokens: 2000,
  strategy: 'facts-only' // or 'summary', or 'last-n'
})
```

### Resuming after a crash

```typescript
const context = await bible.read()
const completedIndex = STEPS.find(s => s.name === context.lastStep)?.index ?? 0

for (const step of STEPS) {
  if (step.index <= completedIndex) continue // already done, skip
  // ...run the step, then bible.update(...)
}
```

### Wiring into `@kitana-sdk/core`'s router

```typescript
import { createRouter } from '@kitana-sdk/core'

const router = createRouter({
  chain: ['claude', 'ollama', 'api-key'],
  onProviderSwitch: async () => bible.compress({ targetTokens: 500, strategy: 'last-n' })
})
```

The compressed context is delivered through each provider's real system-prompt channel, not embedded in the user message — see the main repo's `bible.md` for why that distinction matters.

## On-disk layout

```
.kitana/bible/
  mission.md
  progress.md
  snapshots/
    01_analyst.json
    02_copywriter.json
```

See the [main repo](https://github.com/ataztech910/kitana) for full documentation.
