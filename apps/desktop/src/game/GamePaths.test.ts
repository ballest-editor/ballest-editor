import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Option, Path } from "effect"
import { layerFakeGamePaths, makeFakeSteam, runScoped } from "./fakeSteam"
import { GamePaths } from "./GamePaths"
import { SteamLibrary } from "./SteamLibrary"

/** GamePaths over a fake Steam tree in a temp folder, with its own settings file. */
const setup = (options: Parameters<typeof makeFakeSteam>[1]) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped()
    const fake = yield* makeFakeSteam(dir, options)
    const services = layerFakeGamePaths(fake.host, path.join(dir, "desktop-settings.json"))
    const { paths, steam } = yield* Effect.all({ paths: GamePaths, steam: SteamLibrary }).pipe(Effect.provide(services))
    return { fs, path, dir, fake, paths, steam }
  })

describe("GamePaths", () => {
  it.effect("finds every folder when the game is in Steam's own library and has run", () =>
    runScoped(Effect.gen(function*() {
      const { fake, paths, steam } = yield* setup({ game: "steam", ran: true, plugins: true })
      // ~/.steam/steam links to ~/.local/share/Steam: listed once.
      assert.deepStrictEqual(yield* steam.libraries, [fake.steam, fake.second])
      assert.deepStrictEqual(yield* paths.get, {
        install: { status: "found", path: fake.install },
        mapsFolder: { status: "found", path: fake.maps },
        pluginsFolder: { status: "found", path: `${fake.install}/Ballest/Binaries/Win64/plugins` }
      })
    })))

  it.effect("finds the game in another library, under the install folder its manifest names", () =>
    runScoped(Effect.gen(function*() {
      const { fake, paths } = yield* setup({ game: "second", ran: true, installDir: "Ballest" })
      assert.isTrue(fake.install.endsWith("games/SteamLibrary/steamapps/common/Ballest"))
      const found = yield* paths.get
      assert.deepStrictEqual(found.install, { status: "found", path: fake.install })
      assert.deepStrictEqual(found.mapsFolder, { status: "found", path: fake.maps })
      // No plugin manager: where its folder would be.
      assert.deepStrictEqual(found.pluginsFolder, {
        status: "missing",
        path: `${fake.install}/Ballest/Binaries/Win64/plugins`
      })
    })))

  it.effect("reports a maps folder that doesn't exist yet as missing, at the path it would have", () =>
    runScoped(Effect.gen(function*() {
      const { fake, paths } = yield* setup({ game: "steam" })
      assert.deepStrictEqual((yield* paths.get).mapsFolder, { status: "missing", path: fake.maps })
      const error = yield* Effect.flip(paths.mapsFolderForWrite)
      assert.strictEqual(error.reason, "missing")
    })))

  it.effect("creates UserSavedMaps when the game has run but never saved a map", () =>
    runScoped(Effect.gen(function*() {
      const { fs, fake, paths } = yield* setup({ game: "steam", ran: true })
      assert.isFalse(yield* fs.exists(fake.maps))
      assert.strictEqual(yield* paths.mapsFolderForWrite, fake.maps)
      assert.isTrue(yield* fs.exists(fake.maps))
    })))

  it.effect("reports everything missing without the game", () =>
    runScoped(Effect.gen(function*() {
      const { fake, paths } = yield* setup({ game: "none" })
      const found = yield* paths.get
      assert.deepStrictEqual(found.install, { status: "missing", path: null })
      assert.strictEqual(found.mapsFolder.status, "missing")
      assert.isTrue(found.mapsFolder.path?.startsWith(fake.steam))
      assert.deepStrictEqual(found.pluginsFolder, { status: "missing", path: null })
    })))

  it.effect("uses folders chosen in settings, and goes back to the ones found", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, dir, fake, paths } = yield* setup({ game: "steam", ran: true })
      const maps = path.join(dir, "my maps")
      const plugins = path.join(dir, "plugins")
      yield* fs.makeDirectory(maps)
      yield* paths.setOverride("mapsFolder", Option.some(maps))
      const chosen = yield* paths.setOverride("pluginsFolder", Option.some(plugins))
      assert.deepStrictEqual(chosen.mapsFolder, { status: "overridden", path: maps })
      assert.deepStrictEqual(chosen.pluginsFolder, { status: "overridden", path: plugins })
      assert.strictEqual(yield* paths.mapsFolderForWrite, maps)

      const reset = yield* paths.setOverride("mapsFolder", Option.none())
      assert.deepStrictEqual(reset.mapsFolder, { status: "found", path: fake.maps })
      assert.deepStrictEqual(reset.pluginsFolder, { status: "overridden", path: plugins })
    })))

  it.effect("accepts only a folder with the game's exe as the install, and follows it to its library", () =>
    runScoped(Effect.gen(function*() {
      const { fs, path, dir, paths } = yield* setup({ game: "none" })
      const error = yield* Effect.flip(paths.setOverride("install", Option.some(dir)))
      assert.strictEqual(error.reason, "notInstall")

      const library = path.join(dir, "elsewhere")
      const install = path.join(library, "steamapps", "common", "Ballest of Them All")
      const win64 = path.join(install, "Ballest", "Binaries", "Win64")
      const saved = path.join(
        library,
        "steamapps/compatdata/3339810/pfx/drive_c/users/steamuser/AppData/Local/Ballest/Saved"
      )
      yield* fs.makeDirectory(path.join(win64, "plugins"), { recursive: true })
      yield* fs.writeFileString(path.join(win64, "Ballest-Win64-Shipping.exe"), "")
      yield* fs.makeDirectory(saved, { recursive: true })

      assert.deepStrictEqual(yield* paths.setOverride("install", Option.some(install)), {
        install: { status: "overridden", path: install },
        mapsFolder: { status: "found", path: path.join(saved, "UserSavedMaps") },
        pluginsFolder: { status: "found", path: path.join(win64, "plugins") }
      })
    })))
})
