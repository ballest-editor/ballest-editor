// oxlint-disable eslint/no-await-in-loop -- driving one browser is sequential: each step waits on the last
/**
 * The processes of one worktree: a Vite dev server, a headless Chromium and, for desktop states, Xvfb and Electron.
 * Everything lives under `<worktree>/.app-driver/`, ports and displays are picked free, and a process is only ever
 * stopped through the pid recorded here, after checking it carries this worktree's marker.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as net from "node:net"
import * as path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { parseJson } from "./cdp.ts"

export const repoRoot = path.resolve(import.meta.dirname, "../../..")
export const home = path.join(repoRoot, ".app-driver")
export const runsDir = path.join(home, "runs")
const sessionFile = path.join(home, "session.json")
const logsDir = path.join(home, "logs")
/** In the environment of every process started here: what proves a pid is still ours. */
const MARKER = `BALLEST_APP_DRIVER_HOME=${home}`

const SOFTWARE_GL = [
  "--use-angle=swiftshader",
  "--use-gl=angle",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist"
]
const REAL_GPU = [
  "--ignore-gpu-blocklist",
  "--enable-gpu",
  "--use-angle=gl-egl",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync"
]
const STABLE_RENDER = [
  "--force-device-scale-factor=1",
  "--font-render-hinting=none",
  "--hide-scrollbars",
  "--force-color-profile=srgb"
]

export interface Session {
  readonly server?: { readonly pid: number; readonly url: string }
  readonly browser?: { readonly pid: number; readonly ws: string; readonly gpu: boolean }
  readonly display?: { readonly pid: number; readonly number: number }
  /** The desktop app of the state running now: a run killed mid-state leaves it here for `stop`. */
  readonly desktop?: { readonly pid: number }
}

const readSession = (): Session => {
  try {
    return parseJson<Session>(fs.readFileSync(sessionFile, "utf8"))
  } catch {
    return {}
  }
}

const writeSession = (session: Session) => {
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2))
}

/**
 * Whether `pid` is alive and one of ours: a pid can be reused, and another worktree's folder differs. Some Chromium
 * wrappers clear the environment, so its command line, which names its profile here, counts too.
 */
const isOurs = (pid: number): boolean => {
  try {
    return [`/proc/${pid}/environ`, `/proc/${pid}/cmdline`].some((file) => fs.readFileSync(file, "utf8").includes(home))
  } catch {
    return false
  }
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() =>
        typeof address === "object" && address !== null ? resolve(address.port) : reject(new Error("no port"))
      )
    })
  })

const launch = (
  name: string,
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly fd3?: boolean } = {}
): ChildProcess => {
  fs.mkdirSync(logsDir, { recursive: true })
  const log = fs.openSync(path.join(logsDir, `${name}.log`), "w")
  const [key = "", value = ""] = MARKER.split("=")
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env, [key]: value },
    // Its own process group, so stopping it takes its children too, and it outlives this command between runs.
    detached: true,
    stdio: ["ignore", log, log, ...(options.fd3 === true ? ["pipe" as const] : [])]
  })
  child.unref()
  return child
}

const pidOf = (child: ChildProcess): number => {
  if (child.pid === undefined) throw new Error(`${child.spawnfile} didn't start`)
  return child.pid
}

/** Whether any process of the group is left: a leader can go first while its children still write to the profile. */
const groupAlive = (pid: number): boolean => {
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

const waitForGroup = async (pid: number) => {
  for (let i = 0; i < 30 && groupAlive(pid); i++) await sleep(100)
}

const stopGroup = async (pid: number) => {
  if (!isOurs(pid)) return
  try {
    process.kill(-pid, "SIGTERM")
    await waitForGroup(pid)
    if (groupAlive(pid)) process.kill(-pid, "SIGKILL")
    await waitForGroup(pid)
  } catch {
    // Already gone.
  }
}

const logTail = (name: string) => {
  try {
    return fs.readFileSync(path.join(logsDir, `${name}.log`), "utf8").slice(-800)
  } catch {
    return ""
  }
}

const waitFor = async (what: string, ready: () => Promise<boolean> | boolean, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await ready()) return
    await sleep(150)
  }
  throw new Error(`${what} wasn't ready in ${timeoutMs / 1000} s`)
}

