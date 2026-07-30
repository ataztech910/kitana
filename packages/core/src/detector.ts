import { ClaudeDetectResult, DetectResult, OllamaDetectResult } from './types'
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

async function pingHttp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

export async function detect(): Promise<DetectResult> {
  const [claude, ollama, lmstudio] = await Promise.all([
    detectClaude(),
    detectOllama(),
    pingHttp('http://localhost:1234')
  ])

  return {
    providers: {
      claude,
      ollama,
      openai: { available: false },
      gemini: { available: false },
      codex: { available: isBinaryAvailable('codex') }
    },
    httpServers: {
      ollama: { running: ollama.running, url: 'http://localhost:11434' },
      lmstudio: { running: lmstudio }
    }
  }
}
