export interface BibleContext {
  mission: string
  progress: string
  lastStep: string | null
  snapshots: string[]
}

export interface UpdateStepInput {
  step: string
  stepIndex: number
  result: { summary: string; raw?: string; data?: unknown }
  tokensUsed: number
  provider: string
}

export type CompressStrategy = 'facts-only' | 'summary' | 'last-n'

export interface CompressOptions {
  targetTokens: number
  strategy: CompressStrategy
  lastN?: number
}

export interface Snapshot {
  step: string
  stepIndex: number
  timestamp: string
  provider: string
  tokensUsed: number
  result: UpdateStepInput['result']
}
