import { ChooseGamePathResult, GamePaths as GamePathsSchema, PlayResult, PluginStatus } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Option, Path, Schema } from "effect"
import { vi } from "vitest"
import { PlayFile } from "../game/GameLink"
import { sha256 } from "../project/files"
import * as channels from "./channels"
import { expectTag, opened, readSettings, withHandlers } from "./handlersHarness"

// The services' layers call Electron; these tests replace them, so only the module import needs a stand-in
// (requiring the real package from Node would download the binary).
vi.mock("electron", () => ({}))

describe("the game over IPC", () => {
  it.effect("reports, chooses, resets and reveals the game folders", () =>
    withHandlers(({ fake, dialogs, dir, steam }) =>
      Effect.gen(function*() {
        const found = {
          install: { status: "found", path: steam.install },
          mapsFolder: { status: "found", path: steam.maps },
          pluginsFolder: { status: "missing", path: `${steam.install}/Ballest/Binaries/Win64/plugins` }
        }
        assert.deepStrictEqual(yield* fake.invoke(channels.GAME_PATHS_CHANNEL), found)

        dialogs.answers.push(null)
        assert.isNull(yield* fake.invoke(channels.CHOOSE_GAME_PATH_CHANNEL, { which: "mapsFolder" }))
        dialogs.answers.push(dir)
        assert.deepStrictEqual(yield* fake.invoke(channels.CHOOSE_GAME_PATH_CHANNEL, { which: "mapsFolder" }), {
          ...found,
          mapsFolder: { status: "overridden", path: dir }
        })
        assert.deepStrictEqual(dialogs.asked.map((d) => [d.kind, Option.getOrNull(d.defaultPath)]), [
          ["folder", steam.maps],
          ["folder", steam.maps]
        ])
        // Not the game: refused, and the install stays as found.
        dialogs.answers.push(dir)
        const error = yield* Effect.flip(fake.invoke(channels.CHOOSE_GAME_PATH_CHANNEL, { which: "install" }))
        assert.match(String(error.cause), /isn't Ballest of Them All's folder/)
        assert.deepStrictEqual(yield* fake.invoke(channels.RESET_GAME_PATH_CHANNEL, { which: "mapsFolder" }), found)

        opened.length = 0
        assert.isTrue(yield* fake.invoke(channels.REVEAL_GAME_PATH_CHANNEL, { which: "mapsFolder" }))
        assert.isFalse(yield* fake.invoke(channels.REVEAL_GAME_PATH_CHANNEL, { which: "pluginsFolder" }))
        assert.match(
          String((yield* Effect.flip(fake.invoke(channels.REVEAL_GAME_PATH_CHANNEL, { which: "/etc" }))).cause),
          /Expected/
        )
        assert.deepStrictEqual(opened, [steam.maps])
      })
    ))

  it.effect("launches the game through Steam and tells whether it runs", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        opened.length = 0
        assert.isFalse(yield* fake.invoke(channels.IS_GAME_RUNNING_CHANNEL))
        assert.isTrue(yield* fake.invoke(channels.LAUNCH_GAME_CHANNEL))
        assert.deepStrictEqual(opened, ["steam://rungameid/3339810"])
      })
    ))

  it.effect("finds the creator from Steam's login file", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        assert.isNull(yield* fake.invoke(channels.FIND_CREATOR_CHANNEL))
        const config = path.join(steam.steam, "config")
        yield* fs.makeDirectory(config)
        yield* fs.writeFileString(
          path.join(config, "loginusers.vdf"),
          `"users"\n{\n\t"76561198000000001"\n\t{\n\t\t"PersonaName"\t\t"Marble"\n\t\t"MostRecent"\t\t"1"\n\t}\n}\n`
        )
        assert.deepStrictEqual(yield* fake.invoke(channels.FIND_CREATOR_CHANNEL), { name: "Marble", source: "steam" })
      })
    ))

  it.effect("reports the plugin and installs it once the plugin manager is there", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const folder = path.join(steam.plugins, "ballest-editor-link")
        assert.deepStrictEqual(yield* fake.invoke(channels.PLUGIN_STATUS_CHANNEL), {
          status: "noPluginManager",
          bundledVersion: "0.2.0",
          installedVersion: null,
          folder
        })
        assert.match(
          String((yield* Effect.flip(fake.invoke(channels.INSTALL_PLUGIN_CHANNEL))).cause),
          /plugin manager isn't installed/
        )

        yield* fs.makeDirectory(steam.plugins)
        yield* fs.writeFileString(path.join(path.dirname(steam.plugins), "version.dll"), "")
        assert.deepInclude(yield* fake.invoke(channels.PLUGIN_STATUS_CHANNEL), { status: "missing" })
        assert.deepStrictEqual(yield* fake.invoke(channels.INSTALL_PLUGIN_CHANNEL), {
          plugin: { status: "current", bundledVersion: "0.2.0", installedVersion: "0.2.0", folder },
          restartGame: false
        })
        assert.match(
          String((yield* Effect.flip(fake.invoke(channels.PLUGIN_STATUS_CHANNEL, { folder: "/etc" }))).cause),
          /undefined/
        )
      })
    ))

  it.effect("Play exports the map, hands it to the installed plugin and starts the game", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        opened.length = 0
        const name = "Map_LevelEditorMain&Track_me.balledit"
        const text = JSON.stringify({ worldSettings: { levelData: { levelPublishedFileId: -1 } }, items: [] })
        yield* fake.invoke(channels.CREATE_MAP_CHANNEL, { fileName: name, text })
        yield* fs.makeDirectory(steam.plugins)
        yield* fs.writeFileString(path.join(path.dirname(steam.plugins), "version.dll"), "")
        yield* fake.invoke(channels.INSTALL_PLUGIN_CHANNEL)

        const result = expectTag(
          yield* fake.invokeAs(PlayResult, channels.PLAY_CHANNEL, {
            fileName: name,
            replacePublished: false,
            overwriteChanged: false
          }),
          "Played"
        )
        assert.deepInclude(result, { sent: true, launch: "launched" })
        assert.deepStrictEqual(result.file, { path: path.join(steam.maps, name), name })
        assert.strictEqual(result.link.export?.hash, sha256(new TextEncoder().encode(text)))
        assert.strictEqual(yield* fs.readFileString(path.join(steam.maps, name)), text)
        const play = yield* fs.readFileString(path.join(steam.plugins, "ballest-editor-link", "play.json")).pipe(
          Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(PlayFile)))
        )
        assert.strictEqual(play.map, name)
        assert.deepStrictEqual(opened, ["steam://rungameid/3339810"])
        // Only a project map's file name.
        const bad = yield* Effect.flip(
          fake.invoke(channels.PLAY_CHANNEL, {
            fileName: "../x.balledit",
            replacePublished: false,
            overwriteChanged: false
          })
        )
        assert.match(String(bad.cause), /isn't a map file name/)
      })
    ))

  it.effect("without a game install, the install can be chosen; a folder without the exe isn't saved", () =>
    withHandlers(({ fake, dialogs, dir, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const paths = yield* fake.invokeAs(GamePathsSchema, channels.GAME_PATHS_CHANNEL)
        assert.deepStrictEqual(paths.install, { status: "missing", path: null })
        assert.strictEqual((yield* fake.invokeAs(PluginStatus, channels.PLUGIN_STATUS_CHANNEL)).status, "noGame")

        dialogs.answers.push(dir)
        const error = yield* Effect.flip(fake.invoke(channels.CHOOSE_GAME_PATH_CHANNEL, { which: "install" }))
        assert.match(String(error.cause), /isn't Ballest of Them All's folder/)
        assert.isUndefined((yield* readSettings(fs, dir)).game)

        // the folder the fixture would have put the game in, with the exe: taken, and kept as the override
        const exe = `${steam.install}/Ballest/Binaries/Win64/Ballest-Win64-Shipping.exe`
        yield* fs.makeDirectory(exe.slice(0, exe.lastIndexOf("/")), { recursive: true })
        yield* fs.writeFileString(exe, "")
        dialogs.answers.push(steam.install)
        const chosen = yield* fake.invokeAs(ChooseGamePathResult, channels.CHOOSE_GAME_PATH_CHANNEL, {
          which: "install"
        })
        assert.deepStrictEqual(chosen?.install, { status: "overridden", path: steam.install })
        assert.deepStrictEqual((yield* readSettings(fs, dir)).game, { install: steam.install })
      }), { game: "none" }))
})
