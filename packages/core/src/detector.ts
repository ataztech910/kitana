import { ClaudeDetectResult, CodexDetectResult, DetectResult, OllamaDetectResult } from './types'
import { isBinaryAvailable, run } from './platform'

async function detectClaude(): Promise<ClaudeDetectResult> {
  const available = isBinaryAvailable('claude')

  if (!available) {
    return { available: false, auth: { loggedIn: false, subscriptionType: null } }
  }

  const versionResult = run('claude', ['--version'], { encoding: 'utf8', timeout: 10000 })
  const version = versionResult.status === 0 ? versionResult.stdout.trim() : undefined

  const authResult = run('claude', ['auth', 'status'], { encoding: 'utf8', timeout: 10000 })
  let auth: ClaudeDetectResult['auth'] = { loggedIn: false, subscriptionType: null }

  if (authResult.status === 0 && authResult.stdout) {
    try {
      const status = JSON.parse(authResult.stdout)
      auth = {
        loggedIn: Boolean(status.loggedIn),
        subscriptionType: status.subscriptionType ?? null,
        email: status.email
      }
    } catch {
      // leave auth as default (not logged in)
    }
  }

  return { available: true, version, auth }
}

async function detectOllama(): Promise<OllamaDetectResult> {
  const available = isBinaryAvailable('ollama')

  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000)
    })
    if (res.ok) {
      const data = await res.json() as { models?: Array<{ name: string }> }
      const models = Array.isArray(data.models) ? data.models.map(m => m.name) : []
      return { available, running: true, models }
    }
  } catch {
    // ollama server not running
  }

  return { available, running: false, models: [] }
}

async function detectCodex(): Promise<CodexDetectResult> {
  const available = isBinaryAvailable('codex')

  if (!available) {
    return { available: false, auth: { loggedIn: false, mode: null } }
  }

  const versionResult = run('codex', ['--version'], { encoding: 'utf8', timeout: 10000 })
  const version = versionResult.status === 0 ? `${versionResult.stdout}${versionResult.stderr}`.trim() : undefined

  const authResult = run('codex', ['login', 'status'], { encoding: 'utf8', timeout: 10000 })
  const authText = `${authResult.stdout ?? ''}\n${authResult.stderr ?? ''}`

  let auth: CodexDetectResult['auth'] = { loggedIn: false, mode: null }
  if (authResult.status === 0) {
    if (/logged in using chatgpt/i.test(authText)) {
      auth = { loggedIn: true, mode: 'chatgpt' }
    } else if (/logged in using api key/i.test(authText)) {
      auth = { loggedIn: true, mode: 'api-key' }
    } else if (/logged in/i.test(authText)) {
      auth = { loggedIn: true, mode: 'unknown' }
    }
  }

  return { available: true, version, auth }
}

async function pingHttp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

export async function detect(): Promise<DetectResult> {
  const [claude, codex, ollama, lmstudio] = await Promise.all([
    detectClaude(),
    detectCodex(),
    detectOllama(),
    pingHttp('http://localhost:1234')
  ])

  return {
    providers: {
      claude,
      codex,
      ollama,
      openai: { available: false },
      gemini: { available: false }
    },
    httpServers: {
      ollama: { running: ollama.running, url: 'http://localhost:11434' },
      lmstudio: { running: lmstudio }
    }
  }
}
