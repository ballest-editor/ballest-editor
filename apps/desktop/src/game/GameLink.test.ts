import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Path } from "effect"
import { layerFakeGamePaths, makeFakePluginBundle, makeFakeSteam, runScoped } from "./fakeSteam"
import { GameLink } from "./GameLink"

/** GameLink over a fake Steam tree and a bundled plugin at `bundled` (0.2.0 unless given), in a temp folder. */
const setup = (options: Parameters<typeof makeFakeSteam>[1] & { readonly bundled?: string }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped()
    const fake = yield* makeFakeSteam(dir, options)
    const bundle = yield* makeFakePluginBundle(dir, options.bundled ?? "0.2.0")
    const services = Layer.effect(GameLink, GameLink.make(bundle)).pipe(
      Layer.provide(layerFakeGamePaths(fake.host, path.join(dir, "desktop-settings.json")))
    )
    const link = yield* GameLink.pipe(Effect.provide(services))
    const folder = path.join(fake.plugins, "ballest-editor-link")
    /** Puts a copy of the plugin at `version` in the plugins folder, as a user copying it by hand would. */
    const installByHand = (version: string, files: Record<string, string> = {}) =>
      Effect.gen(function*() {
        yield* fs.makeDirectory(folder, { recursive: true })
        yield* fs.writeFileString(path.join(folder, "info.toml"), `[meta]\nversion = "${version}"\n`)
        yield* fs.writeFileString(path.join(folder, "main.as"), `// ${version}\n`)
        for (const [name, text] of Object.entries(files)) yield* fs.writeFileString(path.join(folder, name), text)
      })
    return { fs, path, fake, bundle, link, folder, installByHand }
  })

describe("GameLink.pluginStatus", () => {
  it.effect("needs the game first", () =>
    runScoped(Effect.gen(function*() {
      const { link } = yield* setup({ game: "none" })
      assert.deepStrictEqual(yield* link.pluginStatus, {
        status: "noGame",
        bundledVersion: "0.2.0",
        installedVersion: null,
        folder: null
      })
    })))

  it.effect("needs the plugin manager: its version.dll and its plugins folder", () =>
    runScoped(Effect.gen(function*() {
      const noFolder = yield* setup({ game: "steam" })
      assert.strictEqual((yield* noFolder.link.pluginStatus).status, "noPluginManager")
      // A plugins folder without the loader next to the exe isn't the plugin manager.
      const noDll = yield* setup({ game: "steam", plugins: true })
      assert.deepStrictEqual(yield* noDll.link.pluginStatus, {
        status: "noPluginManager",
        bundledVersion: "0.2.0",
        installedVersion: null,
        folder: noDll.folder
      })
    })))

  it.effect("is missing when the folder, its info.toml or one of its scripts isn't there", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, link, folder, installByHand } = yield* setup({ game: "steam", pluginManager: true })
      assert.deepInclude(yield* link.pluginStatus, { status: "missing", installedVersion: null, folder })
      yield* fs.makeDirectory(folder)
      yield* fs.writeFileString(path.join(folder, "play.json"), "{}")
      assert.deepInclude(yield* link.pluginStatus, { status: "missing", installedVersion: null })
      yield* installByHand("0.2.0")
      yield* fs.remove(path.join(folder, "main.as"))
      assert.deepInclude(yield* link.pluginStatus, { status: "missing", installedVersion: "0.2.0" })
    })))

  it.effect("compares the installed version with the app's copy", () =>
    runScoped(Effect.gen(function*() {
      const { link, installByHand } = yield* setup({ game: "steam", pluginManager: true, bundled: "0.10.0" })
      yield* installByHand("0.9.3")
      assert.deepInclude(yield* link.pluginStatus, { status: "outdated", installedVersion: "0.9.3" })
      yield* installByHand("0.10")
      assert.deepInclude(yield* link.pluginStatus, { status: "current", installedVersion: "0.10" })
      // A newer one (a developer's) is left as it is.
      yield* installByHand("0.11.0")
      assert.deepInclude(yield* link.pluginStatus, { status: "current", installedVersion: "0.11.0" })
    })))

  it.effect("fails when the app's copy is missing", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, bundle, link } = yield* setup({ game: "steam", pluginManager: true })
      yield* fs.remove(path.join(bundle, "info.toml"))
      const error = yield* Effect.flip(link.pluginStatus)
      assert.strictEqual(error.reason, "bundle")
    })))
})

describe("GameLink.installPlugin", () => {
  it.effect("puts the app's copy in place, and nothing else", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, fake, bundle, link, folder } = yield* setup({ game: "steam", pluginManager: true })
      yield* fs.makeDirectory(path.join(fake.plugins, "other-plugin"))
      const result = yield* link.installPlugin
      assert.deepStrictEqual(result, {
        plugin: { status: "current", bundledVersion: "0.2.0", installedVersion: "0.2.0", folder },
        restartGame: false
      })
      for (const file of ["info.toml", "main.as"]) {
        assert.strictEqual(
          yield* fs.readFileString(path.join(folder, file)),
          yield* fs.readFileString(path.join(bundle, file))
        )
      }
      // The staging folder is gone; the other plugin is untouched.
      assert.deepStrictEqual((yield* fs.readDirectory(fake.plugins)).sort(), ["ballest-editor-link", "other-plugin"])
      assert.deepStrictEqual(yield* fs.readDirectory(path.join(fake.plugins, "other-plugin")), [])
    })))

  it.effect("updates an older copy and keeps its play.json and other files", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, fake, link, folder, installByHand } = yield* setup({ game: "steam", pluginManager: true })
      const play = "{ \"map\": \"Map_LevelEditorMain&Loop_Isaac.balledit\", \"nonce\": 1730332800123 }"
      yield* installByHand("0.1.0", { "play.json": play, "notes.txt": "mine" })
      assert.deepInclude((yield* link.installPlugin).plugin, { status: "current", installedVersion: "0.2.0" })
      assert.strictEqual(yield* fs.readFileString(path.join(folder, "main.as")), "// 0.2.0\nvoid Main() {}\n")
      assert.strictEqual(yield* fs.readFileString(path.join(folder, "play.json")), play)
      assert.strictEqual(yield* fs.readFileString(path.join(folder, "notes.txt")), "mine")
      assert.deepStrictEqual(yield* fs.readDirectory(fake.plugins), ["ballest-editor-link"])
    })))

  it.effect("says the game must restart when it is running", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, fake, link } = yield* setup({ game: "steam", pluginManager: true })
      yield* fs.makeDirectory(path.join(fake.host.procDir, "4242"))
      yield* fs.writeFileString(
        path.join(fake.host.procDir, "4242", "cmdline"),
        "wine\0Z:\\games\\Ballest\\Binaries\\Win64\\Ballest-Win64-Shipping.exe\0"
      )
      assert.isTrue((yield* link.installPlugin).restartGame)
    })))

  it.effect("refuses without the plugin manager, and writes nothing", () =>
    runScoped(Effect.gen(function*() {
      const { fs, fake, link } = yield* setup({ game: "steam", plugins: true })
      const error = yield* Effect.flip(link.installPlugin)
      assert.strictEqual(error.reason, "noPluginManager")
      assert.match(error.message, /plugin manager isn't installed/)
      assert.deepStrictEqual(yield* fs.readDirectory(fake.plugins), [])
      const noGame = yield* setup({ game: "none" })
      assert.strictEqual((yield* Effect.flip(noGame.link.installPlugin)).reason, "noPluginManager")
    })))
})
