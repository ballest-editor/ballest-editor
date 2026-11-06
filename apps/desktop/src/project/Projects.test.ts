import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { vi } from "vitest"
import { layerFakeGamePaths, runScoped, tempFakeSteam } from "../game/fakeSteam"
import { DesktopSettings } from "../settings/DesktopSettings"
import { Projects } from "./Projects"
import { type WindowEntry, WindowRegistry } from "./WindowRegistry"

// The services' layers call Electron; these tests replace them, so only the module import needs a stand-in.
vi.mock("electron", () => ({}))

/**
 * A machine with `recent` projects: `open` starts a window on it, a `Projects` of its own with pid `pid` (the windows
 * are running copies of the app, over one settings file and one registry). `at` names a folder in it.
 */
const machine = (recent: ReadonlyArray<string>, platform: NodeJS.Platform = "linux") =>
  Effect.gen(function*() {
    const { dir, fs, path, steam } = yield* tempFakeSteam
    const settings = path.join(dir, "desktop-settings.json")
    const at = (name: string) => path.join(dir, name)
    yield* fs.writeFileString(settings, JSON.stringify({ project: { recent: recent.map(at) } }))
    const services = layerFakeGamePaths(steam.host, settings).pipe(
      Layer.provideMerge(Layer.effect(DesktopSettings, DesktopSettings.make(settings)))
    )
    const start = (windows: WindowRegistry["Service"], launchProject: Option.Option<string> = Option.none()) =>
      Projects.make(dir, platform, launchProject).pipe(
        Effect.provideService(WindowRegistry, windows),
        Effect.provide(services)
      )
    const open = (pid: number, launchProject?: Option.Option<string>) =>
      WindowRegistry.make(at("windows"), pid, () => true).pipe(
        Effect.flatMap((windows) => start(windows, launchProject))
      )
    return { open, start, at, dir, fs, path, steam }
  })

const refusalOf = <A, R>(effect: Effect.Effect<A, { readonly message: string }, R>) =>
  Effect.flip(effect).pipe(Effect.map((error) => error.message))

describe("Projects", () => {
  it.effect("keeps a window on its project when another window changes project", () =>
    runScoped(Effect.gen(function*() {
      const { at, open } = yield* machine(["one"])
      const first = yield* open(1)
      // the second start finds "one" open, so it chooses
      const second = yield* open(2)
      yield* second.use(at("two"))
      assert.strictEqual(Option.getOrNull(yield* first.current), at("one"))
      assert.strictEqual(Option.getOrNull(yield* second.current), at("two"))
      assert.strictEqual((yield* first.state).current?.path, at("one"))
      assert.deepStrictEqual((yield* first.state).recent.map((p) => p.path), [at("two")])
    })))

  it.effect("leaves an Untitled Project window untitled when another window picks a project", () =>
    runScoped(Effect.gen(function*() {
      const { at, open } = yield* machine([])
      const first = yield* open(1)
      const second = yield* open(2)
      yield* second.use(at("two"))
      assert.isTrue(Option.isNone(yield* first.current))
      assert.isNull((yield* first.state).current)
    })))
})

