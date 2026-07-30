import { IncomingMessage, ServerResponse } from 'http'
import { createRouter, streamClaude, Message } from '@kitana-sdk/core'

interface OpenAIRequest {
  model: string
  messages: Message[]
  stream?: boolean
}

const router = createRouter({ chain: ['claude', 'ollama', 'api-key'] })

export async function handleCompletions(
  req: IncomingMessage,
  res: ServerResponse
) {
  const body = await readBody(req)

  let model: string | undefined
  let messages: OpenAIRequest['messages'] | undefined
  let stream = false

  try {
    const parsed = JSON.parse(body) as OpenAIRequest
    model = parsed.model
    messages = parsed.messages
    stream = Boolean(parsed.stream)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Request body must include a non-empty "messages" array' }))
    return
  }

  if (stream) {
    await handleStreamingCompletion(messages, model, res)
    return
  }

  const startedAt = Date.now()
  console.log(`[completions] request started, model=${model}, messages=${messages.length}`)

  try {
    const result = await router.complete({ messages, model })
    console.log(`[completions] request finished in ${Date.now() - startedAt}ms via ${result.provider}`)

    const response = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: result.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: result.content
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: result.usage.promptTokens,
        completion_tokens: result.usage.completionTokens,
        total_tokens: result.usage.totalTokens
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(response))
  } catch (e) {
    console.log(`[completions] request failed after ${Date.now() - startedAt}ms: ${(e as Error).message}`)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: (e as Error).message }))
  }
}

async function handleStreamingCompletion(
  messages: Message[],
  model: string | undefined,
  res: ServerResponse
) {
  const id = `chatcmpl-${Date.now()}`
  const created = Math.floor(Date.now() / 1000)
  const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n')

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })

  const sendChunk = (delta: Record<string, unknown>, finishReason: string | null = null) => {
    const chunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model: model && model !== 'auto' ? model : 'claude-sonnet-4-6',
      choices: [{ index: 0, delta, finish_reason: finishReason }]
    }
    res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  }

  const startedAt = Date.now()
  console.log(`[completions] streaming request started, model=${model}, messages=${messages.length}`)

  try {
    sendChunk({ role: 'assistant', content: '' })

    await streamClaude(prompt, model, text => {
      sendChunk({ content: text })
    })

    sendChunk({}, 'stop')
    res.write('data: [DONE]\n\n')
    console.log(`[completions] streaming request finished in ${Date.now() - startedAt}ms`)
  } catch (e) {
    console.log(`[completions] streaming request failed after ${Date.now() - startedAt}ms: ${(e as Error).message}`)
    res.write(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`)
  } finally {
    res.end()
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}
