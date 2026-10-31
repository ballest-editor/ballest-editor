import { Context, Effect, FileSystem, Layer, Option, Path } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { GameHost } from "./GameHost"
import {
  APP_ID,
  DEFAULT_INSTALL_DIR,
  gameExeOf,
  installIn,
  regQueryValue,
  STEAM_REGISTRY_KEYS,
  steamRootCandidates
} from "./locations"
import * as probe from "./probe"
import { installDirOf, libraryFoldersOf } from "./vdf"

/** Where Steam has the game: the library it is in and its install folder. */
export interface SteamGame {
  readonly library: string
  readonly install: string
}

/**
 * Steam's libraries on this machine and the one holding the game, found the way the plugin manager's
 * `tools/find_game.sh` does: Steam's folder (the registry on Windows, the usual places), every library its
 * `steamapps/libraryfolders.vdf` lists, and the first with `appmanifest_3339810.acf` whose install has the game's exe.
 * Looked up on every call, so a game installed or moved while the app runs is found.
 */
export class SteamLibrary extends Context.Service<SteamLibrary, {
  /** Every Steam library, Steam's own folder first; each listed once, however many links lead to it. */
  readonly libraries: Effect.Effect<ReadonlyArray<string>>
  readonly findGame: Effect.Effect<Option.Option<SteamGame>>
}>()("ballest/desktop/game/SteamLibrary") {
  static readonly make = Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const host = yield* GameHost
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

    const isDirectory = (dir: string) => probe.isDirectory(fs, dir)
    const readText = (file: string) => fs.readFileString(file).pipe(Effect.option)

    // Steam's folder doesn't move while the app runs; asking the registry once is enough.
    const registry = yield* Effect.cached(
      host.platform === "win32"
        ? Effect.forEach(
          STEAM_REGISTRY_KEYS,
          ([key, value]) =>
            spawner.string(ChildProcess.make("reg", ["query", key, "/v", value])).pipe(
              Effect.map((output) => Option.toArray(regQueryValue(output, value))),
              Effect.orElseSucceed(() => [])
            )
        ).pipe(Effect.map((found) => found.flat()))
        : Effect.succeed([])
    )

    const libraries = Effect.gen(function*() {
      const roots = steamRootCandidates(host, yield* registry, path)
      const seen = new Set<string>()
      const out: Array<string> = []
      const add = Effect.fn(function*(dir: string) {
        if (!(yield* isDirectory(path.join(dir, "steamapps")))) return
        const real = yield* fs.realPath(dir).pipe(Effect.orElseSucceed(() => dir))
        // Windows paths differ in case only between the registry's and the vdf's spelling.
        const key = host.platform === "win32" ? real.toLowerCase() : real
        if (seen.has(key)) return
        seen.add(key)
        out.push(dir)
      })
      for (const root of roots) {
        if (!(yield* isDirectory(path.join(root, "steamapps")))) continue
        yield* add(root)
        const vdf = yield* readText(path.join(root, "steamapps", "libraryfolders.vdf"))
        for (const library of Option.match(vdf, { onNone: () => [], onSome: libraryFoldersOf })) {
          yield* add(path.normalize(library))
        }
      }
      return out
    }).pipe(Effect.withSpan("SteamLibrary.libraries"))

    const findGame = Effect.gen(function*() {
      for (const library of yield* libraries) {
        const manifest = yield* readText(path.join(library, "steamapps", `appmanifest_${APP_ID}.acf`))
        if (Option.isNone(manifest)) continue
        const install = installIn(
          library,
          Option.getOrElse(installDirOf(manifest.value), () => DEFAULT_INSTALL_DIR),
          path
        )
        if (yield* probe.isFile(fs, gameExeOf(install, path))) return Option.some({ library, install })
      }
      return Option.none()
    }).pipe(Effect.withSpan("SteamLibrary.findGame"))

    return SteamLibrary.of({ libraries, findGame })
  })

  static readonly layer = Layer.effect(SteamLibrary, SteamLibrary.make)
}
