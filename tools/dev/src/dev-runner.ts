// `pnpm dev` and `pnpm dev:desktop` (docs/DESKTOP.md § Dev workflow). Picks this checkout's port, puts it in the
// environment (PORT, HOST, VITE_DEV_SERVER_URL), then runs the packages' `dev` tasks through turbo. apps/web's Vite
// listens there with a strict port; in desktop mode apps/desktop's watch build runs Electron against it.
//
// PORT=4000 pnpm dev overrides the port.
import { execFileSync, spawn } from "node:child_process"
import { devPort } from "./devPort.ts"

const modes = {
  dev: { filters: ["@ballest/web"], host: "localhost" },
  // The window reaches Vite through main's net.fetch; an explicit IPv4 address avoids localhost resolving to ::1.
  "dev:desktop": { filters: ["@ballest/web", "@ballest/desktop"], host: "127.0.0.1" }
} as const

const isMode = (name: string): name is keyof typeof modes => Object.hasOwn(modes, name)

const [modeName = "", ...turboArgs] = process.argv.slice(2)
if (!isMode(modeName)) {
  console.error(`usage: dev-runner.ts <${Object.keys(modes).join("|")}> [turbo args]`)
  process.exit(2)
}
const mode = modes[modeName]

const git = (...args: ReadonlyArray<string>) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()

/** The top of this checkout when it is a linked worktree (`git worktree add`); undefined for the main one. */
const linkedWorktree = (): string | undefined => {
  try {
    const [gitDir, commonDir] = git("rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir").split("\n")
    return gitDir === commonDir ? undefined : git("rev-parse", "--show-toplevel")
  } catch {
    // Not a git checkout (a source tarball): the main port.
    return undefined
  }
}

const worktree = linkedWorktree()
const port = process.env["PORT"] === undefined ? devPort(worktree) : Number(process.env["PORT"])
const url = `http://${mode.host}:${port}/`
console.log(`[dev-runner] ${modeName} on ${url}${worktree === undefined ? "" : ` (worktree ${worktree})`}`)

// Loose env mode: the tasks need the variables above, and Electron needs the desktop session's (WAYLAND_DISPLAY,
// XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS, APPDATA, ...). Turbo's strict mode strips both; nothing here is cached.
const windows = process.platform === "win32"
const child = spawn(
  "turbo",
  ["run", "dev", ...mode.filters.map((filter) => `--filter=${filter}`), "--env-mode=loose", ...turboArgs],
  {
    stdio: "inherit",
    env: { ...process.env, PORT: String(port), HOST: mode.host, VITE_DEV_SERVER_URL: url },
    // turbo is a .cmd shim on Windows, which only a shell can run.
    shell: windows,
    // Its own process group, signalled as a whole below: turbo's Node shim runs the real binary synchronously and
    // passes no signal on. (On Windows, Ctrl+C reaches every process on the console, and detached means a new one.)
    detached: !windows
  }
)
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    if (windows || child.pid === undefined) child.kill(signal)
    else process.kill(-child.pid, signal)
  })
}
child.on("error", (error) => {
  // turbo is on PATH only inside a pnpm script.
  console.error(`[dev-runner] could not run turbo (${error.message}); start this with \`pnpm ${modeName}\``)
  process.exit(1)
})
child.on("exit", (code, signal) => process.exit(signal === null ? (code ?? 0) : 1))
