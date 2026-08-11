import { CompleteRequest, CompleteResponse, Message, ProviderName } from './types'
import { callClaude, streamClaude } from './providers/claude'
import { callOllama, streamOllama } from './providers/ollama'
import { callAnthropicApi, callOpenAiApi, streamAnthropicApi, streamOpenAiApi } from './providers/apiKey'

export interface ProviderSwitchInfo {
  from: ProviderName
  to: ProviderName
  req: CompleteRequest
}

export interface RouterConfig {
  chain: ProviderName[]
  apiKeys?: {
    anthropic?: string
    openai?: string
  }
  /**
   * Called when falling back to the next provider in the chain. Return a
   * string to prepend as extra context (e.g. a compressed Bible summary) to
   * the request sent to the next provider. Core has no dependency on
   * @kitana-sdk/bible — callers wire this hook themselves.
   */
  onProviderSwitch?: (info: ProviderSwitchInfo) => Promise<string | undefined>
}

type ProviderHandler = (
  req: CompleteRequest,
  config: RouterConfig,
  systemPrompt: string | undefined
) => Promise<CompleteResponse>

function buildPrompt(messages: Message[]): string {
  return messages.map(m => `${m.role}: ${m.content}`).join('\n')
}

const claudeHandler: ProviderHandler = async (req, _config, systemPrompt) => {
  const claudeRes = callClaude(buildPrompt(req.messages), req.model, systemPrompt)
  const usedModel = claudeRes.modelUsage
    ? Object.keys(claudeRes.modelUsage).pop() ?? 'claude-sonnet-4-6'
    : 'claude-sonnet-4-6'

  return {
    content: claudeRes.result,
    model: usedModel,
    provider: 'claude',
    usage: {
      promptTokens: claudeRes.usage.input_tokens,
      completionTokens: claudeRes.usage.output_tokens,
      totalTokens: claudeRes.usage.input_tokens + claudeRes.usage.output_tokens
    }
  }
}

const ollamaHandler: ProviderHandler = async (req, _config, systemPrompt) => {
  const model = req.model && req.model !== 'auto' ? req.model : 'llama3'
  const res = await callOllama(req.messages, model, systemPrompt)
  const choice = res.choices?.[0]?.message?.content ?? ''

  return {
    content: choice,
    model,
    provider: 'ollama',
    usage: {
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
      totalTokens: res.usage?.total_tokens ?? 0
    }
  }
}

const apiKeyHandler: ProviderHandler = async (req, config, systemPrompt) => {
  const anthropicKey = config.apiKeys?.anthropic ?? process.env.ANTHROPIC_API_KEY
  const openaiKey = config.apiKeys?.openai ?? process.env.OPENAI_API_KEY

  if (anthropicKey) {
    const res = await callAnthropicApi(req.messages, req.model, anthropicKey, systemPrompt)
    return { content: res.content, model: res.model, provider: 'api-key', usage: res.usage }
  }

  if (openaiKey) {
    const res = await callOpenAiApi(req.messages, req.model, openaiKey, systemPrompt)
    return { content: res.content, model: res.model, provider: 'api-key', usage: res.usage }
  }

  throw new Error('No API key configured (apiKeys.anthropic/openai or ANTHROPIC_API_KEY/OPENAI_API_KEY)')
}

const PROVIDER_HANDLERS: Record<ProviderName, ProviderHandler> = {
  claude: claudeHandler,
  ollama: ollamaHandler,
  'api-key': apiKeyHandler
}

type StreamProviderHandler = (
  req: CompleteRequest,
  config: RouterConfig,
  systemPrompt: string | undefined,
  onDelta: (text: string) => void
) => Promise<CompleteResponse>

const claudeStreamHandler: StreamProviderHandler = async (req, _config, systemPrompt, onDelta) => {
  const claudeRes = await streamClaude(buildPrompt(req.messages), req.model, onDelta, systemPrompt)
  const usedModel = claudeRes.modelUsage
    ? Object.keys(claudeRes.modelUsage).pop() ?? 'claude-sonnet-4-6'
    : 'claude-sonnet-4-6'

  return {
    content: claudeRes.result,
    model: usedModel,
    provider: 'claude',
    usage: {
      promptTokens: claudeRes.usage.input_tokens,
      completionTokens: claudeRes.usage.output_tokens,
      totalTokens: claudeRes.usage.input_tokens + claudeRes.usage.output_tokens
    }
  }
}

const ollamaStreamHandler: StreamProviderHandler = async (req, _config, systemPrompt, onDelta) => {
  const model = req.model && req.model !== 'auto' ? req.model : 'llama3'
  const res = await streamOllama(req.messages, model, onDelta, systemPrompt)
  const choice = res.choices?.[0]?.message?.content ?? ''

  return {
    content: choice,
    model,
    provider: 'ollama',
    usage: {
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
      totalTokens: res.usage?.total_tokens ?? 0
    }
  }
}