describe("starting a window", () => {
  it.effect("the first window takes the last project, or Untitled Project, and needs no chooser", () =>
    runScoped(Effect.gen(function*() {
      const { at, open } = yield* machine(["one"])
      const state = yield* (yield* open(1)).state
      assert.strictEqual(state.current?.path, at("one"))
      assert.isFalse(state.chooserRequired)
      const untitled = yield* machine([])
      const alone = yield* (yield* untitled.open(1)).state
      assert.isNull(alone.current)
      assert.isFalse(alone.chooserRequired)
    })))

  it.effect("a second window beside Untitled Project shows the chooser, with nothing in use", () =>
    runScoped(Effect.gen(function*() {
      const { open } = yield* machine([])
      yield* open(1)
      const second = yield* open(2)
      const state = yield* second.state
      assert.isTrue(state.chooserRequired)
      assert.isNull(state.current)
      assert.isTrue(Option.isNone(yield* second.current))
      // no project in use: main refuses anything that would write a map
      assert.match(yield* refusalOf(second.ensure), /no project yet/)
    })))

  it.effect("a second window on the project already open shows the chooser, which lists it as open elsewhere", () =>
    runScoped(Effect.gen(function*() {
      const { at, open } = yield* machine(["one", "two"])
      yield* open(1)
      const state = yield* (yield* open(2)).state
      assert.isTrue(state.chooserRequired)
      assert.isNull(state.current)
      assert.deepStrictEqual(state.recent.map((p) => p.path), [at("one"), at("two")])
      assert.deepStrictEqual(state.openElsewhere, [at("one")])
    })))

  it.effect("a window in the chooser isn't Untitled Project: the next one starts as usual", () =>
    runScoped(Effect.gen(function*() {
      const { at, fs, open } = yield* machine([])
      yield* open(1)
      const choosing = yield* open(2)
      // the Untitled Project window quits; the chooser beside it stays, and holds nothing back
      yield* fs.remove(at("windows/1.json"))
      assert.isTrue((yield* choosing.state).chooserRequired)
      assert.isFalse((yield* (yield* open(3)).state).chooserRequired)
    })))

  it.effect("two copies starting together don't both take the project: the lower pid keeps it", () =>
    runScoped(Effect.gen(function*() {
      const { at, start } = yield* machine(["one"])
      // Each looked before the other announced, so the first look is empty and the rival only shows on the second.
      const racing = (pid: number, rival: number) =>
        Effect.gen(function*() {
          const announced: Array<Omit<WindowEntry, "pid">> = []
          let looks = 0
          const others = Effect.sync(() => ++looks === 1 ? [] : [{ pid: rival, project: at("one"), choosing: false }])
          const projects = yield* start(
            WindowRegistry.of({
              pid,
              others,
              announce: (entry) => Effect.sync(() => void announced.push(entry)),
              leave: Effect.void
            })
          )
          return { announced, state: yield* projects.state }
        })

      const lower = yield* racing(3, 9)
      assert.strictEqual(lower.state.current?.path, at("one"))
      assert.isFalse(lower.state.chooserRequired)
      assert.deepStrictEqual(lower.announced, [{ project: at("one"), choosing: false }])

      const higher = yield* racing(9, 3)
      assert.isNull(higher.state.current)
      assert.isTrue(higher.state.chooserRequired)
      assert.deepStrictEqual(higher.announced.at(-1), { project: null, choosing: true })
    })))

  it.effect("the chooser's pick ends the chooser and tells the other windows", () =>
    runScoped(Effect.gen(function*() {
      const { at, open } = yield* machine(["one", "two"])
      const first = yield* open(1)
      const second = yield* open(2)
      const picked = yield* second.switchTo(at("two"))
      assert.isFalse(picked.chooserRequired)
      assert.strictEqual(picked.current?.path, at("two"))
      assert.deepStrictEqual((yield* first.state).openElsewhere, [at("two")])
    })))
})

describe("a project open in another window", () => {
  it.effect("is refused by a recent project, a picked folder and New project, and nothing changes", () =>
    runScoped(Effect.gen(function*() {
      const { at, fs, open, path } = yield* machine(["one", "two"])
      const first = yield* open(1)
      const second = yield* open(2)
      yield* second.use(at("two"))

      assert.match(yield* refusalOf(first.switchTo(at("two"))), /is open in another window/)
      assert.match(yield* refusalOf(first.use(at("two"))), /is open in another window/)
      assert.match(yield* refusalOf(first.pick(at("two"))), /is open in another window/)
      assert.match(yield* refusalOf(first.check({ _tag: "Existing", path: at("two") })), /is open in another window/)
      assert.strictEqual(Option.getOrNull(yield* first.current), at("one"))

      // a folder another window uses but hasn't made yet is refused before New project writes anything in it
      const unmade = at("New one")
      yield* second.use(unmade)
      assert.match(yield* refusalOf(first.createNew({ name: "New one" })), /is open in another window/)
      assert.isFalse(yield* fs.exists(path.join(unmade, "ballest-project.json")))
    })))

  it.effect("compares folders the way the platform does", () =>
    runScoped(Effect.gen(function*() {
      const { at, open, path } = yield* machine(["one"], "win32")
      const first = yield* open(1)
      const second = yield* open(2)
      assert.match(yield* refusalOf(second.use(path.join(path.dirname(at("one")), "ONE"))), /is open in another window/)
      assert.isFalse((yield* first.state).chooserRequired)
    })))

  it.effect("is free again once its window is gone", () =>
    runScoped(Effect.gen(function*() {
      const { at, fs, open } = yield* machine(["one"])
      yield* open(1)
      const second = yield* open(2)
      yield* fs.remove(at("windows/1.json"))
      assert.strictEqual((yield* second.switchTo(at("one"))).current?.path, at("one"))
    })))
})

