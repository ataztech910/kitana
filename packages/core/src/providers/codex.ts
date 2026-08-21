import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { isBinaryAvailable, run, spawnAsync } from '../platform'

const NEUTRAL_CWD = tmpdir()

function buildPrompt(prompt: string, systemPrompt?: string): string {
  if (!systemPrompt) return prompt

  return [
    'System instructions:',
    systemPrompt,
    '',
    'User request:',
    prompt
  ].join('\n')
}

export function checkCodexInstalled(): boolean {
  return isBinaryAvailable('codex')
}

export function checkCodexAuth(): { loggedIn: boolean; mode: 'chatgpt' | 'api-key' | 'unknown' | null } {
  const result = run('codex', ['login', 'status'], { encoding: 'utf8', timeout: 10000 })

  if (result.status !== 0) {
    return { loggedIn: false, mode: null }
  }

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

  if (/logged in using chatgpt/i.test(output)) {
    return { loggedIn: true, mode: 'chatgpt' }
  }

  if (/logged in using api key/i.test(output)) {
    return { loggedIn: true, mode: 'api-key' }
  }

  if (/logged in/i.test(output)) {
    return { loggedIn: true, mode: 'unknown' }
  }

  return { loggedIn: false, mode: null }
}

const INSTALL_INSTRUCTIONS = `Codex CLI not found in PATH.

Install:
  npm install -g @openai/codex

After installing, sign in:
  codex login

Then retry the Kitana request.`

function codexArgs(outputFile: string, model?: string): string[] {
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'read-only',
    '--color', 'never',
    '--cd', NEUTRAL_CWD,
    '--output-last-message', outputFile,
    '-'
  ]

  if (model && model !== 'auto') {
    args.splice(1, 0, '--model', model)
  }

  return args
}

export interface CodexResponse {
  result: string
  model: string
}

export async function callCodex(prompt: string, model?: string, systemPrompt?: string): Promise<CodexResponse> {
  if (!checkCodexInstalled()) {
    throw new Error(INSTALL_INSTRUCTIONS)
  }

  const auth = checkCodexAuth()
  if (!auth.loggedIn) {
    throw new Error('Not signed in to Codex CLI. Run: codex login')
  }

  const scratchDir = mkdtempSync(join(tmpdir(), 'kitana-codex-'))
  const outputFile = join(scratchDir, 'last-message.txt')
  const finalPrompt = buildPrompt(prompt, systemPrompt)

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawnAsync('codex', codexArgs(outputFile, model), {
        cwd: NEUTRAL_CWD,
        timeout: 120000
      })
      let stdout = ''
      let stderr = ''

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { stdout += chunk })
      child.stderr.on('data', (chunk: string) => { stderr += chunk })
      child.on('error', reject)
      child.on('close', (code, signal) => {
        if (code !== 0 || signal) {
          const details = [stdout, stderr, signal].filter(Boolean).join('\n').trim()
          reject(new Error(`Codex CLI error: ${details || `exit ${code}`}`))
          return
        }
        resolve()
      })

      child.stdin.end(finalPrompt)
    })

    const text = readFileSync(outputFile, 'utf8').trim()
    return {
      result: text,
      model: model && model !== 'auto' ? model : 'codex'
    }
  } finally {
    rmSync(scratchDir, { recursive: true, force: true })
  }
}

export async function streamCodex(
  prompt: string,
  model: string | undefined,
  onDelta: (text: string) => void,
  systemPrompt?: string
): Promise<CodexResponse> {
  const result = await callCodex(prompt, model, systemPrompt)
  if (result.result) onDelta(result.result)
  return result
}
