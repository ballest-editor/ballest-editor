import { type GamePath, GamePathKind, type GamePaths as GamePathsInfo } from "@ballest/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { DesktopSettings, type GamePathOverrides } from "../settings/DesktopSettings"
import { GameHost } from "./GameHost"
import { gameExeOf, libraryOfInstall, mapsFolderIn, pluginsFolderOf, savedFolderCandidates } from "./locations"
import * as probe from "./probe"
import { SteamLibrary } from "./SteamLibrary"

export class GamePathError extends Schema.TaggedError<GamePathError>()("GamePathError", {
  which: GamePathKind,
  path: Schema.NullOr(Schema.String),
  reason: Schema.Literals(["notInstall", "missing", "settings"]),
  cause: Schema.optional(Schema.Defect())
}) {
  override get message(): string {
    switch (this.reason) {
      case "notInstall":
        return `${this.path} isn't Ballest of Them All's folder (it has no Ballest/Binaries/Win64/Ballest-Win64-Shipping.exe).`
      case "missing":
        return this.which === "mapsFolder"
          ? "Couldn't find the game's maps folder. Start the game once, or choose the folder in Settings › Game."
          : `Couldn't find the game's ${this.which === "install" ? "install" : "plugins"} folder.`
      case "settings":
        return "Couldn't save the game folders to the desktop settings."
    }
  }
}

const found = (path: string): GamePath => ({ status: "found", path })
const missing = (path: string | null): GamePath => ({ status: "missing", path })

/**
 * The game's install, maps and plugins folders (docs/DESKTOP.md § Game paths): each found through Steam, or chosen in
 * settings in its place. Looked up again on every call; nothing here writes to any of them.
 */
export class GamePaths extends Context.Service<GamePaths, {
  readonly get: Effect.Effect<GamePathsInfo>
  /** Uses `path` for `which` from now on, or (none) goes back to the folder found through Steam. */
  readonly setOverride: (
    which: GamePathKind,
    path: Option.Option<string>
  ) => Effect.Effect<GamePathsInfo, GamePathError>
  /**
   * The maps folder, ready to write into. A maps folder found next to the game's `Saved` folder but not made yet (the
   * in-game editor never saved a map) is created; a missing one fails.
   */
  readonly mapsFolderForWrite: Effect.Effect<string, GamePathError>
}>()("ballest/desktop/game/GamePaths") {
  static readonly make = Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const host = yield* GameHost
    const steam = yield* SteamLibrary
    const settings = yield* DesktopSettings

    const overrides = settings.get.pipe(Effect.map((s): GamePathOverrides => s.game ?? {}))

    const get = Effect.gen(function*() {
      const chosen = yield* overrides
      const game = yield* steam.findGame

      const install: GamePath = chosen.install !== undefined
        ? { status: "overridden", path: chosen.install }
        : Option.match(game, { onNone: () => missing(null), onSome: (g) => found(g.install) })

      const mapsFolder: GamePath = yield* Effect.gen(function*() {
        if (chosen.mapsFolder !== undefined) return { status: "overridden", path: chosen.mapsFolder } as const
        // The game's own library first: Steam makes the Proton prefix there.
        const gameLibrary = chosen.install === undefined
          ? Option.map(game, (g) => g.library)
          : libraryOfInstall(chosen.install, path)
        const libraries = [...Option.toArray(gameLibrary), ...(yield* steam.libraries)]
        const candidates = [...new Set(savedFolderCandidates(host, libraries, path))]
        for (const saved of candidates) {
          if (yield* probe.isDirectory(fs, saved)) return found(mapsFolderIn(saved, path))
        }
        return missing(candidates[0] === undefined ? null : mapsFolderIn(candidates[0], path))
      })

      const pluginsFolder: GamePath = yield* Effect.gen(function*() {
        if (chosen.pluginsFolder !== undefined) return { status: "overridden", path: chosen.pluginsFolder } as const
        if (install.path === null) return missing(null)
        const plugins = pluginsFolderOf(install.path, path)
        return (yield* probe.isDirectory(fs, plugins)) ? found(plugins) : missing(plugins)
      })

      return { install, mapsFolder, pluginsFolder } satisfies GamePathsInfo
    }).pipe(Effect.withSpan("GamePaths.get"))

    const setOverride = Effect.fn("GamePaths.setOverride")(
      function*(which: GamePathKind, chosen: Option.Option<string>) {
        if (which === "install" && Option.isSome(chosen) && !(yield* probe.isFile(fs, gameExeOf(chosen.value, path)))) {
          return yield* new GamePathError({ which, path: chosen.value, reason: "notInstall" })
        }
        yield* settings.update((s) => {
          const { [which]: _, ...others } = s.game ?? {}
          return {
            ...s,
            game: Option.match(chosen, { onNone: () => others, onSome: (p) => ({ ...others, [which]: p }) })
          }
        }).pipe(
          Effect.mapError((cause) =>
            new GamePathError({ which, path: Option.getOrNull(chosen), reason: "settings", cause })
          )
        )
        return yield* get
      }
    )

    const mapsFolderForWrite = Effect.gen(function*() {
      const { mapsFolder } = yield* get
      if (mapsFolder.status === "missing" || mapsFolder.path === null) {
        return yield* new GamePathError({ which: "mapsFolder", path: mapsFolder.path, reason: "missing" })
      }
      const folder = mapsFolder.path
      yield* fs.makeDirectory(folder, { recursive: true }).pipe(
        Effect.mapError((cause) => new GamePathError({ which: "mapsFolder", path: folder, reason: "missing", cause }))
      )
      return folder
    })

    return GamePaths.of({ get, setOverride, mapsFolderForWrite })
  })

  static readonly layer = Layer.effect(GamePaths, GamePaths.make)
}
