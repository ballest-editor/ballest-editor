import { Context, Effect, Layer, Path } from "effect"
import { homedir } from "node:os"

export const APP_ID = "3339810"
export const GAME_EXE = "Ballest-Win64-Shipping.exe"

/**
 * Where the driver keeps its things (docs/DRIVER.md § Where it lives), and where it finds the game. Everything can be
 * moved with an environment variable; the defaults are a native Steam install on Linux.
 *
 * - `BALLEST_DRIVER_HOME`: the driver's folder (`game/`, the copy of the install; `slots/<n>/`, one Proton prefix each).
 * - `BALLEST_GAME_DIR`: the game's install folder (read, never written; `setup` copies it).
 * - `BALLEST_COMPATDATA`: the game's Proton prefix folder (`compatdata/3339810`; copied into every slot).
 * - `BALLEST_PROTON`: the Proton folder to run slots with.
 * - `BALLEST_UMU`: the `umu-run` executable.
 * - `BALLEST_DRIVER_PLUGIN`: the staged driver plugin folder (default: packages/ballest-driver/dist/ballest-driver).
 */
export class DriverPaths extends Context.Service<DriverPaths, {
  readonly home: string
  /** The copy of the game install the slots run: `home/game`. */
  readonly game: string
  readonly gameExe: string
  readonly slots: string
  readonly install: string
  readonly compatdata: string
  readonly proton: string
  readonly umu: string
  /** The game copy's plugins folder, which every slot's own plugins folder is copied from. */
  readonly gamePlugins: string
  /** The driver plugin as `pnpm build` stages it (info.toml + main.as). */
  readonly plugin: string
}>()("ballest/driver/DriverPaths") {
  static readonly make = Effect.gen(function*() {
    const path = yield* Path.Path
    const env = process.env
    const steam = path.join(homedir(), ".local", "share", "Steam", "steamapps")
    const home = env["BALLEST_DRIVER_HOME"] ?? path.join(homedir(), ".cache", "ballest-editor", "driver")
    const game = path.join(home, "game")
    return DriverPaths.of({
      home,
      game,
      gameExe: path.join(game, "Ballest", "Binaries", "Win64", GAME_EXE),
      slots: path.join(home, "slots"),
      install: env["BALLEST_GAME_DIR"] ?? path.join(steam, "common", "Ballest of Them All"),
      compatdata: env["BALLEST_COMPATDATA"] ?? path.join(steam, "compatdata", APP_ID),
      proton: env["BALLEST_PROTON"] ?? path.join(steam, "common", "Proton - Experimental"),
      umu: env["BALLEST_UMU"] ?? "umu-run",
      gamePlugins: path.join(game, "Ballest", "Binaries", "Win64", "plugins"),
      plugin: env["BALLEST_DRIVER_PLUGIN"]
        ?? path.resolve(import.meta.dirname, "..", "..", "..", "packages", "ballest-driver", "dist", "ballest-driver")
    })
  })

  static readonly layer = Layer.effect(DriverPaths, DriverPaths.make)
}

/** The folders of one slot. */
export interface SlotPaths {
  readonly slot: number
  readonly dir: string
  /** The Proton prefix (`WINEPREFIX`); `dir` is its `STEAM_COMPAT_DATA_PATH`. */
  readonly pfx: string
  readonly userReg: string
  /** The host's folder in the prefix: `host.log`, `test_command.txt`, renders, `sandbox.txt`. */
  readonly data: string
  readonly hostLog: string
  readonly commandFile: string
  /** The game's `-userdir`: its `Saved` (config, saves, maps, logs) lives here. `C:\slot\UserDir` inside the prefix. */
  readonly userDir: string
  readonly maps: string
  readonly settings: string
  /** umu's and Proton's output. */
  readonly launchLog: string
  readonly instance: string
  readonly types: string
  /** The slot's own plugins (the host runs these instead of the game copy's when the folder exists). */
  readonly plugins: string
  /** The driver plugin's command file in that folder. */
  readonly pluginCommand: string
}

export const slotPaths = (paths: DriverPaths["Service"], path: Path.Path, slot: number): SlotPaths => {
  const dir = path.join(paths.slots, String(slot))
  const pfx = path.join(dir, "pfx")
  const data = path.join(pfx, "drive_c", "users", "steamuser", "AppData", "Local", "Ballest", "Saved", "PluginManager")
  const userDir = path.join(pfx, "drive_c", "slot", "UserDir")
  return {
    slot,
    dir,
    pfx,
    userReg: path.join(pfx, "user.reg"),
    data,
    hostLog: path.join(data, "host.log"),
    commandFile: path.join(data, "test_command.txt"),
    userDir,
    maps: path.join(userDir, "Saved", "UserSavedMaps"),
    settings: path.join(userDir, "Saved", "Config", "Windows", "GameUserSettings.ini"),
    launchLog: path.join(dir, "launch.log"),
    instance: path.join(dir, "instance.json"),
    types: path.join(dir, "types"),
    plugins: path.join(data, "plugins"),
    pluginCommand: path.join(data, "plugins", "ballest-driver", "command.json")
  }
}

/** The game's own `Saved` folder inside a prefix, where the player's saves are (the seed for a slot's user dir). */
export const savedIn = (path: Path.Path, pfx: string): string =>
  path.join(pfx, "drive_c", "users", "steamuser", "AppData", "Local", "Ballest", "Saved")
