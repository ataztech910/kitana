import { describe, it, expect } from 'vitest'
import { formatProgressEntry, parseProgress } from './formats'
import { Snapshot } from './types'

describe('formats', () => {
  it('round-trips snapshots through progress.md format', () => {
    const snapshots: Snapshot[] = [
      {
        step: 'analyst',
        stepIndex: 1,
        timestamp: '2026-07-30T10:00:00Z',
        provider: 'claude-sonnet-4-6',
        tokensUsed: 1500,
        result: { summary: 'Проанализировал рынок, выявил 3 конкурента: X, Y, Z' }
      },
      {
        step: 'copywriter',
        stepIndex: 2,
        timestamp: '2026-07-30T10:05:00Z',
        provider: 'ollama/llama3',
        tokensUsed: 800,
        result: { summary: 'Написал 5 вариантов заголовка' }
      }
    ]

    const content = snapshots.map(formatProgressEntry).join('\n')
    const parsed = parseProgress(content)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      stepIndex: 1,
      step: 'analyst',
      provider: 'claude-sonnet-4-6',
      tokens: 1500,
      summary: 'Проанализировал рынок, выявил 3 конкурента: X, Y, Z'
    })
    expect(parsed[1]).toMatchObject({
      stepIndex: 2,
      step: 'copywriter',
      provider: 'ollama/llama3',
      tokens: 800
    })
  })

  it('returns an empty array for empty content', () => {
    expect(parseProgress('')).toEqual([])
  })

  it('ignores malformed blocks without a valid header', () => {
    const parsed = parseProgress('not a valid entry\njust some text')
    expect(parsed).toEqual([])
  })
})
