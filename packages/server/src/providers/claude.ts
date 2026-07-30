import { spawnSync, SpawnSyncOptionsWithStringEncoding } from 'child_process'

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

const IS_WINDOWS = process.platform === 'win32'
const WHICH_COMMAND = IS_WINDOWS ? 'where' : 'which'

function quoteArgWindows(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`
}

function run(command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) {
  if (IS_WINDOWS) {
    const commandLine = [command, ...args].map(quoteArgWindows).join(' ')
    return spawnSync(commandLine, { ...options, shell: true })
  }
  return spawnSync(command, args, options)
}

export function checkClaudeInstalled(): boolean {
  const result = run(WHICH_COMMAND, ['claude'], { encoding: 'utf8' })
  return result.status === 0
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

export function callClaude(prompt: string, model?: string): ClaudeResponse {
  if (!checkClaudeInstalled()) {
    throw new Error(INSTALL_INSTRUCTIONS)
  }

  const args = ['-p', prompt, '--output-format', 'json']

  if (model && model !== 'auto') {
    args.push('--model', model)
  }

  const result = run('claude', args, {
    encoding: 'utf8',
    timeout: 30000
  })

  if (result.status !== 0 || result.signal) {
    throw new Error(`Claude CLI error: ${result.stderr || result.signal}`)
  }

  return JSON.parse(result.stdout)
}
