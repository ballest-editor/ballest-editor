/**
 * The slots `pnpm check:changed` runs in, shared by every worktree of this clone, so a third run waits while two are
 * going. Each slot is a file held with flock(1) by a child that lives as long as its stdin: when the run ends, however
 * it ends (SIGKILL included), the pipe closes, the child exits and the kernel lets the lock go. Nothing is left to
 * clean up.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export interface Slot {
  /** Which slot, from 1; undefined when flock(1) couldn't run and the run went ahead without one. */
  readonly index: number | undefined
  readonly release: () => void
}

const BUSY = 75

/** Holds `file` with flock(1) when it is free; undefined when another process holds it. */
const tryHold = (file: string): Promise<ChildProcess | undefined> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "flock",
      ["--nonblock", "--conflict-exit-code", String(BUSY), file, "sh", "-c", "echo held; exec cat"],
      { stdio: ["pipe", "pipe", "ignore"] }
    )
    child.stdout.once("data", () => resolve(child))
    child.on("error", reject)
    child.on("exit", (code) => code === BUSY ? resolve(undefined) : reject(new Error(`flock exited ${code}`)))
  })

/** Who holds the slot whose info file this is, as the waiting message names them. */
const holderOf = (file: string): string => {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return "starting"
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Takes the first free one of `slots` slots in `dir`, polling every `pollMs` while all are held. `onWait` is called
 * once, with who holds them, when the run has to wait.
 */
export const acquireSlot = (options: {
  readonly dir: string
  readonly slots: number
  readonly pollMs?: number
  readonly onWait?: (holders: ReadonlyArray<string>) => void
}): Promise<Slot> => {
  mkdirSync(options.dir, { recursive: true })
  const lock = (index: number) => join(options.dir, `slot-${index}.lock`)
  const info = (index: number) => join(options.dir, `slot-${index}.holder`)
  const indices = Array.from({ length: options.slots }, (_, i) => i + 1)

  /** The first free slot from `index` on, held; undefined when every one is taken. */
  const holdFrom = async (index: number): Promise<Slot | undefined> => {
    if (index > options.slots) return undefined
    const child = await tryHold(lock(index))
    if (child === undefined) return holdFrom(index + 1)
    writeFileSync(info(index), `pid ${process.pid} in ${process.cwd()}, since ${new Date().toLocaleTimeString()}`)
    return { index, release: () => child.stdin?.end() }
  }

  const poll = async (told: boolean): Promise<Slot> => {
    const slot = await holdFrom(1)
    if (slot !== undefined) return slot
    if (!told) options.onWait?.(indices.map((index) => holderOf(info(index))))
    await sleep(options.pollMs ?? 1000)
    return poll(true)
  }

  // No flock(1) here (macOS, Windows), or it can't take the file: run without a slot rather than not at all.
  return poll(false).catch(() => ({ index: undefined, release: () => {} }))
}
