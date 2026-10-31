import type { InstallPluginResult, PluginStatus } from "@ballest/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { GamePaths } from "./GamePaths"
import { GameProcess } from "./GameProcess"
import { pluginManagerDllOf } from "./locations"
import { compareVersions, isPluginFileName, MANIFEST, parseManifest, PLUGIN_ID } from "./pluginManifest"
import * as probe from "./probe"

export class GameLinkError extends Schema.TaggedError<GameLinkError>()("GameLinkError", {
  reason: Schema.Literals(["noPluginManager", "bundle", "install"]),
  path: Schema.NullOr(Schema.String),
  cause: Schema.optional(Schema.Defect())
}) {
  override get message(): string {
    switch (this.reason) {
      case "noPluginManager":
        return "The Ballest plugin manager isn't installed. Install it, then install the editor's plugin."
      case "bundle":
        return `The app's copy of the ${PLUGIN_ID} plugin is missing or broken (${this.path}).`
      case "install":
        return `Couldn't copy the ${PLUGIN_ID} plugin into ${this.path}.`
    }
  }
}

/**
 * The editor's side of the plugin handoff (docs/DESKTOP.md § Play): the `ballest-editor-link` plugin the app ships in
 * `bundleDir`, and the copy of it in the game's plugins folder. `installPlugin` is the one place the app writes into
 * the game's install, and only inside `<plugins>/ballest-editor-link`.
 */
export class GameLink extends Context.Service<GameLink, {
  readonly pluginStatus: Effect.Effect<PluginStatus, GameLinkError>
  /** Copies the app's plugin in, over an older copy; refused without the plugin manager. */
  readonly installPlugin: Effect.Effect<InstallPluginResult, GameLinkError>
}>()("ballest/desktop/game/GameLink") {
  static readonly make = (bundleDir: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const paths = yield* GamePaths
      const game = yield* GameProcess

      const bundleError = (cause?: unknown) => new GameLinkError({ reason: "bundle", path: bundleDir, cause })

      /** The app's copy: its manifest, and the files to install, `info.toml` last. */
      const bundle = Effect.gen(function*() {
        const manifest = parseManifest(
          yield* fs.readFileString(path.join(bundleDir, MANIFEST)).pipe(Effect.mapError(bundleError))
        )
        if (!manifest.files.every(isPluginFileName)) return yield* bundleError()
        return { version: manifest.version, files: [...new Set(manifest.files)].filter((f) => f !== MANIFEST) }
      })

      const pluginStatus = Effect.gen(function*() {
        const { version, files } = yield* bundle
        const { install, pluginsFolder } = yield* paths.get
        const folder = pluginsFolder.path === null ? null : path.join(pluginsFolder.path, PLUGIN_ID)
        const result = (status: PluginStatus["status"], installedVersion: string | null = null): PluginStatus => ({
          status,
          bundledVersion: version,
          installedVersion,
          folder
        })
        if (install.status === "missing" || install.path === null) return result("noGame")
        if (
          pluginsFolder.status === "missing" || folder === null ||
          !(yield* probe.isFile(fs, pluginManagerDllOf(install.path, path)))
        ) return result("noPluginManager")

        const installed = yield* fs.readFileString(path.join(folder, MANIFEST)).pipe(
          Effect.map(parseManifest),
          Effect.option
        )
        if (Option.isNone(installed)) return result("missing")
        const present = yield* Effect.forEach(files, (file) => probe.isFile(fs, path.join(folder, file)))
        const installedVersion = installed.value.version
        if (present.includes(false)) return result("missing", installedVersion)
        return result(compareVersions(installedVersion, version) < 0 ? "outdated" : "current", installedVersion)
      }).pipe(Effect.withSpan("GameLink.pluginStatus"))

      const copyIn = (folder: string, files: ReadonlyArray<string>) =>
        Effect.gen(function*() {
          yield* fs.makeDirectory(folder, { recursive: true })
          // Staged beside the plugin, on the same drive, so each file moves in with one rename. The plugin manager
          // skips folders whose name starts with a dot, so it never loads the staging copy.
          const staging = yield* fs.makeTempDirectoryScoped({
            directory: path.dirname(folder),
            prefix: `.${PLUGIN_ID}-`
          })
          const copy = (from: string, to: string, file: string, move: boolean) =>
            fs.makeDirectory(path.dirname(path.join(to, file)), { recursive: true }).pipe(
              Effect.andThen((move ? fs.rename : fs.copyFile)(path.join(from, file), path.join(to, file)))
            )
          for (const file of files) yield* copy(bundleDir, staging, file, false)
          // File by file, so whatever else is in the folder (play.json) stays. info.toml goes last: a folder left
          // half-updated still says it is the old version, and shows Update.
          for (const file of files) yield* copy(staging, folder, file, true)
        }).pipe(
          Effect.scoped,
          Effect.mapError((cause) => new GameLinkError({ reason: "install", path: folder, cause }))
        )

      const installPlugin = Effect.gen(function*() {
        const before = yield* pluginStatus
        if (before.status === "noGame" || before.status === "noPluginManager" || before.folder === null) {
          return yield* new GameLinkError({ reason: "noPluginManager", path: before.folder })
        }
        const { files } = yield* bundle
        yield* copyIn(before.folder, [...files, MANIFEST])
        return { plugin: yield* pluginStatus, restartGame: yield* game.isRunning } satisfies InstallPluginResult
      }).pipe(Effect.withSpan("GameLink.installPlugin"))

      return GameLink.of({ pluginStatus, installPlugin })
    })

  /** Installs from the plugin the app ships (`DesktopEnvironment.pluginDir`). */
  static readonly layer = Layer.effect(
    GameLink,
    Effect.gen(function*() {
      return yield* GameLink.make((yield* DesktopEnvironment).pluginDir)
    })
  )
}
