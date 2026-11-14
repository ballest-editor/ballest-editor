// Runs this tool's jobs as child processes, a few at a time: one fit a process, so a crash or a leak in one costs
// only that one, and the cores are shared.
import { spawn } from "node:child_process"

/**
 * Runs `script` once for each of `jobs`, `slots` at a time, with the arguments `argsOf` gives it. Returns the names of
 * the jobs whose child failed.
 */
export const runChildren = async <Job>(
  script: string,
  jobs: ReadonlyArray<Job>,
  slots: number,
  nameOf: (job: Job) => string,
  argsOf: (job: Job) => ReadonlyArray<string>
): Promise<ReadonlyArray<string>> => {
  const waiting = [...jobs]
  const failed: Array<string> = []
  let done = 0
  /** One slot: a child at a time for as long as jobs wait. */
  const slot = async (): Promise<void> => {
    const job = waiting.shift()
    if (job === undefined) return
    const code = await new Promise<number | null>((resolve) => {
      spawn(process.execPath, [...process.execArgv, script, ...argsOf(job)], { stdio: "inherit" }).on("close", resolve)
    })
    if (code !== 0) failed.push(nameOf(job))
    console.error(`${++done}/${jobs.length} ${nameOf(job)}${code === 0 ? "" : ` failed (${code})`}`)
    return slot()
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.floor(slots) || 1) }, slot))
  return failed
}
