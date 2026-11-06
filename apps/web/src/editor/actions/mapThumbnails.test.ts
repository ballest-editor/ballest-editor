import { assert, beforeEach, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { vi } from "vitest"
import { makeTestDisk, projectFile, testHash } from "../../test/desktopBridge"
import { createNewMap, edit, layerFor, reset, s } from "../../test/editorActions"
import { useEditor } from "../store"
import { cacheMapThumbnail } from "./mapThumbnails"
import { saveMapFile } from "./save"

const render = vi.hoisted(() => ({ calls: 0, result: "data:image/png;base64,AAAA" as string | undefined }))

vi.mock("../mapThumbnails", () => ({
  mapRowThumbnailFor: () => {
    render.calls += 1
    return Promise.resolve(render.result)
  }
}))

const FILE = "Map_LevelEditorMain&Big Loop_Isaac.balledit"

/** Lets the render a Save left running in the background finish. */
const settled = Effect.promise(() => new Promise((resolve) => setTimeout(resolve)))

describe("map thumbnails", () => {
  beforeEach(() => {
    render.calls = 0
    render.result = "data:image/png;base64,AAAA"
    useEditor.setState({ mapThumbnails: new Map() })
  })

  it.live("A Save renders the map in the background and keeps it under the file's hash", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      yield* settled
      const hash = testHash(disk.files.get(projectFile(FILE))!)
      assert.strictEqual(render.calls, 1)
      assert.strictEqual(s().mapThumbnails.get(hash), render.result)
      assert.strictEqual(disk.thumbnails.get(hash), render.result)

      edit()
      yield* saveMapFile
      yield* settled
      assert.strictEqual(render.calls, 2)
      const saved = testHash(disk.files.get(projectFile(FILE))!)
      assert.notStrictEqual(saved, hash)
      assert.deepStrictEqual([...s().mapThumbnails.keys()], [saved])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("The same bytes aren't rendered twice", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      s().setMapThumbnail("a".repeat(64), "data:image/png;base64,BBBB")
      yield* cacheMapThumbnail(s().doc, "a".repeat(64))
      assert.strictEqual(render.calls, 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("A map with nothing to draw keeps its glyph", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      render.result = undefined
      yield* cacheMapThumbnail(s().doc, "c".repeat(64))
      assert.strictEqual(render.calls, 1)
      assert.strictEqual(s().mapThumbnails.size, 0)
      assert.strictEqual(disk.thumbnails.size, 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
