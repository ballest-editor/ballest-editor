import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Option, Path, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { type BackupSettings, DesktopSettings } from "../settings/DesktopSettings"
import { BACKUP_RETENTION, Backups, parseBackupId } from "./Backups"

const MAP = "Map_LevelEditorMain&Big Loop_me.balledit"
const OTHER = "Map_LevelEditorMain&Hairpin_me.balledit"

/** A map file and a backups folder in a temp folder, with `retention` in the desktop settings. */
const setup = (retention?: BackupSettings) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.makeTempDirectoryScoped()
    const settings = yield* DesktopSettings.make(path.join(root, "desktop-settings.json"))
    if (retention !== undefined) yield* settings.update((s) => ({ ...s, backups: retention }))
    const backups = yield* Backups.make.pipe(Effect.provideService(DesktopSettings, settings))
    const dir = path.join(root, "backups")
    const maps = path.join(root, "maps")
    yield* fs.makeDirectory(maps)
    const file = (name = MAP) => path.join(maps, name)
    /** The backups of `name` in the folder, newest first, as their text. */
    const versions = (name = MAP) =>
      backups.list(dir).pipe(
        Effect.flatMap((all) =>
          Effect.forEach(all.filter((b) => b.fileName === name), (b) => fs.readFileString(path.join(dir, b.id)))
        )
      )
    return { fs, path, backups, dir, file, versions }
  })

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer))