const apiKeyStreamHandler: StreamProviderHandler = async (req, config, systemPrompt, onDelta) => {
  const anthropicKey = config.apiKeys?.anthropic ?? process.env.ANTHROPIC_API_KEY
  const openaiKey = config.apiKeys?.openai ?? process.env.OPENAI_API_KEY

  if (anthropicKey) {
    const res = await streamAnthropicApi(req.messages, req.model, anthropicKey, onDelta, systemPrompt)
    return { content: res.content, model: res.model, provider: 'api-key', usage: res.usage }
  }

  if (openaiKey) {
    const res = await streamOpenAiApi(req.messages, req.model, openaiKey, onDelta, systemPrompt)
    return { content: res.content, model: res.model, provider: 'api-key', usage: res.usage }
  }

  throw new Error('No API key configured (apiKeys.anthropic/openai or ANTHROPIC_API_KEY/OPENAI_API_KEY)')
}

const STREAM_PROVIDER_HANDLERS: Record<ProviderName, StreamProviderHandler> = {
  claude: claudeStreamHandler,
  ollama: ollamaStreamHandler,
  'api-key': apiKeyStreamHandler
}

// Thrown instead of falling back when a stream handler has already pushed
// text through onDelta before failing. The caller (e.g. an SSE client) has
// already rendered that partial text; silently restarting from a different
// provider would produce duplicated or inconsistent output, so the error
// must surface instead of triggering the next link in the chain.
class StreamPartiallyEmittedError extends Error {
  constructor(public readonly provider: ProviderName, public readonly cause: Error) {
    super(cause.message)
  }
}

async function walkChain<T>(
  config: RouterConfig,
  req: CompleteRequest,
  attempt: (provider: ProviderName, systemPrompt: string | undefined) => Promise<T>
): Promise<T> {
  let systemPrompt: string | undefined
  let lastError: Error | undefined

  for (let i = 0; i < config.chain.length; i++) {
    const provider = config.chain[i]

    try {
      return await attempt(provider, systemPrompt)
    } catch (e) {
      if (e instanceof StreamPartiallyEmittedError) {
        throw new Error(`${e.provider} failed mid-stream after emitting partial content: ${e.cause.message}`)
      }

      lastError = e as Error
      const next = config.chain[i + 1]

      if (!next) {
        console.log(`[router] ${provider} failed (${lastError.message}), no more providers in chain`)
        break
      }

      console.log(`[router] ${provider} failed (${lastError.message}), falling back to ${next}`)

      if (config.onProviderSwitch) {
        // Passed as a real system prompt (CLI --append-system-prompt-file /
        // API `system` field / OpenAI-compatible system-role message) —
        // never mixed into the user-turn text. A lone "trust this context"
        // block embedded in a user message reads as a prompt-injection
        // attempt and models correctly refuse to act on it.
        const context = await config.onProviderSwitch({ from: provider, to: next, req })
        if (context) {
          console.log(`[router] carrying ${context.length} chars of compressed context to ${next} via system prompt`)
          systemPrompt = systemPrompt ? `${systemPrompt}\n\n${context}` : context
        }
      }
    }
  }

  throw new Error(`All providers in chain failed. Last error: ${lastError?.message}`)
}

export interface Router {
  complete(req: CompleteRequest): Promise<CompleteResponse>
  /**
   * Same provider chain and fallback semantics as complete(), but streams
   * incremental text through onDelta as it arrives. If a provider fails after
   * already emitting some deltas, the error is thrown immediately rather than
   * falling back — the caller has already seen partial output from that
   * provider, so silently restarting elsewhere would duplicate/corrupt it.
   */
  stream(req: CompleteRequest, onDelta: (text: string) => void): Promise<CompleteResponse>
}

export function createRouter(config: RouterConfig): Router {
  if (config.chain.length === 0) {
    throw new Error('Router chain must include at least one provider')
  }

  return {
    complete(req: CompleteRequest): Promise<CompleteResponse> {
      return walkChain(config, req, (provider, systemPrompt) =>
        PROVIDER_HANDLERS[provider](req, config, systemPrompt)
      )
    },

    stream(req: CompleteRequest, onDelta: (text: string) => void): Promise<CompleteResponse> {
      return walkChain(config, req, async (provider, systemPrompt) => {
        const handler = STREAM_PROVIDER_HANDLERS[provider]
        let emitted = false

        try {
          return await handler(req, config, systemPrompt, text => {
            emitted = true
            onDelta(text)
          })
        } catch (e) {
          if (emitted) throw new StreamPartiallyEmittedError(provider, e as Error)
          throw e
        }
      })
    }
  }
}
