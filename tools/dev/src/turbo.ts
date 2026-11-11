/** Running turbo from the repo's scripts, with the cache every worktree shares. */
import { spawn } from "node:child_process"
import { lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { git, gitCommonDir } from "./git.ts"

/** Tasks a local turbo run starts at once, unless its arguments say otherwise. CI keeps turbo's default. */
export const LOCAL_CONCURRENCY = 4

/** `args` with `--concurrency=<n>` added before any `--` pass-through, unless they already set a concurrency. */
export const withConcurrency = (args: ReadonlyArray<string>, concurrency: number): ReadonlyArray<string> => {
  const passThrough = args.indexOf("--")
  const own = passThrough === -1 ? args : args.slice(0, passThrough)
  if (own.some((arg) => arg === "--concurrency" || arg.startsWith("--concurrency="))) return args
  const rest = passThrough === -1 ? [] : args.slice(passThrough)
  return [...own, `--concurrency=${concurrency}`, ...rest]
}

/**
 * One turbo cache for every worktree of this clone, under git's common dir, so a task one worktree ran replays in the
 * next instead of each starting cold in its own node_modules/.cache/turbo. The scripts that run turbo set it as
 * TURBO_CACHE_DIR, because agents T3 Code starts load no direnv or dev shell. CI and Vercel keep turbo.json's cacheDir,
 * which CI's cache step saves.
 */
export const sharedTurboCache = (env: NodeJS.ProcessEnv = process.env): { TURBO_CACHE_DIR?: string } => {
  if (env["TURBO_CACHE_DIR"] !== undefined || env["CI"] !== undefined) return {}
  try {
    return { TURBO_CACHE_DIR: join(gitCommonDir(), "turbo-cache") }
  } catch {
    // Not a git checkout (a source tarball): turbo.json's own.
    return {}
  }
}

/**
 * Makes `<root>/node_modules/.cache/turbo`, turbo.json's cacheDir, a link to the shared cache, so a bare `turbo` or
 * `pnpm exec turbo` in this worktree uses it too. What a cache from before held moves into the shared one. Does
 * nothing where `sharedTurboCache` does (CI, a TURBO_CACHE_DIR of your own, no git) and on Windows, and never fails
 * the command it runs for: a missing link only costs cache hits.
 */
export const linkTurboCache = (env: NodeJS.ProcessEnv = process.env, root?: string, sharedDir?: string) => {
  const own = sharedTurboCache(env).TURBO_CACHE_DIR
  if (own === undefined || process.platform === "win32") return
  const shared = sharedDir ?? own
  try {
    const local = join(root ?? git("rev-parse", "--show-toplevel"), "node_modules", ".cache", "turbo")
    const stat = lstatOrUndefined(local)
    if (stat?.isSymbolicLink() === true && readlinkSync(local) === shared) return
    mkdirSync(shared, { recursive: true })
    if (stat?.isSymbolicLink() === true) unlinkSync(local)
    else if (stat !== undefined) {
      for (const name of readdirSync(local)) {
        try {
          renameSync(join(local, name), join(shared, name))
        } catch {
          // Entries are only cache: one that can't move (another file system) is dropped.
        }
      }
      rmSync(local, { recursive: true, force: true })
    }
    mkdirSync(dirname(local), { recursive: true })
    symlinkSync(shared, local)
  } catch {
    // Another worktree's run made the link first, or the cache sits on another file system: turbo still runs.
  }
}

const lstatOrUndefined = (path: string) => {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

/**
 * Runs turbo with the shared cache and `env` on top of this process's, and exits with it. `script` names the pnpm script
 * for the message when turbo isn't on PATH. With `ownGroup`, turbo gets a process group of its own, which a signal to
 * this process reaches as a whole: turbo's Node shim runs the real binary synchronously and passes no signal on. Without
 * it, turbo stays in the caller's group, so whatever stops that (Ctrl+C, an agent's shell) stops turbo too. `quitOn` is
 * a signal that asks for a clean stop: turbo gets SIGTERM, and this process exits 0 once it has gone.
 */
export const runTurbo = (
  args: ReadonlyArray<string>,
  script: string,
  options: { readonly env?: NodeJS.ProcessEnv; readonly ownGroup?: boolean; readonly quitOn?: NodeJS.Signals } = {}
) => {
  const windows = process.platform === "win32"
  // On Windows, Ctrl+C reaches every process on the console, and detached means a new one.
  const ownGroup = options.ownGroup === true && !windows
  linkTurboCache()
  const child = spawn("turbo", args, {
    stdio: "inherit",
    env: { ...process.env, ...sharedTurboCache(), ...options.env },
    // turbo is a .cmd shim on Windows, which only a shell can run.
    shell: windows,
    detached: ownGroup
  })
  const forward = (signal: NodeJS.Signals) => {
    if (!ownGroup || child.pid === undefined) child.kill(signal)
    else process.kill(-child.pid, signal)
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => forward(signal))
  let quitting = false
  if (options.quitOn !== undefined) {
    process.on(options.quitOn, () => {
      quitting = true
      forward("SIGTERM")
    })
  }
  child.on("error", (error) => {
    // turbo is on PATH only inside a pnpm script.
    console.error(`could not run turbo (${error.message}); start this with \`pnpm ${script}\``)
    process.exit(1)
  })
  child.on("exit", (code, signal) => process.exit(quitting ? 0 : signal === null ? (code ?? 0) : 1))
}
