import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { isBinaryAvailable, run, spawnAsync } from '../platform'

// Kitana is a proxy ("only send a prompt, get an answer back"), not an agent —
// callers (e.g. an ADK LlmAgent) expect a plain text completion. Without the
// two lines below, `claude -p` still runs as full Claude Code: it inherits the
// caller's cwd, so its system prompt bakes in *that* project's git status/env
// info (the model ends up commenting on the caller's uncommitted changes even
// when asked something unrelated), and it keeps default tool access
// (Bash/Edit/...), so it can act on the caller's filesystem instead of just
// answering. `--bare` would also strip this, but it forces API-key-only auth
// and drops OAuth/subscription login — not an option for a no-API-key proxy.
const NEUTRAL_CWD = tmpdir()
const DISALLOWED_TOOLS =
  'Bash Read Write Edit Glob Grep WebFetch WebSearch NotebookEdit Task TodoWrite'

async function withSystemPromptFile<T>(
  systemPrompt: string | undefined,
  fn: (extraArgs: string[]) => Promise<T>
): Promise<T> {
  if (!systemPrompt) return fn([])

  const file = join(tmpdir(), `kitana-system-prompt-${process.pid}-${Math.random().toString(36).slice(2)}.txt`)
  writeFileSync(file, systemPrompt, 'utf8')

  try {
    return await fn(['--append-system-prompt-file', file])
  } finally {
    try { unlinkSync(file) } catch { /* best effort cleanup */ }
  }
}

export interface ClaudeResponse {
  type: string
  result: string
  total_cost_usd: number
  usage: {
    input_tokens: number
    output_tokens: number
  }
  modelUsage: Record<string, {
    inputTokens: number
    outputTokens: number
    costUSD: number
  }>
}

export function checkClaudeInstalled(): boolean {
  return isBinaryAvailable('claude')
}

export function checkClaudeAuth(): { loggedIn: boolean; subscriptionType: string | null; email?: string } {
  const result = run('claude', ['auth', 'status'], { encoding: 'utf8', timeout: 10000 })

  if (result.status !== 0 || !result.stdout) {
    return { loggedIn: false, subscriptionType: null }
  }

  try {
    const status = JSON.parse(result.stdout)
    return {
      loggedIn: Boolean(status.loggedIn),
      subscriptionType: status.subscriptionType ?? null,
      email: status.email
    }
  } catch {
    return { loggedIn: false, subscriptionType: null }
  }
}

const INSTALL_INSTRUCTIONS = `Claude CLI not found in PATH.

Install:
  npm install -g @anthropic-ai/claude-code

After installing, sign in:
  claude auth login

Then restart the Kitana server.`

export async function ensureClaudeInstalled(): Promise<boolean> {
  if (checkClaudeInstalled()) return true

  console.log('Claude CLI not found. Installing @anthropic-ai/claude-code...')
  const result = run('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
    encoding: 'utf8',
    stdio: 'inherit'
  })

  if (result.status !== 0) {
    console.log('Automatic install failed. Install manually: npm install -g @anthropic-ai/claude-code')
    return false
  }

  if (!checkClaudeInstalled()) {
    console.log('Install finished, but claude is still not found in PATH. You may need to restart your terminal.')
    return false
  }

  console.log('Claude CLI installed.')
  return true
}

export function ensureClaudeLoggedIn(): boolean {
  const auth = checkClaudeAuth()
  if (auth.loggedIn) return true

  console.log('Not signed in to Claude CLI. Running claude auth login...')
  const result = run('claude', ['auth', 'login'], {
    encoding: 'utf8',
    stdio: 'inherit'
  })

  if (result.status !== 0) {
    console.log('Sign-in did not complete. Run manually: claude auth login')
    return false
  }

  return checkClaudeAuth().loggedIn
}

export async function callClaude(prompt: string, model?: string, systemPrompt?: string): Promise<ClaudeResponse> {
  if (!checkClaudeInstalled()) {
    throw new Error(INSTALL_INSTRUCTIONS)
  }

  return withSystemPromptFile(systemPrompt, extraArgs => new Promise((resolve, reject) => {
    const args = [
      '-p', '--output-format', 'json',
      '--disallowedTools', DISALLOWED_TOOLS,
      ...extraArgs
    ]

    if (model && model !== 'auto') {
      args.push('--model', model)
    }

    const child = spawnAsync('claude', args, { cwd: NEUTRAL_CWD, timeout: 120000 })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code !== 0 || signal) {
        reject(new Error(`Claude CLI error: ${stderr.trim() || signal || `exit ${code}`}`))
        return
      }

      try {
        resolve(JSON.parse(stdout) as ClaudeResponse)
      } catch (error) {
        reject(new Error(`Claude CLI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`))
      }
    })

    // Prompt goes via stdin, not as a CLI argument — a positional argument
    // containing newlines gets mangled by cmd.exe's line-based command parsing.
    child.stdin.end(prompt)
  }))
}

interface StreamJsonEvent {
  type: string
  event?: { type: string; delta?: { type: string; text?: string } }
  [key: string]: unknown
}

export function streamClaude(
  prompt: string,
  model: string | undefined,
  onDelta: (text: string) => void,
  systemPrompt?: string
): Promise<ClaudeResponse> {
  return new Promise((resolve, reject) => {
    if (!checkClaudeInstalled()) {
      reject(new Error(INSTALL_INSTRUCTIONS))
      return
    }

    let systemPromptFile: string | undefined
    if (systemPrompt) {
      systemPromptFile = join(tmpdir(), `kitana-system-prompt-${process.pid}-${Math.random().toString(36).slice(2)}.txt`)
      writeFileSync(systemPromptFile, systemPrompt, 'utf8')
    }

    const cleanup = () => {
      if (systemPromptFile) {
        try { unlinkSync(systemPromptFile) } catch { /* best effort cleanup */ }
      }
    }

    const args = [
      '-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
      '--disallowedTools', DISALLOWED_TOOLS
    ]

    if (systemPromptFile) {
      args.push('--append-system-prompt-file', systemPromptFile)
    }

    if (model && model !== 'auto') {
      args.push('--model', model)
    }

    const child = spawnAsync('claude', args, { cwd: NEUTRAL_CWD })
    let buffer = ''
    let stderr = ''
    let result: ClaudeResponse | undefined

    child.stdin.write(prompt)
    child.stdin.end()

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue

        let event: StreamJsonEvent
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }

        if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
          const text = event.event.delta?.text
          if (text) onDelta(text)
        }

        if (event.type === 'result') {
          result = event as unknown as ClaudeResponse
        }
      }
    })

    child.stderr.on('data', (chunk: string) => { stderr += chunk })

    child.on('error', e => { cleanup(); reject(e) })

    child.on('close', code => {
      cleanup()
      if (result) {
        resolve(result)
        return
      }
      reject(new Error(`Claude CLI error (exit ${code}): ${stderr || 'no result event received'}`))
    })
  })
}
