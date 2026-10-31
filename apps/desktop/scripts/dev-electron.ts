// The Electron half of `pnpm dev:desktop` (docs/DESKTOP.md § Dev workflow). `vite build --watch` starts it after its
// first build. It waits for both bundles and the renderer's Vite dev server, runs Electron against that server, and
// restarts it whenever main.cjs or preload.cjs is rewritten. Renderer edits don't come through here: Vite hot-reloads
// them through the ballest-dev:// proxy.
//
// BALLEST_REMOTE_DEBUGGING_PORT=9222 opens the window to Chrome DevTools Protocol clients on that port.
import { type ChildProcess, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as net from "node:net"
import * as path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { desktopDir, electronEnv, electronPath } from "./electron.ts"

const log = (message: string) => console.log(`[dev-electron] ${message}`)
const fail = (message: string): never => {
  console.error(`[dev-electron] ${message}`)
  process.exit(1)
}

// Set by tools/dev/src/dev-runner.ts to this checkout's port; apps/web's Vite listens there with a strict port.
const devServerUrl = new URL(
  process.env["VITE_DEV_SERVER_URL"] ?? fail("VITE_DEV_SERVER_URL is not set: run `pnpm dev:desktop` from the root")
)
const bundleDir = path.join(desktopDir, "dist-electron")
const bundles = new Set(["main.cjs", "preload.cjs"])
const remoteDebuggingPort = process.env["BALLEST_REMOTE_DEBUGGING_PORT"]?.trim()
/**
 * The dev profile (localStorage, window bounds) lives in the checkout, so worktrees running side by side don't
 * share one: Chromium locks its storage to the first process that opens it.
 */
const userData = path.join(desktopDir, ".dev-user-data")

const restartDebounceMs = 120
const forcedShutdownMs = 1_500
const waitTimeoutMs = 120_000

const portIsOpen = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 500 })
    const finish = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.once("connect", () => finish(true))
    socket.once("timeout", () => finish(false))
    socket.once("error", () => finish(false))
  })

/** Polls every 100 ms until both bundles exist and the dev server accepts connections. */
const waitForResources = async (startedAt = Date.now()): Promise<void> => {
  const port = Number(devServerUrl.port || (devServerUrl.protocol === "https:" ? 443 : 80))
  const pending = [...bundles].filter((name) => !fs.existsSync(path.join(bundleDir, name)))
  if (!(await portIsOpen(devServerUrl.hostname, port))) pending.push(devServerUrl.host)
  if (pending.length === 0) return
  if (Date.now() - startedAt > waitTimeoutMs) {
    fail(`timed out after ${waitTimeoutMs / 1000} s waiting for ${pending.join(", ")}`)
  }
  await sleep(100)
  return waitForResources(startedAt)
}

let shuttingDown = false
/** The running Electron, if any. */
let current: ChildProcess | null = null
let restartTimer: NodeJS.Timeout | undefined
/** Restarts run one after another, so a burst of rebuilds never leaves two windows open. */
let restartQueue = Promise.resolve()

const start = () => {
  const args = [...(remoteDebuggingPort ? [`--remote-debugging-port=${remoteDebuggingPort}`] : []), desktopDir]
  const child = spawn(electronPath, args, {
    cwd: desktopDir,
    stdio: "inherit",
    env: electronEnv({ VITE_DEV_SERVER_URL: devServerUrl.href, BALLEST_USER_DATA_DIR: userData })
  })
  current = child
  child.once("exit", (code, signal) => {
    if (current !== child) return
    current = null
    // Not restarted here: a main process that fails at startup would bring its error box back in a loop.
    if (!shuttingDown) {
      log(`Electron exited (${signal ?? code}); it starts again on the next rebuild of main or preload`)
    }
  })
}

/** SIGTERM lets main save the window bounds on its way out; SIGKILL if it hasn't exited in time. */
const stop = () => {
  const child = current
  if (child === null) return Promise.resolve()
  current = null
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), forcedShutdownMs)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill("SIGTERM")
  })
}

const scheduleRestart = () => {
  if (shuttingDown) return
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartQueue = restartQueue.then(async () => {
      await stop()
      if (!shuttingDown) {
        log("bundle changed, restarting Electron")
        start()
      }
    })
  }, restartDebounceMs)
}

const shutdown = async (exitCode: number) => {
  if (shuttingDown) return
  shuttingDown = true
  clearTimeout(restartTimer)
  await restartQueue
  await stop()
  process.exit(exitCode)
}

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) {
  process.once(signal, () => void shutdown(code))
}
// Started by vite with an IPC channel: when vite goes away (Ctrl+C, turbo stopping the task), so does Electron.
process.once("disconnect", () => void shutdown(0))

await waitForResources()
fs.watch(bundleDir, (_event, filename) => {
  if (filename !== null && bundles.has(filename)) scheduleRestart()
})
log(`starting Electron against ${devServerUrl.href}`)
start()
