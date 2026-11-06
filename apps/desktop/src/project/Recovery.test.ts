import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, type Path } from "effect"
import { Recovery } from "./Recovery"
import { WindowRegistry } from "./WindowRegistry"

const KEY_A = "00000000-0000-4000-8000-00000000000a"
const KEY_B = "00000000-0000-4000-8000-00000000000b"

/** `Recovery` as window `pid` sees it, with `alive` the pids still running. */
const windowAt = (dir: string, pid: number, alive: ReadonlySet<number>) =>
  Effect.gen(function*() {
    const registry = yield* WindowRegistry.make(`${dir}/windows`, pid, (other) => alive.has(other))
    yield* registry.announce({ project: null, choosing: false })
    return yield* Recovery.make(`${dir}/recovery`).pipe(Effect.provideService(WindowRegistry, registry))
  })

const inTempDir = <A, E>(body: (dir: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.gen(function*() {
    return yield* body(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))

describe("Recovery", () => {
  it.effect("lists what a dead window left, not what a live one owns", () =>
    inTempDir((dir) =>
      Effect.gen(function*() {
        const crashed = yield* windowAt(dir, 100, new Set([100, 200, 300]))
        const running = yield* windowAt(dir, 200, new Set([100, 200, 300]))
        yield* crashed.write({ key: KEY_A, text: "left behind" })
        yield* running.write({ key: KEY_B, text: "still being edited" })

        const relaunched = yield* windowAt(dir, 300, new Set([200, 300]))
        assert.deepStrictEqual(yield* relaunched.list, [{ key: KEY_A, text: "left behind" }])
      })
    ))

  it.effect("lists a window's own, for a page reloaded after a crash", () =>
    inTempDir((dir) =>
      Effect.gen(function*() {
        const window = yield* windowAt(dir, 100, new Set([100]))
        yield* window.write({ key: KEY_A, text: "one" })
        yield* window.write({ key: KEY_A, text: "two" })
        assert.deepStrictEqual(yield* window.list, [{ key: KEY_A, text: "two" }])
      })
    ))

  it.effect("removes a snapshot whichever window wrote it, and asks nothing of one that is gone", () =>
    inTempDir((dir) =>
      Effect.gen(function*() {
        const crashed = yield* windowAt(dir, 100, new Set([100, 200]))
        yield* crashed.write({ key: KEY_A, text: "left behind" })

        const relaunched = yield* windowAt(dir, 200, new Set([200]))
        yield* relaunched.remove(KEY_A)
        yield* relaunched.remove(KEY_B)
        assert.deepStrictEqual(yield* relaunched.list, [])
      })
    ))

  it.effect("fails a write that can't reach the disk", () =>
    inTempDir((dir) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(`${dir}/recovery`, "a file where the folder goes")
        const window = yield* windowAt(dir, 100, new Set([100]))
        const failed = yield* Effect.flip(window.write({ key: KEY_A, text: "lost" }))
        assert.strictEqual(failed._tag, "RecoveryWriteError")
      })
    ))

  it.effect("has nothing to list before the first write", () =>
    inTempDir((dir) =>
      Effect.gen(function*() {
        assert.deepStrictEqual(yield* (yield* windowAt(dir, 100, new Set([100]))).list, [])
      })
    ))
})
