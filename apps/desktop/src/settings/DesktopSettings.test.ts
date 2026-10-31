import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { DesktopSettings } from "./DesktopSettings"

const window = { x: 10, y: 20, width: 1200, height: 800, maximized: false }

const withSettings = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const dir = yield* fs.makeTempDirectoryScoped()
  const file = path.join(dir, "userData", "desktop-settings.json")
  return { fs, dir, file, settings: yield* DesktopSettings.make(file) }
})

describe("DesktopSettings", () => {
  it.effect("is empty until written, then round-trips through the file", () =>
    Effect.gen(function*() {
      const { fs, dir, file, settings } = yield* withSettings
      assert.deepStrictEqual(yield* settings.get, {})
      yield* settings.update(() => ({ window }))
      assert.deepStrictEqual(yield* settings.get, { window })
      assert.deepStrictEqual(JSON.parse(yield* fs.readFileString(file)), { window })
      // The temp file was renamed over the target, not left behind.
      assert.deepStrictEqual(yield* fs.readDirectory(dir, { recursive: true }), [
        "userData",
        "userData/desktop-settings.json"
      ])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("ignores a file that doesn't decode", () =>
    Effect.gen(function*() {
      const { fs, file, settings } = yield* withSettings
      yield* settings.update(() => ({ window }))
      for (const bad of ["{", "[]", JSON.stringify({ window: { ...window, width: 0 } })]) {
        yield* fs.writeFileString(file, bad)
        assert.deepStrictEqual(yield* settings.get, {})
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("runs concurrent updates one after the other, so none is lost", () =>
    Effect.gen(function*() {
      const { settings } = yield* withSettings
      yield* Effect.all([
        settings.update((s) => ({ ...s, window })),
        settings.update((s) => ({ ...s, project: { recent: ["/maps"] } }))
      ], { concurrency: "unbounded" })
      assert.deepStrictEqual(yield* settings.get, { window, project: { recent: ["/maps"] } })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
