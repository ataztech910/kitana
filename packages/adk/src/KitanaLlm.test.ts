import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { LlmRequest } from '@google/adk'
import type { CompleteRequest, CompleteResponse } from '@kitana-sdk/core'

const completeMock = vi.fn<(req: CompleteRequest) => Promise<CompleteResponse>>()
const streamMock = vi.fn<(req: CompleteRequest, onDelta: (text: string) => void) => Promise<CompleteResponse>>()

vi.mock('@kitana-sdk/core', async () => {
  const actual = await vi.importActual<typeof import('@kitana-sdk/core')>('@kitana-sdk/core')
  return {
    ...actual,
    createRouter: vi.fn(() => ({ complete: completeMock, stream: streamMock }))
  }
})

// Imported after the mock so KitanaLlm picks up the mocked createRouter.
const { KitanaLlm, contentsToMessages, extractText } = await import('./KitanaLlm')
const { createRouter } = await import('@kitana-sdk/core')

function fakeResponse(content: string): CompleteResponse {
  return {
    content,
    model: 'claude-sonnet-5',
    provider: 'claude',
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }
  }
}

function fakeRequest(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
    toolsDict: {},
    liveConnectConfig: {},
    ...overrides
  } as LlmRequest
}

function fakeTool(name = 'getWeather'): LlmRequest['toolsDict'][string] {
  return {
    _getDeclaration: () => ({
      name,
      description: 'Returns the current weather for a city.',
      parametersJsonSchema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city']
      }
    })
  } as LlmRequest['toolsDict'][string]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('extractText', () => {
  it('returns a plain string unchanged', () => {
    expect(extractText('hello')).toBe('hello')
  })

  it('joins parts of a Content object', () => {
    expect(extractText({ parts: [{ text: 'a' }, { text: 'b' }] } as never)).toBe('ab')
  })

  it('returns undefined for empty/missing input', () => {
    expect(extractText(undefined)).toBeUndefined()
  })
})

describe('contentsToMessages', () => {
  it('maps ADK "model" role to "assistant"', () => {
    const messages = contentsToMessages([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hello' }] }
    ] as never)

    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ])
  })

  it('serializes function calls and responses into conversation context', () => {
    const messages = contentsToMessages([
      { role: 'model', parts: [{ functionCall: { name: 'getWeather', args: { city: 'Vienna' } } }] },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'getWeather', response: { temperature: 21 } } }]
      }
    ] as never)

    expect(messages).toEqual([
      { role: 'assistant', content: 'You called function getWeather with args: {"city":"Vienna"}' },
      { role: 'user', content: 'Function getWeather returned: {"temperature":21}' }
    ])
  })
})

