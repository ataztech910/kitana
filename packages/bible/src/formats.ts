import { Snapshot } from './types'

export function formatProgressEntry(snapshot: Snapshot): string {
  return [
    `## Step ${snapshot.stepIndex} — ${snapshot.step} [${snapshot.timestamp}]`,
    `Provider: ${snapshot.provider}`,
    `Tokens: ${snapshot.tokensUsed}`,
    `Status: completed`,
    `Summary: ${snapshot.result.summary}`,
    ''
  ].join('\n')
}

export interface ParsedProgressEntry {
  stepIndex: number
  step: string
  timestamp: string
  provider: string
  tokens: number
  status: string
  summary: string
}

const ENTRY_HEADER_RE = /^## Step (\d+) — (.+?) \[(.+?)\]$/

export function parseProgress(content: string): ParsedProgressEntry[] {
  const entries: ParsedProgressEntry[] = []
  const blocks = content.split(/\n(?=## Step )/).map(b => b.trim()).filter(Boolean)

  for (const block of blocks) {
    const lines = block.split('\n')
    const headerMatch = lines[0]?.match(ENTRY_HEADER_RE)
    if (!headerMatch) continue

    const [, stepIndexStr, step, timestamp] = headerMatch
    const provider = lines.find(l => l.startsWith('Provider:'))?.slice('Provider:'.length).trim() ?? ''
    const tokensStr = lines.find(l => l.startsWith('Tokens:'))?.slice('Tokens:'.length).trim() ?? '0'
    const status = lines.find(l => l.startsWith('Status:'))?.slice('Status:'.length).trim() ?? ''
    const summary = lines.find(l => l.startsWith('Summary:'))?.slice('Summary:'.length).trim() ?? ''

    entries.push({
      stepIndex: Number(stepIndexStr),
      step,
      timestamp,
      provider,
      tokens: Number(tokensStr) || 0,
      status,
      summary
    })
  }

  return entries
}
