import { Message } from '../types'

export interface OllamaResponse {
  choices: Array<{ message: { content: string } }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export async function callOllama(messages: Message[], model: string, systemPrompt?: string): Promise<OllamaResponse> {
  const finalMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages

  const res = await fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: finalMessages })
  })

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`)
  }

  return res.json() as Promise<OllamaResponse>
}

interface OllamaStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export async function streamOllama(
  messages: Message[],
  model: string,
  onDelta: (text: string) => void,
  systemPrompt?: string
): Promise<OllamaResponse> {
  const finalMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages

  const res = await fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: finalMessages,
      stream: true,
      stream_options: { include_usage: true }
    })
  })

  if (!res.ok || !res.body) {
    throw new Error(`Ollama error: ${res.status} ${res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let usage: OllamaResponse['usage']

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue

      const data = trimmed.slice('data:'.length).trim()
      if (data === '[DONE]') continue

      let chunk: OllamaStreamChunk
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }

      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) {
        content += delta
        onDelta(delta)
      }

      if (chunk.usage) usage = chunk.usage
    }
  }

  return { choices: [{ message: { content } }], usage }
}