describe("a window started with --project", () => {
  it.effect("goes straight there, past the chooser, and the project becomes the most recent", () =>
    runScoped(Effect.gen(function*() {
      const { at, fs, open } = yield* machine(["one"])
      yield* fs.makeDirectory(at("two"))
      // beside Untitled Project it would otherwise have to choose
      const empty = yield* machine([])
      yield* empty.fs.makeDirectory(empty.at("two"))
      yield* empty.open(1)
      const beside = yield* (yield* empty.open(2, Option.some(empty.at("two")))).state
      assert.strictEqual(beside.current?.path, empty.at("two"))
      assert.isFalse(beside.chooserRequired)

      yield* open(1)
      const state = yield* (yield* open(2, Option.some(at("two")))).state
      assert.strictEqual(state.current?.path, at("two"))
      assert.isFalse(state.chooserRequired)
      assert.isNull(state.startRefused)
      assert.deepStrictEqual(state.recent.map((p) => p.path), [at("one")])
      assert.strictEqual((yield* (yield* open(3)).state).recent[0]?.path, at("two"))
    })))

  it.effect("refuses the game's maps folder, what isn't an absolute folder, and starts as it would have", () =>
    runScoped(Effect.gen(function*() {
      const { at, fs, open, path, steam } = yield* machine(["one"])
      yield* fs.writeFileString(at("a file"), "")
      yield* fs.makeDirectory(path.join(steam.maps, "sub"), { recursive: true })
      yield* fs.makeDirectory(at("there"))
      const refusals = [
        [steam.maps, /game's maps folder or inside it/],
        [path.join(steam.maps, "sub"), /game's maps folder or inside it/],
        // a folder that exists, so only being relative can refuse it
        [path.relative(process.cwd(), at("there")), /isn't a folder/],
        [at("missing"), /isn't a folder/],
        [at("a file"), /isn't a folder/]
      ] as const
      for (const [folder, refusal] of refusals) {
        const window = yield* open(1, Option.some(folder))
        const state = yield* window.state
        assert.strictEqual(state.current?.path, at("one"))
        assert.match(state.startRefused ?? "", refusal)
      }
    })))

  it.effect("won't open a project twice: open elsewhere, the window chooses", () =>
    runScoped(Effect.gen(function*() {
      const { at, fs, open } = yield* machine(["one"])
      yield* fs.makeDirectory(at("one"))
      yield* open(1)
      const state = yield* (yield* open(2, Option.some(at("one")))).state
      assert.isTrue(state.chooserRequired)
      assert.isNull(state.current)
    })))
})

describe("a new project in a folder the user chose", () => {
  it.effect("is made there under the name given, and used; the folder keeps its own name", () =>
    runScoped(Effect.gen(function*() {
      const { at, fs, open, path } = yield* machine(["one"])
      const window = yield* open(1)
      const folder = at("elsewhere/Season 3")
      yield* fs.makeDirectory(folder, { recursive: true })
      yield* window.pick(folder)

      yield* window.check({ _tag: "New", name: "My Maps", folder })
      assert.isFalse(yield* fs.exists(path.join(folder, "ballest-project.json")))

      const state = yield* window.createNew({ name: " My Maps ", folder })
      assert.deepInclude(state.current, { path: folder, name: "My Maps", exists: true })
      assert.isTrue(yield* fs.exists(path.join(folder, "maps")))
      assert.isTrue(yield* fs.exists(path.join(folder, ".ballest")))
    })))

  it.effect("must be a folder picked in a dialog: the page can't name any other", () =>
    runScoped(Effect.gen(function*() {
      const { at, fs, open, path } = yield* machine(["one"])
      const window = yield* open(1)
      const folder = at("random")
      assert.match(yield* refusalOf(window.createNew({ name: "My Maps", folder })), /picked/)
      assert.isFalse(yield* fs.exists(path.join(folder, "ballest-project.json")))
    })))

  it.effect("is refused where a project is already, and nothing changes", () =>
    runScoped(Effect.gen(function*() {
      const { at, open } = yield* machine(["one"])
      const window = yield* open(1)
      const folder = at("taken")
      yield* window.pick(folder)
      yield* window.createNew({ name: "Taken", folder })
      const before = yield* window.state
      assert.match(yield* refusalOf(window.createNew({ name: "Again", folder })), /already holds a project/)
      assert.deepStrictEqual((yield* window.state).current, before.current)
    })))
})

describe("preparing a new window", () => {
  it.effect("checking a new project writes nothing; preparing makes its folder without using it", () =>
    runScoped(Effect.gen(function*() {
      const { dir, fs, open, path } = yield* machine(["one"])
      const window = yield* open(1)
      const folder = path.join(dir, "Season 3")

      yield* window.check({ _tag: "New", name: " Season 3 " })
      assert.isFalse(yield* fs.exists(folder))

      assert.strictEqual(yield* window.prepareWindow({ _tag: "New", name: "Season 3" }), folder)
      assert.isTrue(yield* fs.exists(path.join(folder, "ballest-project.json")))
      assert.notStrictEqual((yield* window.state).current?.path, folder)

      assert.match(yield* refusalOf(window.check({ _tag: "New", name: "Season 3" })), /already holds a project/)
      assert.match(yield* refusalOf(window.check({ _tag: "New", name: "a/b" })), /can't name a folder/)
    })))

  it.effect("takes only folders main knows: recent ones and picked ones", () =>
    runScoped(Effect.gen(function*() {
      const { at, open } = yield* machine(["one", "two"])
      const window = yield* open(1)
      assert.match(yield* refusalOf(window.prepareWindow({ _tag: "Existing", path: at("random") })), /picked/)
      assert.strictEqual(yield* window.prepareWindow({ _tag: "Existing", path: at("two") }), at("two"))
      yield* window.pick(at("random"))
      assert.strictEqual(yield* window.prepareWindow({ _tag: "Existing", path: at("random") }), at("random"))
      assert.strictEqual((yield* window.switchTo(at("random"))).current?.path, at("random"))
    })))
})
