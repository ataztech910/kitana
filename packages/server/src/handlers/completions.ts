import { IncomingMessage, ServerResponse } from 'http'
import { callClaude } from '../providers/claude'

interface OpenAIRequest {
  model: string
  messages: Array<{ role: string; content: string }>
}

export async function handleCompletions(
  req: IncomingMessage,
  res: ServerResponse
) {
  const body = await readBody(req)

  let model: string | undefined
  let messages: OpenAIRequest['messages'] | undefined

  try {
    const parsed = JSON.parse(body) as OpenAIRequest
    model = parsed.model
    messages = parsed.messages
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

  const prompt = messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n')

  const startedAt = Date.now()
  console.log(`[completions] request started, model=${model}, promptLength=${prompt.length}`)

  try {
    const claudeRes = callClaude(prompt, model)
    console.log(`[completions] request finished in ${Date.now() - startedAt}ms`)

    const usedModel = claudeRes.modelUsage
      ? Object.keys(claudeRes.modelUsage).pop()
      : 'claude-sonnet-4-6'

    const response = {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: usedModel,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: claudeRes.result
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: claudeRes.usage.input_tokens,
        completion_tokens: claudeRes.usage.output_tokens,
        total_tokens: claudeRes.usage.input_tokens + claudeRes.usage.output_tokens
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}
