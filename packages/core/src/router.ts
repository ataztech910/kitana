import { CompleteRequest, CompleteResponse, Message, ProviderName } from './types'
import { callClaude } from './providers/claude'
import { callOllama } from './providers/ollama'
import { callAnthropicApi, callOpenAiApi } from './providers/apiKey'

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

export interface Router {
  complete(req: CompleteRequest): Promise<CompleteResponse>
}

export function createRouter(config: RouterConfig): Router {
  if (config.chain.length === 0) {
    throw new Error('Router chain must include at least one provider')
  }

  return {
    async complete(req: CompleteRequest): Promise<CompleteResponse> {
      let systemPrompt: string | undefined
      let lastError: Error | undefined

      for (let i = 0; i < config.chain.length; i++) {
        const provider = config.chain[i]
        const handler = PROVIDER_HANDLERS[provider]

        try {
          return await handler(req, config, systemPrompt)
        } catch (e) {
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
  }
}