/** This worktree's dev server: the running one, or a new one on a free port with a strict bind. */
export const ensureServer = async (): Promise<string> => {
  const session = readSession()
  if (session.server !== undefined && isOurs(session.server.pid)) return session.server.url
  if (!fs.existsSync(path.join(repoRoot, "web-assets"))) {
    execFileSync("pnpm", ["run", "assets"], { cwd: repoRoot, stdio: "ignore" })
  }
  const port = await freePort()
  const url = `http://127.0.0.1:${port}/`
  const child = launch("vite", path.join(repoRoot, "apps/web/node_modules/.bin/vite"), ["dev"], {
    cwd: path.join(repoRoot, "apps/web"),
    env: { PORT: String(port), HOST: "127.0.0.1" }
  })
  const pid = pidOf(child)
  await waitFor("the dev server", async () => {
    // `strictPort` ends the process when the port is taken: never go on to drive whatever answers there.
    if (child.exitCode !== null) throw new Error(`the dev server stopped: ${logTail("vite")}`)
    return fetch(url).then((response) => response.ok, () => false)
  }, 60_000)
  writeSession({ ...readSession(), server: { pid, url } })
  return url
}

const CHROMIUMS = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]

const findChromium = (): string => {
  const set = process.env["BALLEST_CHROMIUM"]
  if (set !== undefined) return set
  const dirs = (process.env["PATH"] ?? "").split(path.delimiter)
  const found = CHROMIUMS.flatMap((name) => dirs.map((dir) => path.join(dir, name))).find((file) => fs.existsSync(file))
  if (found === undefined) throw new Error(`no Chromium on PATH (${CHROMIUMS.join(", ")}); set BALLEST_CHROMIUM`)
  return found
}

/** Reads the debug port a browser picked for itself, from the file it writes into its profile. */
const debuggerUrl = async (profile: string, child: ChildProcess, what: string): Promise<string> => {
  const file = path.join(profile, "DevToolsActivePort")
  await waitFor(what, () => {
    if (child.exitCode !== null) throw new Error(`${what} stopped: ${logTail(what)}`)
    return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("\n")
  }, 30_000)
  const [port, wsPath] = fs.readFileSync(file, "utf8").trim().split("\n")
  return `ws://127.0.0.1:${port}${wsPath}`
}

/** This worktree's headless browser. `gpu` swaps software WebGL for the real GPU, for frame times only. */
export const ensureBrowser = async (gpu = false): Promise<string> => {
  const session = readSession()
  if (session.browser !== undefined && isOurs(session.browser.pid)) {
    if (session.browser.gpu === gpu) return session.browser.ws
    await stopGroup(session.browser.pid)
  }
  const profile = path.join(home, "chromium")
  fs.rmSync(profile, { recursive: true, force: true })
  fs.mkdirSync(profile, { recursive: true })
  const child = launch("chromium", findChromium(), [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--allow-file-access-from-files",
    ...(process.env["CI"] === undefined ? [] : ["--no-sandbox"]),
    ...(gpu ? REAL_GPU : SOFTWARE_GL),
    ...STABLE_RENDER,
    "about:blank"
  ])
  const pid = pidOf(child)
  const ws = await debuggerUrl(profile, child, "chromium")
  writeSession({ ...readSession(), browser: { pid, ws, gpu } })
  return ws
}

/** A private X display: a number Xvfb picks for itself, so two agents never meet on one. */
const ensureDisplay = async (): Promise<number> => {
  const session = readSession()
  if (session.display !== undefined && isOurs(session.display.pid)) return session.display.number
  const child = launch("xvfb", "Xvfb", ["-displayfd", "3", "-screen", "0", "2600x1500x24", "-nolisten", "tcp"], {
    fd3: true
  })
  const pid = pidOf(child)
  const number = await new Promise<number>((resolve, reject) => {
    const pipe = child.stdio[3]
    if (pipe === null || pipe === undefined) {
      reject(new Error("Xvfb has no display pipe"))
      return
    }
    const timer = setTimeout(() => reject(new Error("Xvfb gave no display")), 10_000)
    // Read to the end: Xvfb writes the number and the newline apart, and a pipe closed between them kills it.
    let text = ""
    pipe.on("data", (data) => {
      text += String(data)
    })
    pipe.once("end", () => {
      clearTimeout(timer)
      resolve(Number(text.trim()))
    })
  })
  writeSession({ ...readSession(), display: { pid, number } })
  return number
}

