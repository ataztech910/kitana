import { describe, it, expect } from 'vitest'
import { PassThrough } from 'stream'
import { IncomingMessage, ServerResponse } from 'http'
import { handleCompletions } from './completions'

function fakeRequest(body: string): IncomingMessage {
  const stream = new PassThrough()
  stream.end(body)
  return stream as unknown as IncomingMessage
}

function fakeResponse() {
  let statusCode = 0
  let responseBody = ''

  const res = {
    writeHead(code: number) {
      statusCode = code
      return res
    },
    setHeader() { return res },
    write(chunk: string) { responseBody += chunk; return true },
    end(chunk?: string) {
      if (chunk) responseBody += chunk
    }
  }

  return {
    res: res as unknown as ServerResponse,
    getStatus: () => statusCode,
    getBody: () => responseBody
  }
}

describe('handleCompletions validation', () => {
  it('returns 400 on invalid JSON body, without crashing the process', async () => {
    const { res, getStatus, getBody } = fakeResponse()

    await handleCompletions(fakeRequest('not json at all'), res)

    expect(getStatus()).toBe(400)
    expect(JSON.parse(getBody())).toEqual({ error: 'Invalid JSON body' })
  })

  it('returns 400 when messages is missing', async () => {
    const { res, getStatus, getBody } = fakeResponse()

    await handleCompletions(fakeRequest(JSON.stringify({ model: 'auto' })), res)

    expect(getStatus()).toBe(400)
    expect(JSON.parse(getBody()).error).toMatch(/messages/)
  })

  it('returns 400 when messages is an empty array', async () => {
    const { res, getStatus, getBody } = fakeResponse()

    await handleCompletions(fakeRequest(JSON.stringify({ model: 'auto', messages: [] })), res)

    expect(getStatus()).toBe(400)
    expect(JSON.parse(getBody()).error).toMatch(/messages/)
  })

  it('returns 400 when messages is not an array', async () => {
    const { res, getStatus, getBody } = fakeResponse()

    await handleCompletions(fakeRequest(JSON.stringify({ model: 'auto', messages: 'oops' })), res)

    expect(getStatus()).toBe(400)
    expect(JSON.parse(getBody()).error).toMatch(/messages/)
  })
})
