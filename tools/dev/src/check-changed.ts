// `pnpm check:changed [ref]`: the fast checks for what this branch changed, against its merge base with origin/main or
// with `ref`, uncommitted and untracked files included. Format and lint take the changed files, typecheck the affected
// packages and their dependents, tests only those the changes reach, knip and dupes the repo (turbo replays them when
// nothing they read changed). The build and the full suites stay with CI. Prints a line per check, and the output of
// what failed.
//
// Other agents share the machine. A run waits for one of two slots every worktree of this clone shares with the root
// turbo scripts (checkSlot.ts), then runs its checks side by side within a budget sized from the cores and the memory
// free (stepBudget.ts). Each check is killed with its process group after CHECK_CHANGED_TIMEOUT seconds (600);
// CHECK_CHANGED_BUDGET overrides the budget.
import { availableParallelism, totalmem } from "node:os"
import { formattedFiles, lintedFiles } from "./changedChecks.ts"
import { acquireCheckSlot } from "./checkSlot.ts"
import { git } from "./git.ts"
import { defaultBudget, killRunning, runProcess, runSteps, type Step } from "./stepBudget.ts"
import { linkTurboCache, sharedTurboCache } from "./turbo.ts"

const MAX_OUTPUT_LINES = 200
/** Workers one check may run in parallel: turbo's task concurrency, oxlint's threads, vitest's workers. */
const MAX_WORKERS = 4

const lines = (text: string) => text.split("\n").filter((line) => line.length > 0)
const envNumber = (name: string) => {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : undefined
}

const base = git("merge-base", "HEAD", process.argv[2] ?? "origin/main")
const existing = [
  ...lines(git("diff", "--name-only", "--diff-filter=d", base)),
  ...lines(git("ls-files", "--others", "--exclude-standard"))
]
const anythingChanged = existing.length > 0 || lines(git("diff", "--name-only", base)).length > 0

if (!anythingChanged) {
  console.log(`No changes against ${base.slice(0, 9)}.`)
  process.exit(0)
}

const waitStarted = Date.now()
linkTurboCache()
const slot = await acquireCheckSlot("pnpm check:changed")
const waited = (Date.now() - waitStarted) / 1000
if (waited >= 1) console.log(`Got check slot ${slot.index} after ${waited.toFixed(0)}s.`)
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    killRunning()
    slot.release()
    process.exit(130)
  })
}

// macOS counts its file cache as used, so its available memory would starve a large Mac. Elsewhere
// process.availableMemory() honours a cgroup limit.
const available = process.platform === "darwin" ? totalmem() : process.availableMemory()
const budget = envNumber("CHECK_CHANGED_BUDGET") ?? defaultBudget(availableParallelism(), available)
const timeoutMs = (envNumber("CHECK_CHANGED_TIMEOUT") ?? 600) * 1000
const env = { ...process.env, ...sharedTurboCache(), TURBO_SCM_BASE: base }

const pnpm = (args: ReadonlyArray<string>) => runProcess("pnpm", args, { env, timeoutMs })
const turbo = (slots: number, ...args: ReadonlyArray<string>) =>
  pnpm([
    "exec",
    "turbo",
    "run",
    "--continue",
    "--output-logs=errors-only",
    "--ui=stream",
    `--concurrency=${slots}`,
    ...args
  ])

const format = formattedFiles(existing)
const lint = lintedFiles(existing)

const steps: ReadonlyArray<Step> = [
  ...(format.length > 0
    ? [{
      name: "format",
      weight: 1,
      run: () => pnpm(["exec", "dprint", "check", "--allow-no-files", ...format])
    }]
    : []),
  ...(lint.length > 0
    ? [{ name: "lint", weight: 2, run: (slots: number) => pnpm(["lint:files", `--threads=${slots}`, ...lint]) }]
    : []),
  { name: "knip and dupes", weight: 2, run: (slots) => turbo(slots, "knip", "dupes") },
  { name: "typecheck", weight: MAX_WORKERS, run: (slots) => turbo(slots, "typecheck", "--affected") },
  {
    name: "tests",
    weight: MAX_WORKERS,
    // One package's suite at a time, with every slot as a vitest worker: several at once would multiply the workers.
    run: (slots) =>
      turbo(1, "test", "--affected", "--", `--changed=${base}`, "--passWithNoTests", `--maxWorkers=${slots}`)
  }
]

const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(0)
console.log(
  `Checking ${existing.length} changed files against ${base.slice(0, 9)}, ${budget} at a time ` +
    `(${availableParallelism()} cores, ${gib(available)} GiB free)`
)
const results = await runSteps(steps, budget, ({ name, outcome, output, seconds, slots }) => {
  const time = outcome === "TIMEOUT" ? `killed after ${timeoutMs / 1000}s` : `${seconds.toFixed(1)}s`
  console.log(`${outcome}  ${name}${slots > 1 ? ` (${slots} wide)` : ""}  ${time}`)
  const tail = lines(output).slice(-MAX_OUTPUT_LINES)
  if (outcome !== "pass" && tail.length > 0) console.log(tail.join("\n"))
})
slot.release()
if (results.some(({ outcome }) => outcome === "TIMEOUT")) {
  console.log("TIMEOUT means the check ran out of time, not that it failed. Raise CHECK_CHANGED_TIMEOUT.")
}
console.log("The build and the full test suites run in CI.")
process.exit(results.every(({ outcome }) => outcome === "pass") ? 0 : 1)