export interface DesktopApp {
  readonly ws: string
  /** Where `desktop.answerDialog` queues its answers. */
  readonly dialogs: string
  readonly stop: () => Promise<void>
}

/** Builds main and preload, once per run: the bundles on disk may be from another commit. */
export const buildDesktop = () => {
  execFileSync("pnpm", ["--filter", "@ballest/desktop", "build"], { cwd: repoRoot, stdio: "ignore" })
}

/**
 * The desktop app against this worktree's dev server, in a throwaway home: its settings, profile and documents all live
 * under `dir`, so a driven save never reaches the user's real folders.
 */
export const launchDesktop = async (serverUrl: string, dir: string): Promise<DesktopApp> => {
  const display = await ensureDisplay()
  const desktopDir = path.join(repoRoot, "apps/desktop")
  const electron: unknown = createRequire(path.join(desktopDir, "package.json"))("electron")
  if (typeof electron !== "string") throw new Error("require(\"electron\") did not return the binary's path")
  const userData = path.join(dir, "user-data")
  const config = path.join(dir, "config")
  const documents = path.join(dir, "Documents")
  for (const folder of [userData, config, documents]) fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(config, "user-dirs.dirs"), `XDG_DOCUMENTS_DIR="${documents}"\n`)
  const dialogs = path.join(dir, "dialogs.json")
  const { ELECTRON_RUN_AS_NODE: _node, WAYLAND_DISPLAY: _wayland, ...env } = process.env
  fs.mkdirSync(logsDir, { recursive: true })
  const log = fs.openSync(path.join(logsDir, "electron.log"), "w")
  const child = spawn(
    electron,
    [
      `--user-data-dir=${userData}`,
      "--remote-debugging-port=0",
      "--ozone-platform=x11",
      ...SOFTWARE_GL,
      ...STABLE_RENDER,
      ...(process.env["CI"] === undefined ? [] : ["--no-sandbox"]),
      "."
    ],
    {
      cwd: desktopDir,
      detached: true,
      stdio: ["ignore", log, log],
      env: {
        ...env,
        BALLEST_APP_DRIVER_HOME: home,
        DISPLAY: `:${display}`,
        HOME: dir,
        XDG_CONFIG_HOME: config,
        XDG_DATA_HOME: path.join(dir, "data"),
        VITE_DEV_SERVER_URL: serverUrl,
        BALLEST_USER_DATA_DIR: userData,
        BALLEST_DISABLE_AUTO_UPDATE: "1",
        BALLEST_APP_DRIVER_DIALOGS: dialogs
      }
    }
  )
  child.unref()
  const pid = pidOf(child)
  writeSession({ ...readSession(), desktop: { pid } })
  const ws = await debuggerUrl(userData, child, "electron")
  return {
    ws,
    dialogs,
    stop: async () => {
      await stopGroup(pid)
      const { desktop: _stopped, ...rest } = readSession()
      writeSession(rest)
    }
  }
}

/** Stops what this worktree started, and nothing else. Returns what it stopped. */
export const stopSession = async (): Promise<ReadonlyArray<string>> => {
  const session = readSession()
  const started = [
    ["server", session.server?.pid],
    ["browser", session.browser?.pid],
    ["display", session.display?.pid],
    ["desktop", session.desktop?.pid]
  ] as const
  const running = started.flatMap(([name, pid]) => pid !== undefined && isOurs(pid) ? [{ name, pid }] : [])
  for (const { pid } of running) await stopGroup(pid)
  fs.rmSync(sessionFile, { force: true })
  return running.map(({ name }) => name)
}

/** Whether a session was already up, so a command that had to start one knows to stop it. */
export const sessionRunning = (): boolean => {
  const session = readSession()
  return session.server !== undefined && isOurs(session.server.pid)
}
