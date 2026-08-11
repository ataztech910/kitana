import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { Message } from '../types'

export interface ApiKeyResponse {
  content: string
  model: string
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}

export async function callAnthropicApi(
  messages: Message[],
  model: string | undefined,
  apiKey: string | undefined,
  systemPrompt?: string
): Promise<ApiKeyResponse> {
  if (!apiKey) {
    throw new Error('No Anthropic API key configured (router config apiKeys.anthropic / ANTHROPIC_API_KEY)')
  }

  const client = new Anthropic({ apiKey })
  const resolvedModel = model && model !== 'auto' ? model : 'claude-sonnet-4-6'

  const response = await client.messages.create({
    model: resolvedModel,
    max_tokens: 1024,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }))
  })

  const content = response.content
    .filter(block => block.type === 'text')
    .map(block => (block as { text: string }).text)
    .join('')

  return {
    content,
    model: response.model,
    usage: {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens
    }
  }
}

export async function streamAnthropicApi(
  messages: Message[],
  model: string | undefined,
  apiKey: string | undefined,
  onDelta: (text: string) => void,
  systemPrompt?: string
): Promise<ApiKeyResponse> {
  if (!apiKey) {
    throw new Error('No Anthropic API key configured (router config apiKeys.anthropic / ANTHROPIC_API_KEY)')
  }

  const client = new Anthropic({ apiKey })
  const resolvedModel = model && model !== 'auto' ? model : 'claude-sonnet-4-6'

  const stream = client.messages.stream({
    model: resolvedModel,
    max_tokens: 1024,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }))
  })

  stream.on('text', onDelta)

  const message = await stream.finalMessage()

  const content = message.content
    .filter(block => block.type === 'text')
    .map(block => (block as { text: string }).text)
    .join('')

  return {
    content,
    model: message.model,
    usage: {
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
      totalTokens: message.usage.input_tokens + message.usage.output_tokens
    }
  }
}

export async function callOpenAiApi(
  messages: Message[],
  model: string | undefined,
  apiKey: string | undefined,
  systemPrompt?: string
): Promise<ApiKeyResponse> {
  if (!apiKey) {
    throw new Error('No OpenAI API key configured (router config apiKeys.openai / OPENAI_API_KEY)')
  }

  const client = new OpenAI({ apiKey })
  const resolvedModel = model && model !== 'auto' ? model : 'gpt-4o-mini'

  const chatMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: m.content
  }))

  const response = await client.chat.completions.create({
    model: resolvedModel,
    messages: systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...chatMessages]
      : chatMessages
  })

  const content = response.choices[0]?.message?.content ?? ''

  return {
    content,
    model: response.model,
    usage: {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0
    }
  }
}

export async function streamOpenAiApi(
  messages: Message[],
  model: string | undefined,
  apiKey: string | undefined,
  onDelta: (text: string) => void,
  systemPrompt?: string
): Promise<ApiKeyResponse> {
  if (!apiKey) {
    throw new Error('No OpenAI API key configured (router config apiKeys.openai / OPENAI_API_KEY)')
  }

  const client = new OpenAI({ apiKey })
  const resolvedModel = model && model !== 'auto' ? model : 'gpt-4o-mini'

  const chatMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: m.content
  }))

  const stream = await client.chat.completions.create({
    model: resolvedModel,
    messages: systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...chatMessages]
      : chatMessages,
    stream: true,
    stream_options: { include_usage: true }
  })

  let content = ''
  let resolvedResponseModel = resolvedModel
  let usage: ApiKeyResponse['usage'] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  for await (const chunk of stream) {
    resolvedResponseModel = chunk.model ?? resolvedResponseModel
    const delta = chunk.choices[0]?.delta?.content
    if (delta) {
      content += delta
      onDelta(delta)
    }
    if (chunk.usage) {
      usage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens
      }
    }
  }

  return { content, model: resolvedResponseModel, usage }
}
