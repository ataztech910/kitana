import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { describe, expect, it, vi } from 'vitest'
import * as platform from '../platform'

vi.mock('../platform', async () => {
  const actual = await vi.importActual<typeof import('../platform')>('../platform')
  return {
    ...actual,
    isBinaryAvailable: vi.fn(() => true),
    spawnAsync: vi.fn()
  }
})

const { callClaude } = await import('./claude')

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: { end: ReturnType<typeof vi.fn> }
    stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
    stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> }
  }
  child.stdin = { end: vi.fn() }
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  return child
}

describe('callClaude', () => {
  it('keeps the system prompt file until the async child closes', async () => {
    const child = fakeChild()
    vi.mocked(platform.spawnAsync).mockReturnValueOnce(
      child as unknown as ReturnType<typeof platform.spawnAsync>
    )

    const pending = callClaude('hello', undefined, 'trusted instructions')
    const args = vi.mocked(platform.spawnAsync).mock.calls[0]?.[1] ?? []
    const options = vi.mocked(platform.spawnAsync).mock.calls[0]?.[2]
    const flagIndex = args.indexOf('--append-system-prompt-file')
    const promptFile = args[flagIndex + 1]

    expect(flagIndex).toBeGreaterThanOrEqual(0)
    expect(promptFile).toBeDefined()
    expect(existsSync(promptFile)).toBe(true)
    expect(options).toMatchObject({ timeout: 120000 })
    expect(child.stdin.end).toHaveBeenCalledWith('hello')

    child.stdout.emit('data', JSON.stringify({
      type: 'result',
      result: 'ok',
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: {}
    }))
    child.emit('close', 0, null)

    await expect(pending).resolves.toMatchObject({ result: 'ok' })
    expect(existsSync(promptFile)).toBe(false)
  })
})
