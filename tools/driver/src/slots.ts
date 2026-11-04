import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { spawn } from "node:child_process"
import { openSync } from "node:fs"
import { hostVersion, isReady, type SandboxState, sandboxState, tail } from "./hostLog.ts"
import { APP_ID, DriverPaths, savedIn, type SlotPaths, slotPaths } from "./paths.ts"
import { environMarker, GAME_USER_SETTINGS, gameArgs, launchEnv, type SlotMode, withVersionOverride } from "./prefix.ts"
import { PROBE_FILE, probeMap } from "./probe.ts"
import { STEAM_NOT_RUNNING, steamRunning } from "./steam.ts"

export class DriverError extends Schema.TaggedError<DriverError>()("DriverError", {
  message: Schema.String
}) {}

export const fail = (message: string) => new DriverError({ message })

/** A platform failure as a DriverError that says what was being done. */
export const io = <A>(effect: Effect.Effect<A, unknown>, what: string) =>
  effect.pipe(Effect.mapError((cause) => fail(`${what}: ${String(cause)}`)))

export interface SlotStatus {
  readonly slot: number
  /** Whether the Steam client is running; no slot starts without it. */
  readonly steam: boolean
  readonly running: boolean
  readonly ready: boolean
  readonly sandbox: SandboxState
  readonly hostVersion: string | null
  readonly dir: string
  readonly log: ReadonlyArray<string>
}

const SEEDED = ["SaveGames", "Ghosts", "UserSavedMaps", "UserSavedPlaylists"]
const READY_TIMEOUT_MS = 150_000

/**
 * The sandboxed copies (docs/DRIVER.md § Where it lives): `home/game` is a copy of the install with the host in it;
 * each slot is a Proton prefix cloned from the game's, with `sandbox.txt` for the host, the game's `-userdir` seeded
 * with the player's saves, and settings of its own. A slot is started with umu-run, detached, and stopped by killing
 * every process whose environment names its prefix.
 */
