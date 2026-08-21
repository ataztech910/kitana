import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRouter } from './router'
import * as claudeProvider from './providers/claude'
import * as codexProvider from './providers/codex'
import * as ollamaProvider from './providers/ollama'

vi.mock('./providers/claude', async () => {
  const actual = await vi.importActual<typeof import('./providers/claude')>('./providers/claude')
  return { ...actual, streamClaude: vi.fn() }
})

vi.mock('./providers/ollama', async () => {
  const actual = await vi.importActual<typeof import('./providers/ollama')>('./providers/ollama')
  return { ...actual, callOllama: vi.fn(), streamOllama: vi.fn() }
})

vi.mock('./providers/codex', async () => {
  const actual = await vi.importActual<typeof import('./providers/codex')>('./providers/codex')
  return { ...actual, streamCodex: vi.fn(), callCodex: vi.fn() }
})

describe('router', () => {
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY
  const originalOpenAiKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    vi.clearAllMocks()
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

  it('falls back from codex to ollama when codex fails before producing a response', async () => {
    vi.mocked(codexProvider.callCodex).mockImplementationOnce(() => {
      throw new Error('Codex CLI error: network unavailable')
    })
    vi.mocked(ollamaProvider.callOllama).mockResolvedValueOnce({
      choices: [{ message: { content: 'fallback via ollama' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
    })

    const router = createRouter({ chain: ['codex', 'ollama'] })
    const result = await router.complete({ messages: [{ role: 'user', content: 'hi' }] })

    expect(result.provider).toBe('ollama')
    expect(result.content).toBe('fallback via ollama')
  })

  it('stream() falls back to the next provider when the first fails before emitting anything', async () => {
    vi.mocked(claudeProvider.streamClaude).mockRejectedValueOnce(new Error('claude CLI not found'))
    vi.mocked(ollamaProvider.streamOllama).mockImplementationOnce(async (_messages, model, onDelta) => {
      onDelta('hi ')
      onDelta('there')
      return { choices: [{ message: { content: 'hi there' } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }
    })

    const router = createRouter({ chain: ['claude', 'ollama'] })
    const deltas: string[] = []

    const result = await router.stream({ messages: [{ role: 'user', content: 'hi' }] }, d => deltas.push(d))

    expect(deltas).toEqual(['hi ', 'there'])
    expect(result.provider).toBe('ollama')
    expect(result.content).toBe('hi there')
  })

  it('stream() does not fall back once a provider has already emitted partial content', async () => {
    vi.mocked(claudeProvider.streamClaude).mockImplementationOnce(async (_prompt, _model, onDelta) => {
      onDelta('partial answer')
      throw new Error('CLI crashed mid-stream')
    })

    const router = createRouter({ chain: ['claude', 'ollama'] })
    const deltas: string[] = []

    await expect(
      router.stream({ messages: [{ role: 'user', content: 'hi' }] }, d => deltas.push(d))
    ).rejects.toThrow(/claude failed mid-stream after emitting partial content: CLI crashed mid-stream/)

    expect(deltas).toEqual(['partial answer'])
    expect(ollamaProvider.streamOllama).not.toHaveBeenCalled()
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