describe("Backups", () => {
  it.effect("keeps the old file before writing over it, and nothing when the bytes are the same", () =>
    run(Effect.gen(function*() {
      const { fs, backups, dir, file, versions } = yield* setup()

      // A file that doesn't exist yet is just written.
      assert.isTrue(yield* backups.overwrite(dir, file(), "{\"v\":1}"))
      assert.deepStrictEqual(yield* versions(), [])

      assert.isTrue(yield* backups.overwrite(dir, file(), "{\"v\":2}"))
      assert.strictEqual(yield* fs.readFileString(file()), "{\"v\":2}")
      assert.deepStrictEqual(yield* versions(), ["{\"v\":1}"])

      // The same bytes again: nothing written, nothing backed up.
      assert.isFalse(yield* backups.overwrite(dir, file(), new TextEncoder().encode("{\"v\":2}")))
      assert.deepStrictEqual(yield* versions(), ["{\"v\":1}"])

      // Backups made in the same millisecond keep their order (the test clock doesn't move).
      yield* backups.overwrite(dir, file(), "{\"v\":3}")
      yield* backups.overwrite(dir, file(), "{\"v\":4}")
      assert.deepStrictEqual(yield* versions(), ["{\"v\":3}", "{\"v\":2}", "{\"v\":1}"])
      const ids = (yield* backups.list(dir)).map((b) => b.id)
      assert.strictEqual(new Set(ids).size, 3)
      assert.deepStrictEqual(ids[0], `1970-01-01T00-00-00-002Z ${MAP}`)
    })))

  it.effect("a Rename's old file moves into the backups, or goes when the newest backup has its bytes", () =>
    run(Effect.gen(function*() {
      const { fs, backups, dir, file, versions } = yield* setup()
      // The second time, the newest backup already has those bytes: the file only goes.
      for (const _ of [1, 2]) {
        yield* fs.writeFileString(file(), "{\"old\":1}")
        yield* backups.retire(dir, file())
        assert.isFalse(yield* fs.exists(file()))
        assert.deepStrictEqual(yield* versions(), ["{\"old\":1}"])
      }

      // A file that has gone already is nothing to keep.
      yield* backups.retire(dir, file())
    })))

  it.effect("prunes to the last N versions of each file after a write", () =>
    run(Effect.gen(function*() {
      const { backups, dir, file, versions } = yield* setup({ keep: 2 })
      for (const v of [1, 2, 3, 4, 5]) yield* backups.overwrite(dir, file(), `{"v":${v}}`)
      yield* backups.overwrite(dir, file(OTHER), "{\"other\":1}")
      yield* backups.overwrite(dir, file(OTHER), "{\"other\":2}")
      assert.deepStrictEqual(yield* versions(), ["{\"v\":4}", "{\"v\":3}"])
      assert.deepStrictEqual(yield* versions(OTHER), ["{\"other\":1}"])
    })))

  it.effect("removes backups older than the retention's days, whichever file is written", () =>
    run(Effect.gen(function*() {
      const { backups, dir, file, versions } = yield* setup({ maxAgeDays: 2 })
      yield* backups.overwrite(dir, file(), "{\"v\":1}")
      yield* backups.overwrite(dir, file(), "{\"v\":2}")
      yield* TestClock.adjust("1 day")
      yield* backups.overwrite(dir, file(OTHER), "{\"other\":1}")
      yield* backups.overwrite(dir, file(OTHER), "{\"other\":2}")
      assert.deepStrictEqual(yield* versions(), ["{\"v\":1}"])

      yield* TestClock.adjust("36 hours")
      yield* backups.overwrite(dir, file(OTHER), "{\"other\":3}")
      assert.deepStrictEqual(yield* versions(), [])
      assert.deepStrictEqual(yield* versions(OTHER), ["{\"other\":2}", "{\"other\":1}"])
    })))

  it.effect("defaults to 20 versions for 30 days", () =>
    run(Effect.gen(function*() {
      assert.deepStrictEqual(BACKUP_RETENTION, { keep: 20, maxAgeDays: 30 })
      const { backups, dir, file, versions } = yield* setup()
      for (let v = 0; v < 23; v++) yield* backups.overwrite(dir, file(), `{"v":${v}}`)
      assert.lengthOf(yield* versions(), 20)
      assert.strictEqual((yield* versions())[0], "{\"v\":21}")
    })))

  it.effect("leaves the file as it was when the backup can't be made", () =>
    run(Effect.gen(function*() {
      const { fs, backups, dir, file } = yield* setup()
      yield* fs.writeFileString(file(), "{\"v\":1}")
      // A file where the folder should be: the backup can't go in.
      yield* fs.writeFileString(dir, "")
      const error = yield* Effect.flip(backups.overwrite(dir, file(), "{\"v\":2}"))
      assert.strictEqual(error.reason, "backup")
      assert.match(error.message, /Couldn't back up .*, so it wasn't written over/)
      assert.strictEqual(yield* fs.readFileString(file()), "{\"v\":1}")
    })))

  it.effect("lists only the backups it wrote", () =>
    run(Effect.gen(function*() {
      const { fs, path, backups, dir, file } = yield* setup()
      yield* backups.overwrite(dir, file(), "{\"v\":1}")
      yield* backups.overwrite(dir, file(), "{\"v\":2}")
      yield* fs.writeFileString(path.join(dir, "notes.txt"), "")
      yield* fs.writeFileString(path.join(dir, "2026-10-31T12-00-00-000Z notes.txt"), "")
      assert.deepStrictEqual((yield* backups.list(dir)).map((b) => b.fileName), [MAP])
      assert.deepStrictEqual(yield* backups.list(path.join(dir, "missing")), [])
    })))
})

describe("parseBackupId", () => {
  it("reads the time and file name back, and refuses anything else", () => {
    assert.deepStrictEqual(
      parseBackupId(`2026-10-31T12-05-09-120Z ${MAP}`),
      Option.some({
        id: `2026-10-31T12-05-09-120Z ${MAP}`,
        fileName: MAP,
        at: "2026-10-31T12:05:09.120Z",
        millis: Date.UTC(2026, 9, 31, 12, 5, 9, 120)
      })
    )
    for (
      const bad of [
        MAP,
        `2026-10-31T12-05-09-120Z`,
        `2026-10-31T12-05-09-120Z ../${MAP}`,
        `2026-10-31T12-05-09-120Z a\\${MAP}`,
        `2026-10-31T12-05-09-120Z notes.txt`,
        `2026-13-45T99-05-09-120Z ${MAP}`
      ]
    ) assert.isTrue(Option.isNone(parseBackupId(bad)), bad)
  })
})
