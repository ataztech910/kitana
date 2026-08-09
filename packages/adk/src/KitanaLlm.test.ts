import { describe, it, expect, vi } from 'vitest'
import type { LlmRequest } from '@google/adk'
import type { CompleteRequest, CompleteResponse } from '@kitana-sdk/core'

const completeMock = vi.fn<(req: CompleteRequest) => Promise<CompleteResponse>>()

vi.mock('@kitana-sdk/core', async () => {
  const actual = await vi.importActual<typeof import('@kitana-sdk/core')>('@kitana-sdk/core')
  return {
    ...actual,
    createRouter: vi.fn(() => ({ complete: completeMock }))
  }
})

// Imported after the mock so KitanaLlm picks up the mocked createRouter.
const { KitanaLlm, contentsToMessages, extractText } = await import('./KitanaLlm')

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
})

describe('KitanaLlm', () => {
  it('sends the system instruction as a leading system message', async () => {
    completeMock.mockResolvedValueOnce(fakeResponse('ok'))
    const llm = new KitanaLlm({ model: 'auto' })

    const request = fakeRequest({
      config: { systemInstruction: 'Be concise.' }
    })

    const results = []
    for await (const chunk of llm.generateContentAsync(request)) results.push(chunk)

    expect(completeMock).toHaveBeenCalledWith({
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'hi' }
      ],
      model: 'auto'
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

  it('rejects connect() — live/bidi is not supported', async () => {
    const llm = new KitanaLlm({ model: 'auto' })
    await expect(llm.connect(fakeRequest())).rejects.toThrow(/does not support live/)
  })
})
