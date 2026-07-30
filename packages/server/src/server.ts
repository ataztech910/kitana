import { createServer, IncomingMessage, ServerResponse } from 'http'
import { handleCompletions } from './handlers/completions'
import { checkClaudeInstalled, checkClaudeAuth, ensureClaudeInstalled, ensureClaudeLoggedIn } from './providers/claude'

const PORT = Number(process.env.PORT) || 4141
const RUN_ID = `${Date.now()}-${process.pid}`

async function main() {
  const installed = await ensureClaudeInstalled()
  if (!installed) {
    console.log('Kitana server not started: cannot run without Claude CLI.')
    process.exit(1)
  }

  const loggedIn = ensureClaudeLoggedIn()
  if (!loggedIn) {
    console.log('Kitana server not started: requests will fail without Claude sign-in.')
    process.exit(1)
  }

  startServer()
}

function startServer() {
const server = createServer(async (req, res) => {
  try {
    await handleRequest(req, res)
  } catch (e) {
    console.log(`[server] unhandled error: ${(e as Error).message}`)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  }
})

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = req.url || ''
  const method = req.method || ''

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (method === 'POST' && url === '/v1/chat/completions') {
    await handleCompletions(req, res)
    return
  }

  if (method === 'GET' && url === '/health') {
    const installed = checkClaudeInstalled()
    const auth = installed ? checkClaudeAuth() : { loggedIn: false, subscriptionType: null }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      provider: 'claude',
      runId: RUN_ID,
      claudeInstalled: installed,
      claudeLoggedIn: auth.loggedIn,
      subscriptionType: auth.subscriptionType
    }))
    return
  }

  if (method === 'GET' && url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'auto', object: 'model' },
        { id: 'claude-sonnet-4-6', object: 'model' },
        { id: 'claude-haiku-4-5-20251001', object: 'model' }
      ]
    }))
    return
  }

  res.writeHead(404)
  res.end('Not found')
}

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use by another process.`)
    console.log(`Free it up or use a different port: PORT=4142 pnpm --filter @kitana-sdk/server dev`)
    process.exit(1)
  }
  throw err
})

server.listen(PORT, () => {
  const installed = checkClaudeInstalled()
  console.log(`Kitana server running on http://localhost:${PORT} (run ${RUN_ID})`)
  console.log(`Claude CLI installed: ${installed}`)
  if (installed) {
    const auth = checkClaudeAuth()
    console.log(`Claude logged in: ${auth.loggedIn}, subscription: ${auth.subscriptionType}`)
  }
})
}

main()
