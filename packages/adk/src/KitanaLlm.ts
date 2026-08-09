import { BaseLlm, LLMRegistry } from '@google/adk'
import type { BaseLlmConnection, LlmRequest, LlmResponse } from '@google/adk'
import type { Content, ContentUnion, Part } from '@google/genai'
import { createRouter } from '@kitana-sdk/core'
import type { Message, ProviderName, RouterConfig } from '@kitana-sdk/core'

const MODEL_PREFIX = 'kitana/'

function partText(part: Part): string {
  return typeof part.text === 'string' ? part.text : ''
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
    // Streaming isn't implemented yet — @kitana-sdk/core's router.complete() is a
    // single non-streaming call. A streaming path exists in providers/claude.ts
    // (streamClaude) but isn't wired through the router yet. Accepted for API
    // compatibility with BaseLlm; ignored for now, always yields one full response.
    _stream = false,
    _abortSignal?: AbortSignal
  ): AsyncGenerator<LlmResponse, void> {
    const messages: Message[] = []

    const systemText = extractText(llmRequest.config?.systemInstruction)
    if (systemText) messages.push({ role: 'system', content: systemText })

    messages.push(...contentsToMessages(llmRequest.contents))

    const response = await this.router.complete({
      messages,
      model: llmRequest.model?.startsWith(MODEL_PREFIX)
        ? llmRequest.model.slice(MODEL_PREFIX.length)
        : llmRequest.model ?? this.downstreamModel
    })

    yield {
      content: { role: 'model', parts: [{ text: response.content }] },
      turnComplete: true,
      partial: false,
      customMetadata: { kitanaProvider: response.provider }
    }
  }

  async connect(): Promise<BaseLlmConnection> {
    throw new Error(
      'KitanaLlm does not support live/bidi connections (connect()) — only generateContentAsync (text-turn) requests.'
    )
  }
}

LLMRegistry.register(KitanaLlm)
