import { BaseLlm, LLMRegistry } from '@google/adk'
import type { BaseLlmConnection, LlmRequest, LlmResponse } from '@google/adk'
import type { Content, ContentUnion, Part } from '@google/genai'
import { createRouter } from '@kitana-sdk/core'
import type { Message, ProviderName, RouterConfig } from '@kitana-sdk/core'

const MODEL_PREFIX = 'kitana/'

function partText(part: Part): string {
  return typeof part.text === 'string' ? part.text : ''
}

// Bridges router.stream()'s push-style onDelta callback into the pull-style
// async generator generateContentAsync must return. Node is single-threaded,
// so a simple queue + one pending resolver is enough — no locking needed.
class AsyncChannel<T> {
  private readonly queue: T[] = []
  private closed = false
  private failure: unknown
  private wake: (() => void) | undefined

  push(item: T): void {
    this.queue.push(item)
    this.wake?.()
  }

  close(): void {
    this.closed = true
    this.wake?.()
  }

  fail(err: unknown): void {
    this.failure = err
    this.closed = true
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void> {
    for (;;) {
      if (this.queue.length > 0) {
        yield this.queue.shift() as T
        continue
      }
      if (this.closed) {
        if (this.failure !== undefined) throw this.failure
        return
      }
      await new Promise<void>(resolve => { this.wake = resolve })
    }
  }
}

// @google/genai's ContentUnion is a loose union (string | Content | Part | Part[] | Content[]).
// ADK's LlmRequest.config.systemInstruction is typed as ContentUnion — narrow it by shape,
// not by relying on a single expected type, since callers may pass any of these forms.
export function extractText(value: ContentUnion | undefined): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(v => extractText(v as ContentUnion)).filter(Boolean).join('\n') || undefined
  }
  if ('parts' in value && Array.isArray(value.parts)) {
    const text = value.parts.map(partText).join('')
    return text || undefined
  }
  if ('text' in value) {
    return partText(value as Part)
  }
  return undefined
}

export function contentsToMessages(contents: Content[]): Message[] {
  return contents.map(c => ({
    role: c.role === 'model' ? 'assistant' : 'user',
    content: (c.parts ?? []).map(partText).join('')
  }))
}

export interface KitanaLlmParams {
  /**
   * Either the bare downstream model ("auto", "claude-sonnet-5", "llama3.2", ...)
   * or the same prefixed with "kitana/" — the prefix form is what LLMRegistry
   * matches when a bare string is passed to LlmAgent (e.g. model: "kitana/auto").
   */
  model: string
  /** Provider failover order. Defaults to the same chain @kitana-sdk/core defaults to. */
  chain?: ProviderName[]
  apiKeys?: RouterConfig['apiKeys']
}

/**
 * ADK model adapter for Kitana. @google/adk's LLMRegistry only ships Gemini/Vertex
 * and Apigee resolvers (see packages/core detector docs) — there is no built-in
 * OpenAI-compatible/LiteLLM connector in the JS package, so LlmAgent can never reach
 * Kitana's HTTP server via OPENAI_BASE_URL alone. This class plugs directly into
 * @kitana-sdk/core's router instead (no separate `kitana-server` process needed).
 *
 * Usage:
 *   const agent = new LlmAgent({ model: new KitanaLlm({ model: "auto" }), ... })
 * or, once registered (this module registers on import), a bare string:
 *   const agent = new LlmAgent({ model: "kitana/auto", ... })
 */
export class KitanaLlm extends BaseLlm {
  static override readonly supportedModels: Array<string | RegExp> = [/^kitana\/.*/]

  private readonly router: ReturnType<typeof createRouter>
  private readonly downstreamModel: string

  constructor(params: KitanaLlmParams) {
    super({ model: params.model })
    this.downstreamModel = params.model.startsWith(MODEL_PREFIX)
      ? params.model.slice(MODEL_PREFIX.length)
      : params.model
    this.router = createRouter({
      chain: params.chain ?? ['claude', 'ollama', 'api-key'],
      apiKeys: params.apiKeys
    })
  }

  async *generateContentAsync(
    llmRequest: LlmRequest,
    stream = false,
    _abortSignal?: AbortSignal
  ): AsyncGenerator<LlmResponse, void> {
    const messages: Message[] = []

    const systemText = extractText(llmRequest.config?.systemInstruction)
    if (systemText) messages.push({ role: 'system', content: systemText })

    messages.push(...contentsToMessages(llmRequest.contents))

    const downstreamModel = llmRequest.model?.startsWith(MODEL_PREFIX)
      ? llmRequest.model.slice(MODEL_PREFIX.length)
      : llmRequest.model ?? this.downstreamModel

    // Letting router.complete()/.stream()'s rejection propagate as a thrown exception
    // out of this generator is risky: if ADK's Runner doesn't uniformly convert an
    // unhandled rejection from a custom BaseLlm into an error event, the caller's
    // for-await loop can just end with zero iterations — a silent failure that
    // looks identical to "nothing to say", not an error (observed: intermittent
    // empty output with exit code 0, no stack trace, no error event — see
    // ataztech910/kitana#<workshop-debug>). Catch here and always yield a
    // response — either real content or an explicit error — so callers get at
    // least one event no matter what.
    if (!stream) {
      try {
        const response = await this.router.complete({ messages, model: downstreamModel })
        yield {
          content: { role: 'model', parts: [{ text: response.content }] },
          turnComplete: true,
          partial: false,
          customMetadata: { kitanaProvider: response.provider }
        }
      } catch (err) {
        yield {
          errorCode: 'KITANA_PROVIDER_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
          turnComplete: true,
          partial: false
        }
      }
      return
    }

    // Push-style router.stream(onDelta) is bridged into this pull-style generator
    // via AsyncChannel. Each delta is yielded as its own partial event (mirrors
    // @google/adk's own NonProgressiveStrategy: incremental chunks carry just the
    // new text, not an accumulated snapshot); the router's resolved value carries
    // the full text and is yielded once more as the non-partial, turnComplete event.
    const channel = new AsyncChannel<LlmResponse>()

    this.router
      .stream({ messages, model: downstreamModel }, text => {
        channel.push({
          content: { role: 'model', parts: [{ text }] },
          partial: true,
          turnComplete: false
        })
      })
      .then(response => {
        channel.push({
          content: { role: 'model', parts: [{ text: response.content }] },
          partial: false,
          turnComplete: true,
          customMetadata: { kitanaProvider: response.provider }
        })
        channel.close()
      })
      .catch(err => channel.fail(err))

    try {
      for await (const chunk of channel) {
        yield chunk
      }
    } catch (err) {
      yield {
        errorCode: 'KITANA_PROVIDER_FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
        turnComplete: true,
        partial: false
      }
    }
  }

  async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error(
      'KitanaLlm does not support live/bidi connections (connect()) — only generateContentAsync (text-turn) requests.'
    )
  }
}

LLMRegistry.register(KitanaLlm)
