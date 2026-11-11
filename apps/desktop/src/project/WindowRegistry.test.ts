import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { spawnSync } from "node:child_process"
import { runScoped } from "../game/fakeSteam"
import { isProcessAlive, WindowRegistry } from "./WindowRegistry"

/** A registry in a temp folder; `dead` lists the pids no longer running. */
const registry = (dead: ReadonlyArray<number> = []) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped()
    const folder = path.join(dir, "windows")
    const open = (pid: number) => WindowRegistry.make(folder, pid, (other) => !dead.includes(other))
    const files = fs.readDirectory(folder).pipe(Effect.map((names) => [...names].sort()))
    return { files, folder, fs, open, path }
  })

/** `registry`, with the window of pid 1 on a project. */
const oneWindow = Effect.gen(function*() {
  const machine = yield* registry()
  const one = yield* machine.open(1)
  yield* one.announce({ project: "/a", choosing: false })
  return { ...machine, one }
})

describe("WindowRegistry", () => {
  it.effect("lists the other live windows and what they have open, each with its latest", () =>
    runScoped(Effect.gen(function*() {
      const { open } = yield* registry()
      const one = yield* open(1)
      const two = yield* open(2)
      yield* one.announce({ project: "/a", choosing: false })
      yield* two.announce({ project: null, choosing: false })
      assert.deepStrictEqual(yield* one.others, [{ pid: 2, project: null, choosing: false }])
      yield* two.announce({ project: "/b", choosing: false })
      assert.deepStrictEqual(yield* one.others, [{ pid: 2, project: "/b", choosing: false }])
      assert.deepStrictEqual(yield* two.others, [{ pid: 1, project: "/a", choosing: false }])
    })))

  it.effect("has no windows before the first one announces (the folder isn't there yet)", () =>
    runScoped(Effect.gen(function*() {
      const { open } = yield* registry()
      assert.deepStrictEqual(yield* (yield* open(1)).others, [])
    })))

  it.effect("a window that quit is gone", () =>
    runScoped(Effect.gen(function*() {
      const { files, open } = yield* registry()
      const one = yield* open(1)
      const two = yield* open(2)
      yield* one.announce({ project: "/a", choosing: false })
      yield* one.leave
      assert.deepStrictEqual(yield* two.others, [])
      assert.deepStrictEqual(yield* files, [])
      // leaving twice, or without having announced, is nothing
      yield* one.leave
    })))

  it.effect("ignores and removes what a crashed copy left, and leaves live entries alone", () =>
    runScoped(Effect.gen(function*() {
      const { files, folder, fs, open, path } = yield* registry([7])
      const crashed = yield* open(7)
      const live = yield* open(8)
      yield* crashed.announce({ project: "/a", choosing: false })
      yield* live.announce({ project: "/b", choosing: false })
      yield* fs.writeFileString(path.join(folder, "7.json.7.tmp"), "{")
      const reader = yield* open(9)
      assert.deepStrictEqual(yield* reader.others, [{ pid: 8, project: "/b", choosing: false }])
      assert.deepStrictEqual(yield* files, ["8.json"])
    })))

  it.effect("removes files that don't decode, or aren't entries at all", () =>
    runScoped(Effect.gen(function*() {
      const { files, folder, fs, one, path } = yield* oneWindow
      yield* fs.writeFileString(path.join(folder, "2.json"), "not json")
      yield* fs.writeFileString(path.join(folder, "notes.txt"), "")
      assert.deepStrictEqual(yield* one.others, [])
      assert.deepStrictEqual(yield* files, ["1.json"])
    })))

  it.effect("skips its own file, and a temp file of a live copy stays for it to rename", () =>
    runScoped(Effect.gen(function*() {
      const { files, folder, fs, one, path } = yield* oneWindow
      yield* fs.writeFileString(path.join(folder, "2.json.2.tmp"), "{")
      assert.deepStrictEqual(yield* one.others, [])
      assert.deepStrictEqual(yield* files, ["1.json", "2.json.2.tmp"])
    })))

  it.effect("a failed write doesn't stop the window", () =>
    runScoped(Effect.gen(function*() {
      const { fs, folder, open } = yield* registry()
      yield* fs.writeFileString(folder, "a file where the folder goes")
      yield* (yield* open(1)).announce({ project: "/a", choosing: false })
    })))
})

describe("isProcessAlive", () => {
  it("is true for a running process and false for one that exited", () => {
    assert.isTrue(isProcessAlive(process.pid))
    const { pid } = spawnSync(process.execPath, ["-e", ""])
    assert.isFalse(isProcessAlive(pid))
  })
})