describe('KitanaLlm', () => {
  it('uses a default chain that includes codex between claude and ollama', () => {
    const llm = new KitanaLlm({ model: 'auto' })

    expect(llm).toBeDefined()
    expect(vi.mocked(createRouter)).toHaveBeenCalledWith({
      chain: ['claude', 'codex', 'ollama', 'api-key'],
      apiKeys: undefined,
      models: undefined
    })
  })

  it('passes provider-specific models to the core router', () => {
    const models = { claude: 'sonnet', codex: 'gpt-5', ollama: 'mistral:instruct' } as const

    const llm = new KitanaLlm({ model: 'auto', models })

    expect(llm).toBeDefined()
    expect(vi.mocked(createRouter)).toHaveBeenCalledWith({
      chain: ['claude', 'codex', 'ollama', 'api-key'],
      apiKeys: undefined,
      models
    })
  })

  it('sends the system instruction through the dedicated systemPrompt field', async () => {
    completeMock.mockResolvedValueOnce(fakeResponse('ok'))
    const llm = new KitanaLlm({ model: 'auto' })

    const request = fakeRequest({
      config: { systemInstruction: 'Be concise.' }
    })

    const results = []
    for await (const chunk of llm.generateContentAsync(request)) results.push(chunk)

    expect(completeMock).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'auto',
      systemPrompt: 'Be concise.'
    })
    expect(results).toEqual([
      {
        content: { role: 'model', parts: [{ text: 'ok' }] },
        turnComplete: true,
        partial: false,
        customMetadata: { kitanaProvider: 'claude' }
      }
    ])
  })

  it('strips the "kitana/" prefix before calling the router', async () => {
    completeMock.mockResolvedValueOnce(fakeResponse('pong'))
    const llm = new KitanaLlm({ model: 'kitana/auto' })

    for await (const _ of llm.generateContentAsync(fakeRequest())) {
      /* drain */
    }

    expect(completeMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'auto' })
    )
  })

  it('adds tool declarations and the JSON protocol to the system prompt', async () => {
    completeMock.mockResolvedValueOnce(fakeResponse('No tool needed.'))
    const llm = new KitanaLlm({ model: 'auto' })

    for await (const _ of llm.generateContentAsync(fakeRequest({
      toolsDict: { getWeather: fakeTool() }
    }))) {
      /* drain */
    }

    const request = completeMock.mock.calls[0]?.[0]
    expect(request?.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(request?.messages.some(message => message.role === 'system')).toBe(false)
    expect(request?.systemPrompt).toContain('getWeather')
    expect(request?.systemPrompt).toContain('Returns the current weather for a city.')
    expect(request?.systemPrompt).toContain('"required": [')
    expect(request?.systemPrompt).toContain('{"tool_call":{"name":"<function name>","args":{}}}')
    // CLI providers have native tools of their own; the prompt must say these are not them.
    expect(request?.systemPrompt).toContain('NOT your native tools')
  })

  it('keeps everything it sends to the model in English (no Cyrillic leaks into answers)', async () => {
    completeMock.mockResolvedValueOnce(fakeResponse('No tool needed.'))
    const llm = new KitanaLlm({ model: 'auto' })

    for await (const _ of llm.generateContentAsync(fakeRequest({
      toolsDict: { getWeather: fakeTool() },
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ functionCall: { name: 'getWeather', args: { city: 'Vienna' } } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'getWeather', response: { temperature: 21 } } }] }
      ]
    }))) {
      /* drain */
    }

    const request = completeMock.mock.calls[0]?.[0]
    const sent = [request?.systemPrompt ?? '', ...(request?.messages ?? []).map(message => message.content)].join('\n')
    expect(sent).toContain('You called function getWeather')
    expect(sent).not.toMatch(/[А-Яа-яЁё]/)
  })

  it('converts tool-call JSON into an ADK functionCall part', async () => {
    completeMock.mockResolvedValueOnce(fakeResponse(
      '{"tool_call":{"name":"getWeather","args":{"city":"Vienna"}}}'
    ))
    const llm = new KitanaLlm({ model: 'auto' })

    const results = []
    for await (const chunk of llm.generateContentAsync(fakeRequest({
      toolsDict: { getWeather: fakeTool() }
    }))) results.push(chunk)

    expect(results[0]?.content?.parts).toEqual([
      { functionCall: { name: 'getWeather', args: { city: 'Vienna' } } }
    ])
  })

  it('keeps ordinary text and unrelated JSON as text', async () => {
    const text = 'The weather payload is {"temperature":21}, but no tool call is needed.'
    completeMock.mockResolvedValueOnce(fakeResponse(text))
    const llm = new KitanaLlm({ model: 'auto' })

    const results = []
    for await (const chunk of llm.generateContentAsync(fakeRequest({
      toolsDict: { getWeather: fakeTool() }
    }))) results.push(chunk)

    expect(results[0]?.content?.parts).toEqual([{ text }])
  })

  it('parses tool-call JSON wrapped in a markdown fence', async () => {
    completeMock.mockResolvedValueOnce(fakeResponse(
      '```json\n{"tool_call":{"name":"getWeather","args":{"city":"Vienna"}}}\n```'
    ))
    const llm = new KitanaLlm({ model: 'auto' })

    const results = []
    for await (const chunk of llm.generateContentAsync(fakeRequest({
      toolsDict: { getWeather: fakeTool() }
    }))) results.push(chunk)

    expect(results[0]?.content?.parts).toEqual([
      { functionCall: { name: 'getWeather', args: { city: 'Vienna' } } }
    ])
  })

  it('does not emit partial deltas for tool-enabled streaming requests', async () => {
    completeMock.mockResolvedValueOnce(fakeResponse(
      '{"tool_call":{"name":"getWeather","args":{"city":"Vienna"}}}'
    ))
    const llm = new KitanaLlm({ model: 'auto' })

    const results = []
    for await (const chunk of llm.generateContentAsync(fakeRequest({
      toolsDict: { getWeather: fakeTool() }
    }), true)) results.push(chunk)

    expect(streamMock).not.toHaveBeenCalled()
    expect(completeMock).toHaveBeenCalledOnce()
    expect(results).toHaveLength(1)
    expect(results[0]?.partial).toBe(false)
    expect(results[0]?.content?.parts[0]).toEqual({
      functionCall: { name: 'getWeather', args: { city: 'Vienna' } }
    })
  })

  it('does not accept a tool-call JSON for an unknown tool', async () => {
    const text = '{"tool_call":{"name":"deleteEverything","args":{}}}'
    completeMock.mockResolvedValueOnce(fakeResponse(text))
    const llm = new KitanaLlm({ model: 'auto' })

    const results = []
    for await (const chunk of llm.generateContentAsync(fakeRequest({
      toolsDict: { getWeather: fakeTool() }
    }))) results.push(chunk)

    expect(results[0]?.content?.parts).toEqual([{ text }])
  })

  it('rejects connect() — live/bidi is not supported', async () => {
    const llm = new KitanaLlm({ model: 'auto' })
    await expect(llm.connect(fakeRequest())).rejects.toThrow(/does not support live/)
  })

  it('yields an error event instead of throwing when every provider fails', async () => {
    completeMock.mockRejectedValueOnce(new Error('All providers in chain failed. Last error: fetch failed'))
    const llm = new KitanaLlm({ model: 'auto' })

    // The generator must not throw — a caller doing `for await` should still
    // get exactly one event back, not an unhandled rejection.
    const results: unknown[] = []
    await expect(
      (async () => {
        for await (const chunk of llm.generateContentAsync(fakeRequest())) {
          results.push(chunk)
        }
      })()
    ).resolves.toBeUndefined()

    expect(results).toEqual([
      {
        errorCode: 'KITANA_PROVIDER_FAILED',
        errorMessage: 'All providers in chain failed. Last error: fetch failed',
        turnComplete: true,
        partial: false
      }
    ])
  })

  it('streams partial deltas followed by one final turnComplete event', async () => {
    streamMock.mockImplementationOnce(async (_req, onDelta) => {
      onDelta('Hel')
      onDelta('lo')
      return fakeResponse('Hello')
    })
    const llm = new KitanaLlm({ model: 'auto' })

    const results = []
    for await (const chunk of llm.generateContentAsync(fakeRequest(), true)) results.push(chunk)

    expect(results).toEqual([
      { content: { role: 'model', parts: [{ text: 'Hel' }] }, partial: true, turnComplete: false },
      { content: { role: 'model', parts: [{ text: 'lo' }] }, partial: true, turnComplete: false },
      {
        content: { role: 'model', parts: [{ text: 'Hello' }] },
        partial: false,
        turnComplete: true,
        customMetadata: { kitanaProvider: 'claude' }
      }
    ])
  })

  it('keeps streaming system instructions out of conversation messages', async () => {
    streamMock.mockResolvedValueOnce(fakeResponse('Hello'))
    const llm = new KitanaLlm({ model: 'auto' })

    for await (const _ of llm.generateContentAsync(fakeRequest({
      config: { systemInstruction: 'Be concise.' }
    }), true)) {
      /* drain */
    }

    expect(streamMock).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'auto',
      systemPrompt: 'Be concise.'
    }, expect.any(Function))
  })

  it('yields an error event instead of throwing when streaming fails', async () => {
    streamMock.mockRejectedValueOnce(new Error('All providers in chain failed. Last error: fetch failed'))
    const llm = new KitanaLlm({ model: 'auto' })

    const results: unknown[] = []
    await expect(
      (async () => {
        for await (const chunk of llm.generateContentAsync(fakeRequest(), true)) {
          results.push(chunk)
        }
      })()
    ).resolves.toBeUndefined()

    expect(results).toEqual([
      {
        errorCode: 'KITANA_PROVIDER_FAILED',
        errorMessage: 'All providers in chain failed. Last error: fetch failed',
        turnComplete: true,
        partial: false
      }
    ])
  })
})
