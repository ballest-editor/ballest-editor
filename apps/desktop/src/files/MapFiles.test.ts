import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Path } from "effect"
import { DesktopSettings } from "../settings/DesktopSettings"
import { MapFiles } from "./MapFiles"

const samplesDir = new URL("../../../../samples/UserSavedMaps/", import.meta.url)

/** A temp folder with its own settings file; `restart` builds a second MapFiles over the same settings. */
const setup = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const dir = yield* fs.makeTempDirectoryScoped()
  const settingsLayer = Layer.effect(DesktopSettings, DesktopSettings.make(path.join(dir, "desktop-settings.json")))
  const restart = MapFiles.make.pipe(Effect.provide(settingsLayer))
  return { fs, path, dir, files: yield* restart, restart }
})

describe("MapFiles", () => {
  it.effect("writes and reads every sample byte for byte", () =>
    Effect.gen(function*() {
      const { fs, path, dir, files } = yield* setup
      const samples = (yield* fs.readDirectory(samplesDir.pathname)).filter((name) => name.endsWith(".balledit"))
      assert.isAtLeast(samples.length, 1)
      for (const name of samples) {
        const original = yield* fs.readFile(path.join(samplesDir.pathname, name))
        const target = path.join(dir, name)
        yield* files.grant(target)
        yield* files.write(target, new TextDecoder().decode(original))
        assert.deepStrictEqual(yield* fs.readFile(target), original, name)
        const read = yield* files.read(target)
        assert.deepStrictEqual(new TextEncoder().encode(read.text), original, name)
        assert.strictEqual(read.name, name)
      }
      // Each write renamed its temp file over the target.
      assert.isFalse((yield* fs.readDirectory(dir)).some((name) => name.endsWith(".tmp")))
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("only touches picked map files", () =>
    Effect.gen(function*() {
      const { fs, path, dir, files } = yield* setup
      const map = path.join(dir, "a.balledit")
      yield* fs.writeFileString(map, "{}")
      assert.strictEqual((yield* Effect.flip(files.read(map))).reason, "notPicked")
      assert.strictEqual((yield* Effect.flip(files.write(map, "x"))).reason, "notPicked")
      assert.strictEqual(yield* fs.readFileString(map), "{}")

      const script = path.join(dir, "evil.sh")
      yield* files.grant(script)
      assert.strictEqual((yield* Effect.flip(files.write(script, "rm -rf ~"))).reason, "extension")
      assert.isFalse(yield* fs.exists(script))

      yield* files.grant(path.join(dir, "sub", "..", "a.balledit"))
      assert.strictEqual((yield* files.read(map)).text, "{}")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("keeps the last 8 files, most recent first, and remembers them after a restart", () =>
    Effect.gen(function*() {
      const { fs, path, dir, files, restart } = yield* setup
      const names = Array.from({ length: 10 }, (_, i) => path.join(dir, `m${i}.balledit`))
      for (const file of names) {
        yield* files.grant(file)
        yield* files.write(file, file)
      }
      yield* files.read(names[5]!)
      const expected = [names[5], names[9], names[8], names[7], names[6], names[4], names[3], names[2]]
      assert.deepStrictEqual((yield* files.recent).map((f) => f.path), expected)

      // A new session may read the recent files without a dialog, and nothing else.
      const next = yield* restart
      assert.strictEqual((yield* next.read(names[2]!)).text, names[2])
      assert.strictEqual((yield* Effect.flip(next.read(names[1]!))).reason, "notPicked")

      // A recent file that has gone is dropped from the list.
      yield* fs.remove(names[9]!)
      assert.strictEqual((yield* Effect.flip(next.read(names[9]!))).reason, "notFound")
      assert.notInclude((yield* next.recent).map((f) => f.path), names[9])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
