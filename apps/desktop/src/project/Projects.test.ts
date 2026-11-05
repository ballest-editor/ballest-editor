import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { layerFakeGamePaths, runScoped, tempFakeSteam } from "../game/fakeSteam"
import { DesktopSettings } from "../settings/DesktopSettings"
import { Projects } from "./Projects"

/** Two windows: two `Projects`, each a running copy of the app, over one settings file. */
const twoWindows = (recent: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const { dir, fs, path, steam } = yield* tempFakeSteam
    const settings = path.join(dir, "desktop-settings.json")
    yield* fs.writeFileString(settings, JSON.stringify({ project: { recent: recent.map((p) => path.join(dir, p)) } }))
    const services = layerFakeGamePaths(steam.host, settings).pipe(
      Layer.provideMerge(Layer.effect(DesktopSettings, DesktopSettings.make(settings)))
    )
    const open = Projects.make(dir, "linux").pipe(Effect.provide(services))
    return { first: yield* open, second: yield* open, at: (name: string) => path.join(dir, name) }
  })

describe("Projects", () => {
  it.effect("keeps a window on its project when another window changes project", () =>
    runScoped(Effect.gen(function*() {
      const { first, second, at } = yield* twoWindows(["one"])
      yield* second.use(at("two"))
      assert.strictEqual(Option.getOrNull(yield* first.current), at("one"))
      assert.strictEqual(Option.getOrNull(yield* second.current), at("two"))
      assert.strictEqual((yield* first.state).current?.path, at("one"))
      assert.deepStrictEqual((yield* first.state).recent.map((p) => p.path), [at("two")])
    })))

  it.effect("leaves an Untitled Project window untitled when another window picks a project", () =>
    runScoped(Effect.gen(function*() {
      const { first, second, at } = yield* twoWindows([])
      yield* second.use(at("two"))
      assert.isTrue(Option.isNone(yield* first.current))
      assert.isNull((yield* first.state).current)
    })))
})
