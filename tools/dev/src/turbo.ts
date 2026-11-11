/** Running turbo from the repo's scripts, with the cache every worktree shares. */
import { spawn } from "node:child_process"
import { join } from "node:path"
import { gitCommonDir } from "./git.ts"

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
 * Runs turbo with the shared cache and `env` on top of this process's, and exits with it. `script` names the pnpm script
 * for the message when turbo isn't on PATH. With `ownGroup`, turbo gets a process group of its own, which a signal to
 * this process reaches as a whole: turbo's Node shim runs the real binary synchronously and passes no signal on. Without
 * it, turbo stays in the caller's group, so whatever stops that (Ctrl+C, an agent's shell) stops turbo too.
 */
export const runTurbo = (
  args: ReadonlyArray<string>,
  script: string,
  options: { readonly env?: NodeJS.ProcessEnv; readonly ownGroup?: boolean } = {}
) => {
  const windows = process.platform === "win32"
  // On Windows, Ctrl+C reaches every process on the console, and detached means a new one.
  const ownGroup = options.ownGroup === true && !windows
  const child = spawn("turbo", args, {
    stdio: "inherit",
    env: { ...process.env, ...sharedTurboCache(), ...options.env },
    // turbo is a .cmd shim on Windows, which only a shell can run.
    shell: windows,
    detached: ownGroup
  })
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      if (!ownGroup || child.pid === undefined) child.kill(signal)
      else process.kill(-child.pid, signal)
    })
  }
  child.on("error", (error) => {
    // turbo is on PATH only inside a pnpm script.
    console.error(`could not run turbo (${error.message}); start this with \`pnpm ${script}\``)
    process.exit(1)
  })
  child.on("exit", (code, signal) => process.exit(signal === null ? (code ?? 0) : 1))
}
