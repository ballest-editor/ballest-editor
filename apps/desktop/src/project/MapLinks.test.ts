import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { linkFilePath, MapLinks } from "./MapLinks"

const hash = "a".repeat(64)
const exported = { path: "/game/UserSavedMaps/a.balledit", hash, at: "2026-10-31T12:00:00.000Z" }

describe("MapLinks", () => {
  it.effect("keeps each map's link, moves it on rename and drops it on null", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const project = yield* fs.makeTempDirectoryScoped()
      const links = yield* MapLinks.make

      assert.deepStrictEqual(yield* links.all(project), {})
      const link = yield* links.modify(project, "a.balledit", (current) => ({
        origin: null,
        export: exported,
        lastSeenHash: current?.lastSeenHash ?? hash
      }))
      assert.deepStrictEqual(link, { origin: null, export: exported, lastSeenHash: hash })
      yield* links.rename(project, "a.balledit", "b.balledit")
      assert.deepStrictEqual(Object.keys(yield* links.all(project)), ["b.balledit"])
      assert.isNull(yield* links.modify(project, "b.balledit", () => null))
      assert.deepStrictEqual(JSON.parse(yield* fs.readFileString(linkFilePath(path, project))), {
        formatVersion: 1,
        maps: {}
      })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("reads a file that doesn't decode as empty, and writes a good one over it", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const project = yield* fs.makeTempDirectoryScoped()
      const links = yield* MapLinks.make
      yield* fs.makeDirectory(path.join(project, ".ballest"))
      yield* fs.writeFileString(linkFilePath(path, project), "{ not json")
      assert.deepStrictEqual(yield* links.all(project), {})
      yield* links.modify(project, "a.balledit", () => ({ origin: exported, export: null, lastSeenHash: null }))
      assert.deepStrictEqual(Object.keys(yield* links.all(project)), ["a.balledit"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
