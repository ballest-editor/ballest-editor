import { NodeServices } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Path, type Scope } from "effect"
import { DesktopSettings } from "../settings/DesktopSettings"
import { GameHost } from "./GameHost"
import { GamePaths } from "./GamePaths"
import { GameProcess } from "./GameProcess"
import type { HostInfo } from "./locations"
import { SteamLibrary } from "./SteamLibrary"

/**
 * Builds a Linux Steam layout under `home` for tests, like this machine's: Steam in `~/.local/share/Steam` (with the
 * `~/.steam/steam` link to it), a second library on another "drive", the game in `gameLibrary`, and its Proton prefix
 * there once the game has run.
 */
export const makeFakeSteam = Effect.fn("makeFakeSteam")(function*(root: string, options: {
  /** Where the game is: Steam's own folder, the second library, or nowhere. */
  readonly game: "steam" | "second" | "none"
  /** The game has run: its `Saved` folder exists in the prefix. */
  readonly ran?: boolean
  /** The plugins folder exists. */
  readonly plugins?: boolean
  /** The plugin manager is installed: `version.dll` next to the exe, and the plugins folder. */
  readonly pluginManager?: boolean
  readonly installDir?: string
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const home = path.join(root, "home")
  const steam = path.join(home, ".local", "share", "Steam")
  const second = path.join(root, "games", "SteamLibrary")
  const write = (file: string, text: string) =>
    fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.andThen(fs.writeFileString(file, text)))

  yield* write(
    path.join(steam, "steamapps", "libraryfolders.vdf"),
    `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t\t"apps"\n\t\t{\n\t\t}\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${second}"\n\t}\n}\n`
  )
  yield* fs.makeDirectory(path.join(second, "steamapps"), { recursive: true })
  yield* fs.makeDirectory(path.join(home, ".steam"), { recursive: true })
  yield* fs.symlink(steam, path.join(home, ".steam", "steam"))

  const library = options.game === "second" ? second : steam
  const installDir = options.installDir ?? "Ballest of Them All"
  const install = path.join(library, "steamapps", "common", installDir)
  const prefix = path.join(library, "steamapps", "compatdata", "3339810", "pfx")
  const saved = path.join(prefix, "drive_c", "users", "steamuser", "AppData", "Local", "Ballest", "Saved")
  if (options.game !== "none") {
    yield* write(
      path.join(library, "steamapps", "appmanifest_3339810.acf"),
      `"AppState"\n{\n\t"appid"\t\t"3339810"\n\t"installdir"\t\t"${installDir}"\n}\n`
    )
    yield* write(path.join(install, "Ballest", "Binaries", "Win64", "Ballest-Win64-Shipping.exe"), "")
    if (options.plugins === true || options.pluginManager === true) {
      yield* fs.makeDirectory(path.join(install, "Ballest", "Binaries", "Win64", "plugins"), { recursive: true })
    }
    if (options.pluginManager === true) {
      yield* write(path.join(install, "Ballest", "Binaries", "Win64", "version.dll"), "")
    }
    if (options.ran === true) yield* fs.makeDirectory(saved, { recursive: true })
  }

  const host: HostInfo & { readonly procDir: string } = {
    platform: "linux",
    home,
    env: {},
    procDir: path.join(root, "proc")
  }
  yield* fs.makeDirectory(host.procDir, { recursive: true })
  const plugins = path.join(install, "Ballest", "Binaries", "Win64", "plugins")
  return { host, steam, second, library, install, plugins, maps: path.join(saved, "UserSavedMaps") }
})

/** The app's copy of the editor-link plugin, at `version`, in a fresh folder under `root`; returns its folder. */
export const makeFakePluginBundle = Effect.fn("makeFakePluginBundle")(function*(root: string, version: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const dir = path.join(root, "bundle", "ballest-editor-link")
  yield* fs.makeDirectory(dir, { recursive: true })
  yield* fs.writeFileString(
    path.join(dir, "info.toml"),
    `[meta]\nname = "Ballest Editor link"\nversion = "${version}" # bumped per release\n\n[script]\nfiles = ["main.as"]\n`
  )
  yield* fs.writeFileString(path.join(dir, "main.as"), `// ${version}\nvoid Main() {}\n`)
  return dir
})

/** GamePaths, GameProcess and SteamLibrary over a fake Steam's `host`, with the desktop settings in `settingsFile`. */
export const layerFakeGamePaths = (host: HostInfo & { readonly procDir: string }, settingsFile: string) =>
  Layer.mergeAll(GamePaths.layer, GameProcess.layer).pipe(
    Layer.provideMerge(SteamLibrary.layer),
    Layer.provide(Layer.succeed(GameHost, GameHost.of(host))),
    Layer.provide(Layer.effect(DesktopSettings, DesktopSettings.make(settingsFile)))
  )

/** Runs a test over the real file system, closing its scope (and temp folders) at the end. */
export const runScoped = <A, E>(effect: Effect.Effect<A, E, Scope.Scope | NodeServices.NodeServices>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer))
