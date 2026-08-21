import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRouter } from './router'
import * as claudeProvider from './providers/claude'
import * as codexProvider from './providers/codex'
import * as ollamaProvider from './providers/ollama'
import * as apiKeyProvider from './providers/apiKey'

vi.mock('./providers/claude', async () => {
  const actual = await vi.importActual<typeof import('./providers/claude')>('./providers/claude')
  return { ...actual, callClaude: vi.fn(), streamClaude: vi.fn() }
})

vi.mock('./providers/ollama', async () => {
  const actual = await vi.importActual<typeof import('./providers/ollama')>('./providers/ollama')
  return { ...actual, callOllama: vi.fn(), streamOllama: vi.fn() }
})

vi.mock('./providers/codex', async () => {
  const actual = await vi.importActual<typeof import('./providers/codex')>('./providers/codex')
  return { ...actual, streamCodex: vi.fn(), callCodex: vi.fn() }
})

vi.mock('./providers/apiKey', async () => {
  const actual = await vi.importActual<typeof import('./providers/apiKey')>('./providers/apiKey')
  return {
    ...actual,
    callAnthropicApi: vi.fn(),
    callOpenAiApi: vi.fn(),
    streamAnthropicApi: vi.fn(),
    streamOpenAiApi: vi.fn()
  }
})

const messages: CompleteRequest['messages'] = [{ role: 'user', content: 'hi' }]

function claudeResponse() {
  return {
    type: 'result',
    result: 'ok',
    total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: {}
  }
}

function apiResponse(model: string) {
  return {
    content: 'ok',
    model,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
  }
}

