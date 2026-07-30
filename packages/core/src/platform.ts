import { spawn, spawnSync, SpawnSyncOptionsWithStringEncoding, SpawnOptions, ChildProcessWithoutNullStreams } from 'child_process'

export const IS_WINDOWS = process.platform === 'win32'
export const WHICH_COMMAND = IS_WINDOWS ? 'where' : 'which'

function quoteArgWindows(arg: string): string {
  if (!/[\s"]/.test(arg)) return arg
  return `"${arg.replace(/"/g, '""')}"`
}

export function run(command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) {
  if (IS_WINDOWS) {
    const commandLine = [command, ...args].map(quoteArgWindows).join(' ')
    return spawnSync(commandLine, { ...options, shell: true })
  }
  return spawnSync(command, args, options)
}

export function spawnAsync(command: string, args: string[], options: SpawnOptions = {}): ChildProcessWithoutNullStreams {
  if (IS_WINDOWS) {
    const commandLine = [command, ...args].map(quoteArgWindows).join(' ')
    return spawn(commandLine, { ...options, shell: true }) as ChildProcessWithoutNullStreams
  }
  return spawn(command, args, options) as ChildProcessWithoutNullStreams
}

export function isBinaryAvailable(binary: string): boolean {
  return run(WHICH_COMMAND, [binary], { encoding: 'utf8', timeout: 10000 }).status === 0
}
