import { mkdir, readFile, writeFile, appendFile, readdir, access } from 'fs/promises'
import { join } from 'path'
import { BibleContext, CompressOptions, Snapshot, UpdateStepInput } from './types'
import { formatProgressEntry, parseProgress } from './formats'
import { compress } from './compressor'

export interface BibleOptions {
  path: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export class Bible {
  private readonly bibleDir: string
  private readonly missionPath: string
  private readonly progressPath: string
  private readonly snapshotsDir: string

  constructor(options: BibleOptions) {
    this.bibleDir = join(options.path, 'bible')
    this.missionPath = join(this.bibleDir, 'mission.md')
    this.progressPath = join(this.bibleDir, 'progress.md')
    this.snapshotsDir = join(this.bibleDir, 'snapshots')
  }

  private async ensureDirs(): Promise<void> {
    await mkdir(this.snapshotsDir, { recursive: true })
  }

  async read(): Promise<BibleContext> {
    const mission = (await exists(this.missionPath))
      ? await readFile(this.missionPath, 'utf8')
      : ''

    const progress = (await exists(this.progressPath))
      ? await readFile(this.progressPath, 'utf8')
      : ''

    const entries = parseProgress(progress)
    const lastEntry = entries[entries.length - 1]

    const snapshots = (await exists(this.snapshotsDir))
      ? (await readdir(this.snapshotsDir)).filter(f => f.endsWith('.json')).sort()
      : []

    return {
      mission,
      progress,
      lastStep: lastEntry ? lastEntry.step : null,
      snapshots
    }
  }

  async update(input: UpdateStepInput): Promise<void> {
    await this.ensureDirs()

    const snapshot: Snapshot = {
      step: input.step,
      stepIndex: input.stepIndex,
      timestamp: new Date().toISOString(),
      provider: input.provider,
      tokensUsed: input.tokensUsed,
      result: input.result
    }

    const snapshotFile = join(
      this.snapshotsDir,
      `${String(input.stepIndex).padStart(2, '0')}_${input.step}.json`
    )
    await writeFile(snapshotFile, JSON.stringify(snapshot, null, 2), 'utf8')

    const entryText = formatProgressEntry(snapshot)
    const progressExists = await exists(this.progressPath)
    const prefix = progressExists ? '\n' : '# Progress Log\n\n'
    await appendFile(this.progressPath, prefix + entryText, 'utf8')
  }

  async getSnapshot(index: number): Promise<Snapshot | null> {
    if (!(await exists(this.snapshotsDir))) return null

    const files = await readdir(this.snapshotsDir)
    const prefix = String(index).padStart(2, '0') + '_'
    const match = files.find(f => f.startsWith(prefix))
    if (!match) return null

    const raw = await readFile(join(this.snapshotsDir, match), 'utf8')
    return JSON.parse(raw)
  }

  private async getAllSnapshots(): Promise<Snapshot[]> {
    if (!(await exists(this.snapshotsDir))) return []

    const files = (await readdir(this.snapshotsDir)).filter(f => f.endsWith('.json')).sort()
    const snapshots = await Promise.all(
      files.map(async f => JSON.parse(await readFile(join(this.snapshotsDir, f), 'utf8')) as Snapshot)
    )
    return snapshots
  }

  async compress(options: CompressOptions): Promise<string> {
    const snapshots = await this.getAllSnapshots()
    return compress(snapshots, options)
  }
}