function ollamaResponse() {
  return {
    choices: [{ message: { content: 'ok' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  }
}

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

  it('passes request systemPrompt through complete and stream provider channels', async () => {
    vi.mocked(claudeProvider.callClaude).mockResolvedValueOnce(claudeResponse())
    vi.mocked(claudeProvider.streamClaude).mockResolvedValueOnce(claudeResponse())
    const router = createRouter({ chain: ['claude'] })

    await router.complete({ messages, systemPrompt: 'trusted system instructions' })
    await router.stream({ messages, systemPrompt: 'trusted system instructions' }, vi.fn())

    expect(claudeProvider.callClaude).toHaveBeenCalledWith(
      expect.any(String), undefined, 'trusted system instructions'
    )
    expect(claudeProvider.streamClaude).toHaveBeenCalledWith(
      expect.any(String), undefined, expect.any(Function), 'trusted system instructions'
    )
  })

  it('appends fallback context to the request systemPrompt without moving it into messages', async () => {
    vi.mocked(codexProvider.callCodex).mockRejectedValueOnce(new Error('Codex CLI error: unavailable'))
    vi.mocked(ollamaProvider.callOllama).mockResolvedValueOnce(ollamaResponse())
    const router = createRouter({
      chain: ['codex', 'ollama'],
      onProviderSwitch: async () => 'fallback context'
    })

    await router.complete({ messages, systemPrompt: 'base instructions' })

    expect(codexProvider.callCodex).toHaveBeenCalledWith(
      expect.any(String), undefined, 'base instructions'
    )
    expect(ollamaProvider.callOllama).toHaveBeenCalledWith(
      messages, 'llama3', 'base instructions\n\nfallback context'
    )
    expect(messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('uses each provider-specific configured model for auto completion requests', async () => {
    vi.mocked(claudeProvider.callClaude).mockResolvedValueOnce(claudeResponse())
    vi.mocked(codexProvider.callCodex).mockResolvedValueOnce({ result: 'ok', model: 'codex-config' })
    vi.mocked(ollamaProvider.callOllama).mockResolvedValueOnce(ollamaResponse())
    vi.mocked(apiKeyProvider.callAnthropicApi).mockResolvedValueOnce(apiResponse('api-config'))

    await createRouter({ chain: ['claude'], models: { claude: 'claude-config' } })
      .complete({ messages, model: 'auto' })
    await createRouter({ chain: ['codex'], models: { codex: 'codex-config' } })
      .complete({ messages, model: 'auto' })
    await createRouter({ chain: ['ollama'], models: { ollama: 'ollama-config' } })
      .complete({ messages, model: 'auto' })
    await createRouter({
      chain: ['api-key'],
      apiKeys: { anthropic: 'test-key' },
      models: { 'api-key': 'api-config' }
    }).complete({ messages, model: 'auto' })

    expect(claudeProvider.callClaude).toHaveBeenCalledWith(expect.any(String), 'claude-config', undefined)
    expect(codexProvider.callCodex).toHaveBeenCalledWith(expect.any(String), 'codex-config', undefined)
    expect(ollamaProvider.callOllama).toHaveBeenCalledWith(messages, 'ollama-config', undefined)
    expect(apiKeyProvider.callAnthropicApi).toHaveBeenCalledWith(messages, 'api-config', 'test-key', undefined)
  })

  it('lets an explicit request model override every configured completion model', async () => {
    vi.mocked(claudeProvider.callClaude).mockResolvedValueOnce(claudeResponse())
    vi.mocked(codexProvider.callCodex).mockResolvedValueOnce({ result: 'ok', model: 'request-model' })
    vi.mocked(ollamaProvider.callOllama).mockResolvedValueOnce(ollamaResponse())
    vi.mocked(apiKeyProvider.callAnthropicApi).mockResolvedValueOnce(apiResponse('request-model'))

    await createRouter({ chain: ['claude'], models: { claude: 'configured' } })
      .complete({ messages, model: 'request-model' })
    await createRouter({ chain: ['codex'], models: { codex: 'configured' } })
      .complete({ messages, model: 'request-model' })
    await createRouter({ chain: ['ollama'], models: { ollama: 'configured' } })
      .complete({ messages, model: 'request-model' })
    await createRouter({
      chain: ['api-key'],
      apiKeys: { anthropic: 'test-key' },
      models: { 'api-key': 'configured' }
    }).complete({ messages, model: 'request-model' })

    expect(claudeProvider.callClaude).toHaveBeenCalledWith(expect.any(String), 'request-model', undefined)
    expect(codexProvider.callCodex).toHaveBeenCalledWith(expect.any(String), 'request-model', undefined)
    expect(ollamaProvider.callOllama).toHaveBeenCalledWith(messages, 'request-model', undefined)
    expect(apiKeyProvider.callAnthropicApi).toHaveBeenCalledWith(messages, 'request-model', 'test-key', undefined)
  })

  it('keeps every current provider default when no configured model is provided', async () => {
    vi.mocked(claudeProvider.callClaude).mockResolvedValueOnce(claudeResponse())
    vi.mocked(codexProvider.callCodex).mockResolvedValueOnce({ result: 'ok', model: 'codex' })
    vi.mocked(ollamaProvider.callOllama).mockResolvedValueOnce(ollamaResponse())
    vi.mocked(apiKeyProvider.callAnthropicApi).mockResolvedValueOnce(apiResponse('claude-sonnet-4-6'))

    await createRouter({ chain: ['claude'] }).complete({ messages, model: 'auto' })
    await createRouter({ chain: ['codex'] }).complete({ messages, model: 'auto' })
    await createRouter({ chain: ['ollama'] }).complete({ messages, model: 'auto' })
    await createRouter({ chain: ['api-key'], apiKeys: { anthropic: 'test-key' } })
      .complete({ messages, model: 'auto' })

    expect(claudeProvider.callClaude).toHaveBeenCalledWith(expect.any(String), undefined, undefined)
    expect(codexProvider.callCodex).toHaveBeenCalledWith(expect.any(String), undefined, undefined)
    expect(ollamaProvider.callOllama).toHaveBeenCalledWith(messages, 'llama3', undefined)
    expect(apiKeyProvider.callAnthropicApi).toHaveBeenCalledWith(messages, undefined, 'test-key', undefined)
  })

  it('uses a configured provider model when the request model is omitted', async () => {
    vi.mocked(ollamaProvider.callOllama).mockResolvedValueOnce(ollamaResponse())

    await createRouter({ chain: ['ollama'], models: { ollama: 'mistral:instruct' } })
      .complete({ messages })

    expect(ollamaProvider.callOllama).toHaveBeenCalledWith(messages, 'mistral:instruct', undefined)
  })

  it('starts concurrent Claude completions before either one resolves', async () => {
    const resolvers: Array<(value: ReturnType<typeof claudeResponse>) => void> = []
    const started: string[] = []
    vi.mocked(claudeProvider.callClaude).mockImplementation(prompt => {
      started.push(prompt)
      return new Promise(resolve => { resolvers.push(resolve) })
    })
    const router = createRouter({ chain: ['claude'] })

    const first = router.complete({ messages: [{ role: 'user', content: 'first' }] })
    const second = router.complete({ messages: [{ role: 'user', content: 'second' }] })

    expect(started).toHaveLength(2)
    expect(resolvers).toHaveLength(2)
    resolvers[0](claudeResponse())
    resolvers[1](claudeResponse())
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })

  it('starts concurrent Codex completions before either one resolves', async () => {
    const resolvers: Array<(value: { result: string; model: string }) => void> = []
    const started: string[] = []
    vi.mocked(codexProvider.callCodex).mockImplementation(prompt => {
      started.push(prompt)
      return new Promise(resolve => { resolvers.push(resolve) })
    })
    const router = createRouter({ chain: ['codex'] })

    const first = router.complete({ messages: [{ role: 'user', content: 'first' }] })
    const second = router.complete({ messages: [{ role: 'user', content: 'second' }] })

    expect(started).toHaveLength(2)
    expect(resolvers).toHaveLength(2)
    resolvers[0]({ result: 'first done', model: 'codex' })
    resolvers[1]({ result: 'second done', model: 'codex' })
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })

  it('uses each provider-specific configured model for auto streaming requests', async () => {
    vi.mocked(claudeProvider.streamClaude).mockResolvedValueOnce(claudeResponse())
    vi.mocked(codexProvider.streamCodex).mockResolvedValueOnce({ result: 'ok', model: 'codex-config' })
    vi.mocked(ollamaProvider.streamOllama).mockResolvedValueOnce(ollamaResponse())
    vi.mocked(apiKeyProvider.streamAnthropicApi).mockResolvedValueOnce(apiResponse('api-config'))
    const onDelta = vi.fn()

    await createRouter({ chain: ['claude'], models: { claude: 'claude-config' } })
      .stream({ messages, model: 'auto' }, onDelta)
    await createRouter({ chain: ['codex'], models: { codex: 'codex-config' } })
      .stream({ messages, model: 'auto' }, onDelta)
    await createRouter({ chain: ['ollama'], models: { ollama: 'ollama-config' } })
      .stream({ messages, model: 'auto' }, onDelta)
    await createRouter({
      chain: ['api-key'],
      apiKeys: { anthropic: 'test-key' },
      models: { 'api-key': 'api-config' }
    }).stream({ messages, model: 'auto' }, onDelta)

    expect(claudeProvider.streamClaude).toHaveBeenCalledWith(
      expect.any(String), 'claude-config', expect.any(Function), undefined
    )
    expect(codexProvider.streamCodex).toHaveBeenCalledWith(
      expect.any(String), 'codex-config', expect.any(Function), undefined
    )
    expect(ollamaProvider.streamOllama).toHaveBeenCalledWith(
      messages, 'ollama-config', expect.any(Function), undefined
    )
    expect(apiKeyProvider.streamAnthropicApi).toHaveBeenCalledWith(
      messages, 'api-config', 'test-key', expect.any(Function), undefined
    )
  })

  it('lets an explicit request model override every configured streaming model', async () => {
    vi.mocked(claudeProvider.streamClaude).mockResolvedValueOnce(claudeResponse())
    vi.mocked(codexProvider.streamCodex).mockResolvedValueOnce({ result: 'ok', model: 'request-model' })
    vi.mocked(ollamaProvider.streamOllama).mockResolvedValueOnce(ollamaResponse())
    vi.mocked(apiKeyProvider.streamAnthropicApi).mockResolvedValueOnce(apiResponse('request-model'))
    const onDelta = vi.fn()

    await createRouter({ chain: ['claude'], models: { claude: 'configured' } })
      .stream({ messages, model: 'request-model' }, onDelta)
    await createRouter({ chain: ['codex'], models: { codex: 'configured' } })
      .stream({ messages, model: 'request-model' }, onDelta)
    await createRouter({ chain: ['ollama'], models: { ollama: 'configured' } })
      .stream({ messages, model: 'request-model' }, onDelta)
    await createRouter({
      chain: ['api-key'],
      apiKeys: { anthropic: 'test-key' },
      models: { 'api-key': 'configured' }
    }).stream({ messages, model: 'request-model' }, onDelta)

    expect(claudeProvider.streamClaude).toHaveBeenCalledWith(
      expect.any(String), 'request-model', expect.any(Function), undefined
    )
    expect(codexProvider.streamCodex).toHaveBeenCalledWith(
      expect.any(String), 'request-model', expect.any(Function), undefined
    )
    expect(ollamaProvider.streamOllama).toHaveBeenCalledWith(
      messages, 'request-model', expect.any(Function), undefined
    )
    expect(apiKeyProvider.streamAnthropicApi).toHaveBeenCalledWith(
      messages, 'request-model', 'test-key', expect.any(Function), undefined
    )
  })

  it('falls back from codex to ollama when codex fails before producing a response', async () => {
    vi.mocked(codexProvider.callCodex).mockRejectedValueOnce(new Error('Codex CLI error: network unavailable'))
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
