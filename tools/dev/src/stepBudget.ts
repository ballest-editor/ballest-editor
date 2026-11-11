/**
 * How `pnpm check:changed` shares the machine: its steps run side by side within a budget of slots sized from the
 * cores and the memory free when it starts, each step holding one slot per worker it runs, and a step that runs past
 * its timeout is killed with its whole process group.
 */
import { type ChildProcess, spawn } from "node:child_process"

const GiB = 1024 ** 3

/**
 * One slot per two cores and per 3 GiB of available memory, and at least one. A whole run on an apps/web change, every
 * step at once, peaked at 2.4 GB; T3 Code's 6 GiB per slot would hold this 24-thread, 30 GB machine to two.
 */
export const defaultBudget = (cores: number, availableBytes: number): number =>
  Math.max(1, Math.min(Math.floor(cores / 2), Math.floor(availableBytes / (3 * GiB))))

export type Outcome = "pass" | "FAIL" | "TIMEOUT"

export interface StepResult {
  readonly outcome: Outcome
  readonly output: string
}

export interface Step {
  readonly name: string
  /** Slots the step wants, one per worker it runs in parallel; it gets at most the whole budget. */
  readonly weight: number
  /** Runs the step with the slots it was given, which it passes on as its worker count. */
  readonly run: (slots: number) => Promise<StepResult>
}

export interface Finished {
  readonly name: string
  readonly slots: number
  readonly outcome: Outcome
  readonly output: string
  readonly seconds: number
}

/**
 * Runs every step as soon as the budget has room for it, in order: a light step never takes free slots ahead of a
 * heavier one that is waiting, which would hold typecheck back behind everything after it. `onFinish` sees each step
 * as it ends.
 */
export const runSteps = (
  steps: ReadonlyArray<Step>,
  budget: number,
  onFinish: (finished: Finished) => void = () => {}
): Promise<ReadonlyArray<Finished>> => {
  let free = budget
  const waiting: Array<{ readonly slots: number; readonly admit: () => void }> = []
  const admit = () => {
    for (let next = waiting[0]; next !== undefined && next.slots <= free; next = waiting[0]) {
      waiting.shift()
      free -= next.slots
      next.admit()
    }
  }
  return Promise.all(steps.map(async (step) => {
    const slots = Math.max(1, Math.min(step.weight, budget))
    await new Promise<void>((resolve) => {
      waiting.push({ slots, admit: resolve })
      admit()
    })
    const started = Date.now()
    try {
      const result = await step.run(slots)
      const finished = { name: step.name, slots, ...result, seconds: (Date.now() - started) / 1000 }
      onFinish(finished)
      return finished
    } finally {
      free += slots
      admit()
    }
  }))
}

const running = new Set<ChildProcess>()

const killGroup = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    // Already gone.
  }
}

/** Stops every process {@link runProcess} started and hasn't seen end, for a run that is being interrupted. */
export const killRunning = (signal: NodeJS.Signals = "SIGTERM") => {
  for (const child of running) killGroup(child, signal)
}

/**
 * Runs a command in a process group of its own, output collected, and at `timeoutMs` sends the group SIGTERM, then
 * SIGKILL 5 s later: pnpm, turbo and vitest each start processes of their own, which killing the first would leave
 * running.
 */
export const runProcess = (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly env?: NodeJS.ProcessEnv; readonly timeoutMs: number }
): Promise<StepResult> =>
  new Promise((resolve) => {
    const child = spawn(command, args, { env: options.env, stdio: ["ignore", "pipe", "pipe"], detached: true })
    running.add(child)
    let output = ""
    let timedOut = false
    child.stdout.on("data", (chunk) => (output += String(chunk)))
    child.stderr.on("data", (chunk) => (output += String(chunk)))
    const timer = setTimeout(() => {
      timedOut = true
      killGroup(child, "SIGTERM")
      setTimeout(() => killGroup(child, "SIGKILL"), 5000).unref()
    }, options.timeoutMs)
    const end = (outcome: Outcome) => {
      clearTimeout(timer)
      running.delete(child)
      resolve({ outcome, output })
    }
    child.on("error", (error) => {
      output += error.message
      end("FAIL")
    })
    child.on("close", (code) => end(timedOut ? "TIMEOUT" : code === 0 ? "pass" : "FAIL"))
  })
