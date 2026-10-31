import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Option, Path, type Scope } from "effect"
import * as Fs from "node:fs"
import { layerFakeGamePaths, makeFakeSteam } from "./fakeSteam"
import { GameCreator, mostCommonCreator } from "./GameCreator"

const fixture = (name: string) => Fs.readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8")

/** GameCreator over a fake Steam tree in a temp folder; `login` is the loginusers.vdf fixture Steam has, if any. */
const setup = (options: { readonly login?: string; readonly maps?: ReadonlyArray<string> }) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped()
    const fake = yield* makeFakeSteam(dir, { game: "steam", ran: true })
    if (options.login !== undefined) {
      yield* fs.makeDirectory(path.join(fake.steam, "config"))
      yield* fs.writeFileString(path.join(fake.steam, "config", "loginusers.vdf"), fixture(options.login))
    }
    if (options.maps !== undefined) {
      yield* fs.makeDirectory(fake.maps)
      for (const name of options.maps) yield* fs.writeFileString(path.join(fake.maps, name), "{}")
    }
    const services = GameCreator.layer.pipe(
      Layer.provide(layerFakeGamePaths(fake.host, path.join(dir, "desktop-settings.json")))
    )
    return yield* GameCreator.pipe(Effect.provide(services))
  })

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope | NodeServices.NodeServices>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer))

const map = (name: string, creator: string) => `Map_LevelEditorMain&${name}_${creator}.balledit`

describe("GameCreator", () => {
  it.effect("takes the persona name from Steam's login file, before the maps folder", () =>
    run(Effect.gen(function*() {
      const creator = yield* setup({ login: "loginusers.several.vdf", maps: [map("Loop", "Someone Else")] })
      assert.deepStrictEqual(yield* creator.find, Option.some({ name: "Speedy Marble", source: "steam" as const }))
    })))

  it.effect("passes on a persona name the editor would refuse, for the renderer to explain", () =>
    run(Effect.gen(function*() {
      const creator = yield* setup({ login: "loginusers.invalid.vdf" })
      assert.deepStrictEqual(yield* creator.find, Option.some({ name: "xX_Marble_Xx ★", source: "steam" as const }))
    })))

  it.effect("falls back to the creator most maps in the maps folder name", () =>
    run(Effect.gen(function*() {
      const creator = yield* setup({
        maps: [map("Big Loop", "Isaac"), map("Test3", "Isaac"), map("Copied", "Friend"), "notes.txt"]
      })
      assert.deepStrictEqual(yield* creator.find, Option.some({ name: "Isaac", source: "mapsFolder" as const }))
    })))

  it.effect("finds nothing without a login file or maps", () =>
    run(Effect.gen(function*() {
      assert.deepStrictEqual(yield* (yield* setup({})).find, Option.none())
      assert.deepStrictEqual(yield* (yield* setup({ maps: [] })).find, Option.none())
    })))

  it("counts creators by file name, breaking ties by the first file", () => {
    assert.deepStrictEqual(mostCommonCreator([map("b", "Zed"), map("a", "Amy")]), Option.some("Amy"))
    assert.deepStrictEqual(
      mostCommonCreator([map("a", "Amy"), map("b", "Zed"), map("c", "Zed")]),
      Option.some("Zed")
    )
    assert.deepStrictEqual(mostCommonCreator(["Map_LevelEditorMain&NoCreator.balledit", "x.ballmap"]), Option.none())
  })
})
