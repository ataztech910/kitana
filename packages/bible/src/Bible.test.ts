import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Bible } from './Bible'

describe('Bible', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kitana-bible-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('persists steps to disk and reads them back via a fresh instance', async () => {
    const writer = new Bible({ path: dir })

    await writer.update({
      step: 'analyst',
      stepIndex: 1,
      result: { summary: 'Проанализировал рынок' },
      tokensUsed: 1500,
      provider: 'claude-sonnet-4-6'
    })

    await writer.update({
      step: 'copywriter',
      stepIndex: 2,
      result: { summary: 'Написал заголовки' },
      tokensUsed: 800,
      provider: 'ollama/llama3'
    })

    // Fresh instance, no shared in-memory state — persistence must come from disk.
    const reader = new Bible({ path: dir })
    const context = await reader.read()

    expect(context.lastStep).toBe('copywriter')
    expect(context.snapshots).toEqual(['01_analyst.json', '02_copywriter.json'])

    const snapshot1 = await reader.getSnapshot(1)
    expect(snapshot1?.result.summary).toBe('Проанализировал рынок')
  })

  it('returns empty context when nothing has been written yet', async () => {
    const bible = new Bible({ path: dir })
    const context = await bible.read()

    expect(context.lastStep).toBeNull()
    expect(context.snapshots).toEqual([])
    expect(context.mission).toBe('')
  })

  it('supports resuming a pipeline after a mid-run crash without re-running completed steps', async () => {
    const bible = new Bible({ path: dir })
    const calls: string[] = []

    const steps = [
      { name: 'analyst', index: 1 },
      { name: 'copywriter', index: 2 },
      { name: 'reviewer', index: 3 }
    ]

    async function runPipeline(failStepName: string | null) {
      const context = await bible.read()
      const completedIndex = context.lastStep
        ? steps.find(s => s.name === context.lastStep)?.index ?? 0
        : 0

      for (const step of steps) {
        if (step.index <= completedIndex) continue

        calls.push(step.name)
        if (step.name === failStepName) {
          throw new Error(`${step.name} crashed`)
        }

        await bible.update({
          step: step.name,
          stepIndex: step.index,
          result: { summary: `${step.name} done` },
          tokensUsed: 100,
          provider: 'claude-sonnet-4-6'
        })
      }
    }

    await expect(runPipeline('reviewer')).rejects.toThrow('reviewer crashed')
    await runPipeline(null)

    // analyst/copywriter completed before the crash and must not re-run;
    // reviewer failed once then succeeded on the resumed run.
    expect(calls).toEqual(['analyst', 'copywriter', 'reviewer', 'reviewer'])

    const finalContext = await bible.read()
    expect(finalContext.lastStep).toBe('reviewer')
    expect(finalContext.snapshots).toHaveLength(3)
  })

  it('compresses with the last-n strategy without calling any model', async () => {
    const bible = new Bible({ path: dir })

    await bible.update({ step: 'analyst', stepIndex: 1, result: { summary: 'A' }, tokensUsed: 100, provider: 'claude' })
    await bible.update({ step: 'copywriter', stepIndex: 2, result: { summary: 'B' }, tokensUsed: 100, provider: 'claude' })
    await bible.update({ step: 'reviewer', stepIndex: 3, result: { summary: 'C' }, tokensUsed: 100, provider: 'claude' })

    const compressed = await bible.compress({ targetTokens: 500, strategy: 'last-n', lastN: 2 })

    expect(compressed).toContain('copywriter')
    expect(compressed).toContain('reviewer')
    expect(compressed).not.toContain('analyst')
  })

  it('compress returns an empty string when there are no snapshots yet', async () => {
    const bible = new Bible({ path: dir })
    const compressed = await bible.compress({ targetTokens: 500, strategy: 'last-n' })
    expect(compressed).toBe('')
  })
})
