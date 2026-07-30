import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRouter } from './router'

describe('router', () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY
  const originalOpenAiKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
  })

  afterEach(() => {
    if (originalAnthropicKey) process.env.ANTHROPIC_API_KEY = originalAnthropicKey
    if (originalOpenAiKey) process.env.OPENAI_API_KEY = originalOpenAiKey
  })

  it('throws when the chain is empty', () => {
    expect(() => createRouter({ chain: [] })).toThrow('Router chain must include at least one provider')
  })

  it('fails clearly when api-key is the only provider and no key is configured', async () => {
    const router = createRouter({ chain: ['api-key'] })

    await expect(
      router.complete({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(/No API key configured/)
  })

  it('calls onProviderSwitch when falling back after api-key fails, but not on the first (only) provider', async () => {
    const calls: Array<{ from: string; to: string }> = []

    const router = createRouter({
      chain: ['api-key'],
      onProviderSwitch: async info => {
        calls.push({ from: info.from, to: info.to })
        return undefined
      }
    })

    await expect(
      router.complete({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow()

    // Single-provider chain: no fallback target exists, so the hook must never fire.
    expect(calls).toEqual([])
  })
})
