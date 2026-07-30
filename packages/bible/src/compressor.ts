import { createRouter } from '@kitana-sdk/core'
import { CompressOptions, Snapshot } from './types'

let sharedRouter: ReturnType<typeof createRouter> | undefined

function getRouter() {
  if (!sharedRouter) {
    sharedRouter = createRouter({ chain: ['claude', 'ollama', 'api-key'] })
  }
  return sharedRouter
}

function formatEntryPlain(snapshot: Snapshot): string {
  return `[${snapshot.step}] (${snapshot.provider}, ${snapshot.tokensUsed} tokens): ${snapshot.result.summary}`
}

function compressLastN(snapshots: Snapshot[], lastN: number): string {
  const picked = snapshots.slice(-lastN)
  return picked.map(formatEntryPlain).join('\n')
}

async function compressViaModel(
  snapshots: Snapshot[],
  targetTokens: number,
  strategy: 'facts-only' | 'summary'
): Promise<string> {
  const fullText = snapshots.map(formatEntryPlain).join('\n')

  const instruction = strategy === 'facts-only'
    ? `Compress the following project progress log to fit within ${targetTokens} tokens. Keep only concrete facts, numbers, and decisions. Remove filler words and explanations.`
    : `Summarize each step of the following project progress log in one short sentence, to fit within ${targetTokens} tokens total.`

  const router = getRouter()
  const response = await router.complete({
    messages: [{ role: 'user', content: `${instruction}\n\n${fullText}` }]
  })

  return response.content
}

export async function compress(
  snapshots: Snapshot[],
  options: CompressOptions
): Promise<string> {
  if (snapshots.length === 0) return ''

  if (options.strategy === 'last-n') {
    return compressLastN(snapshots, options.lastN ?? 3)
  }

  return compressViaModel(snapshots, options.targetTokens, options.strategy)
}