export class Slots extends Context.Service<Slots, {
  readonly paths: (slot: number) => SlotPaths
  /** Copies the game install into `home/game`; `host`, a folder with `version.dll` and `plugins/`, is laid over it. */
  readonly setup: (options: { readonly host?: string | undefined }) => Effect.Effect<string, DriverError>
  readonly start: (slot: number, mode: SlotMode) => Effect.Effect<SlotStatus, DriverError>
  readonly stop: (slot: number) => Effect.Effect<number, DriverError>
  readonly status: (slot: number) => Effect.Effect<SlotStatus, DriverError>
  readonly log: (slot: number, lines: number) => Effect.Effect<ReadonlyArray<string>, DriverError>
}>()("ballest/driver/Slots") {
  static readonly make = Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const driver = yield* DriverPaths

    const rsync = (from: string, to: string, excludes: ReadonlyArray<string>) =>
      Effect.gen(function*() {
        yield* io(fs.makeDirectory(to, { recursive: true }), `creating ${to}`)
        const args = ["-a", ...excludes.flatMap((e) => ["--exclude", e]), `${from}/`, `${to}/`]
        const code = yield* io(
          spawner.exitCode(ChildProcess.make("rsync", args, { stdout: "ignore", stderr: "inherit" })),
          "rsync"
        )
        if (code !== 0) return yield* fail(`rsync ${from} -> ${to} exited ${code}`)
      })

    const readLog = (slot: SlotPaths) => fs.readFileString(slot.hostLog).pipe(Effect.orElseSucceed(() => ""))

    /** The pids of every process of a slot: those whose environment carries its prefix. */
    const processes = (slot: SlotPaths) =>
      Effect.gen(function*() {
        // umu re-exports the prefix to the game's own processes with `/pfx/` appended (a link back to itself), so
        // the match is on the variable's start, not its whole value.
        const marker = environMarker(slot)
        const entries = yield* fs.readDirectory("/proc").pipe(Effect.orElseSucceed(() => [] as Array<string>))
        const pids = entries.filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)
        const found = yield* Effect.forEach(
          pids,
          (pid) =>
            fs.readFileString(`/proc/${pid}/environ`).pipe(
              Effect.map((environ) => environ.split("\0").some((v) => v.startsWith(marker)) ? [Number(pid)] : []),
              Effect.orElseSucceed(() => [] as Array<number>)
            ),
          { concurrency: 32 }
        )
        return found.flat()
      })

    const status = Effect.fn("Slots.status")(function*(n: number) {
      const slot = slotPaths(driver, path, n)
      const log = yield* readLog(slot)
      const running = (yield* processes(slot)).length > 0
      return {
        slot: n,
        steam: yield* steamRunning(fs),
        running,
        ready: running && isReady(log),
        sandbox: sandboxState(log),
        hostVersion: hostVersion(log),
        dir: slot.dir,
        log: tail(log, 12)
      } satisfies SlotStatus
    })

    const setup = Effect.fn("Slots.setup")(function*({ host }: { readonly host?: string | undefined }) {
      const exe = path.join(driver.install, "Ballest", "Binaries", "Win64", "Ballest-Win64-Shipping.exe")
      if (!(yield* io(fs.exists(exe), "looking for the game"))) {
        return yield* fail(`no game at ${driver.install} (set BALLEST_GAME_DIR)`)
      }
      yield* rsync(driver.install, driver.game, [])
      const win64 = path.join(driver.game, "Ballest", "Binaries", "Win64")
      if (host !== undefined) {
        yield* io(fs.copyFile(path.join(host, "version.dll"), path.join(win64, "version.dll")), "copying the host")
        yield* rsync(path.join(host, "plugins"), path.join(win64, "plugins"), [])
      }
      if (yield* io(fs.exists(path.join(driver.plugin, "main.as")), "looking for the driver plugin")) {
        yield* rsync(driver.plugin, path.join(win64, "plugins", "ballest-driver"), [])
      }
      if (!(yield* io(fs.exists(path.join(win64, "version.dll")), "looking for the host"))) {
        return yield* fail(`${win64} has no version.dll: install the plugin manager in the game, or pass --host`)
      }
      return driver.game
    })

    /** A slot's prefix from the game's, once; `sandbox.txt`, the user dir's seed and the settings every time. */
    const prepare = Effect.fn("Slots.prepare")(function*(slot: SlotPaths) {
      if (!(yield* io(fs.exists(slot.userReg), "looking for the slot"))) {
        if (!(yield* io(fs.exists(path.join(driver.compatdata, "pfx", "user.reg")), "looking for the game's prefix"))) {
          return yield* fail(
            `no Proton prefix at ${driver.compatdata}: start the game once (or set BALLEST_COMPATDATA)`
          )
        }
        yield* rsync(driver.compatdata, slot.dir, ["Ballest/Saved/PluginManager", "Ballest/Saved/Logs", "pfx.lock"])
      }
      const reg = yield* io(fs.readFileString(slot.userReg), "reading user.reg")
      const patched = withVersionOverride(reg)
      if (patched !== reg) yield* io(fs.writeFileString(slot.userReg, patched), "writing user.reg")
      yield* io(fs.makeDirectory(slot.data, { recursive: true }), "creating the host's folder")
      yield* io(
        fs.writeFileString(path.join(slot.data, "sandbox.txt"), "sandbox mode: a ballest-driver slot\n"),
        "sandbox.txt"
      )
      const saved = savedIn(path, slot.pfx)
      for (const name of SEEDED) {
        const to = path.join(slot.userDir, "Saved", name)
        if (yield* io(fs.exists(to), "looking for the seed")) continue
        if (yield* io(fs.exists(path.join(saved, name)), "looking for the saves")) {
          yield* rsync(path.join(saved, name), to, ["steam_autocloud.vdf"])
        } else {
          yield* io(fs.makeDirectory(to, { recursive: true }), `creating ${to}`)
        }
      }
      // The slot's own plugins, fresh from the game copy's on every start: the driver plugin's command file is per slot.
      yield* rsync(driver.gamePlugins, slot.plugins, ["DISABLED"])
      yield* io(fs.makeDirectory(path.dirname(slot.settings), { recursive: true }), "creating the config folder")
      yield* io(fs.writeFileString(slot.settings, GAME_USER_SETTINGS), "writing the settings")
      // The probe map, empty: the game lists maps at launch, so it has to exist now for probes to open it later.
      yield* io(fs.makeDirectory(slot.maps, { recursive: true }), "creating the maps folder")
      yield* io(fs.writeFileString(path.join(slot.maps, PROBE_FILE), probeMap([])), "writing the probe map")
    })

    const start = Effect.fn("Slots.start")(function*(n: number, mode: SlotMode) {
      const slot = slotPaths(driver, path, n)
      if (!(yield* io(fs.exists(driver.gameExe), "looking for the game copy"))) {
        return yield* fail(`no game copy at ${driver.game}: run setup first`)
      }
      if ((yield* processes(slot)).length > 0) return yield* fail(`slot ${n} is already running (stop it first)`)
      // Checked before anything is touched: the launcher only forwards a steam://run request when Steam is closed.
      if (!(yield* steamRunning(fs))) return yield* fail(STEAM_NOT_RUNNING)
      yield* prepare(slot)
      yield* io(fs.remove(slot.hostLog, { force: true }), "clearing the old log")
      const launcher = path.join(driver.game, "Ballest.exe")
      const env: Record<string, string | undefined> = {
        ...process.env,
        ...launchEnv(driver, slot),
        DISPLAY: process.env["DISPLAY"] ?? ":0",
        WAYLAND_DISPLAY: undefined
      }
      const pid = yield* Effect.try({
        try: () => {
          // umu's and Proton's own output; the game's log is in the prefix (steam-<app id>.log).
          const launchLog = openSync(slot.launchLog, "w")
          const child = spawn(driver.umu, [launcher, ...gameArgs(mode)], {
            env,
            detached: true,
            stdio: ["ignore", launchLog, launchLog],
            cwd: driver.game
          })
          child.unref()
          return child.pid ?? -1
        },
        catch: (cause) => fail(`starting umu-run: ${String(cause)}`)
      })
      yield* io(
        fs.writeFileString(
          slot.instance,
          `${JSON.stringify({ pid, mode, startedAt: new Date().toISOString() }, null, 2)}\n`
        ),
        "writing instance.json"
      )
      // Ready: the host's footer button is placed. A sandboxed copy also reports its status right after.
      const started = Date.now()
      while (Date.now() - started < READY_TIMEOUT_MS) {
        yield* Effect.sleep("2 seconds")
        const log = yield* readLog(slot)
        if (isReady(log)) break
        if ((yield* processes(slot)).length === 0 && Date.now() - started > 20_000) {
          return yield* fail(
            `slot ${n} exited before the menu; see ${slot.launchLog}, ${slot.dir}/steam-${APP_ID}.log and ${slot.hostLog}`
          )
        }
      }
      yield* Effect.sleep("3 seconds")
      const result = yield* status(n)
      if (!result.ready) {
        return yield* fail(
          `slot ${n} isn't ready after ${READY_TIMEOUT_MS / 1000} s; last lines: ${result.log.join(" | ")}`
        )
      }
      return result
    })

    const stop = Effect.fn("Slots.stop")(function*(n: number) {
      const slot = slotPaths(driver, path, n)
      const pids = yield* processes(slot)
      // A pid that is gone already throws; that is fine.
      for (const pid of pids) yield* Effect.ignore(Effect.try(() => process.kill(pid, "SIGKILL")))
      yield* Effect.sleep("1 second")
      return pids.length
    })

    const log = Effect.fn("Slots.log")(function*(n: number, lines: number) {
      const slot = slotPaths(driver, path, n)
      return tail(yield* readLog(slot), lines)
    })

    return Slots.of({ paths: (n) => slotPaths(driver, path, n), setup, start, stop, status, log })
  })

  static readonly layer = Layer.effect(Slots, Slots.make).pipe(Layer.provide(DriverPaths.layer))
}
