import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { layerFakeGamePaths, runScoped, tempFakeSteam } from "../game/fakeSteam"
import { DesktopSettings } from "../settings/DesktopSettings"
import { Projects } from "./Projects"
import { type WindowEntry, WindowRegistry } from "./WindowRegistry"

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
      yield* first.use(at("one"))
      const second = yield* open(2)
      yield* second.use(at("two"))
      assert.strictEqual(Option.getOrNull(yield* first.current), at("one"))
      assert.strictEqual(Option.getOrNull(yield* second.current), at("two"))
      assert.strictEqual((yield* first.state).current?.path, at("one"))
      assert.deepStrictEqual((yield* first.state).recent.map((p) => p.path), [at("two")])
    })))

  it.effect("leaves a window on the welcome window when another window picks a project", () =>
    runScoped(Effect.gen(function*() {
      const { at, open } = yield* machine([])
      const first = yield* open(1)
      const second = yield* open(2)
      yield* second.use(at("two"))
      assert.isTrue(Option.isNone(yield* first.current))
      assert.isTrue((yield* first.state).chooserRequired)
    })))
})

describe("starting a window", () => {
  it.effect("every window starts on the welcome window, with nothing in use, whatever was used last", () =>
    runScoped(Effect.gen(function*() {
      for (const recent of [["one"], []]) {
        const { open } = yield* machine(recent)
        const window = yield* open(1)
        const state = yield* window.state
        assert.isTrue(state.chooserRequired)
        assert.isNull(state.current)
        assert.isTrue(Option.isNone(yield* window.current))
        // no project in use: main refuses anything that would write a map
        assert.match(yield* refusalOf(window.ensure), /no project yet/)
      }
    })))

  it.effect("a second window lists the project the first has open as open elsewhere", () =>
    runScoped(Effect.gen(function*() {
      const { at, open } = yield* machine(["one", "two"])
      yield* (yield* open(1)).use(at("one"))
      const state = yield* (yield* open(2)).state
      assert.isTrue(state.chooserRequired)
      assert.isNull(state.current)
      assert.deepStrictEqual(state.recent.map((p) => p.path), [at("one"), at("two")])
      assert.deepStrictEqual(state.openElsewhere, [at("one")])
    })))

  it.effect("two copies starting together on one --project don't both take it: the lower pid keeps it", () =>
    runScoped(Effect.gen(function*() {
      const { at, fs, start } = yield* machine(["one"])
      yield* fs.makeDirectory(at("one"))
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
            }),
            Option.some(at("one"))
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
      yield* first.use(at("one"))
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
      yield* first.use(at("one"))
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
      yield* (yield* open(1)).use(at("one"))
      const second = yield* open(2)
      assert.match(yield* refusalOf(second.use(path.join(path.dirname(at("one")), "ONE"))), /is open in another window/)
    })))

  it.effect("is free again once its window is gone", () =>
    runScoped(Effect.gen(function*() {
      const { at, fs, open } = yield* machine(["one"])
      yield* (yield* open(1)).use(at("one"))
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
      yield* (yield* open(1)).use(at("one"))
      const state = yield* (yield* open(2, Option.some(at("two")))).state
      assert.strictEqual(state.current?.path, at("two"))
      assert.isFalse(state.chooserRequired)
      assert.isNull(state.startRefused)
      assert.deepStrictEqual(state.recent.map((p) => p.path), [at("one")])
      assert.strictEqual((yield* (yield* open(3)).state).recent[0]?.path, at("two"))
    })))

  it.effect("refuses the game's maps folder, what isn't an absolute folder, and starts on the welcome window", () =>
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
        assert.isNull(state.current)
        assert.isTrue(state.chooserRequired)
        assert.match(state.startRefused ?? "", refusal)
      }
    })))

  it.effect("won't open a project twice: open elsewhere, the window chooses", () =>
    runScoped(Effect.gen(function*() {
      const { at, fs, open } = yield* machine(["one"])
      yield* fs.makeDirectory(at("one"))
      yield* (yield* open(1)).use(at("one"))
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

describe("the recent projects", () => {
  it.effect("say when each was last opened: only what was opened since the times were kept has one", () =>
    runScoped(Effect.gen(function*() {
      const { at, open } = yield* machine(["old"])
      const projects = yield* open(1)
      yield* projects.use(at("first"))
      yield* projects.use(at("second"))
      const { recent } = yield* projects.state
      assert.deepStrictEqual(recent.map((p) => p.path), [at("first"), at("old")])
      assert.isString(recent[0]?.lastOpened)
      assert.isNull(recent[1]?.lastOpened)
    })))

  it.effect("forgetting one takes it and its time off the list, and leaves its folder", () =>
    runScoped(Effect.gen(function*() {
      const { at, fs, open } = yield* machine([])
      const projects = yield* open(1)
      yield* fs.makeDirectory(at("gone"))
      yield* projects.use(at("gone"))
      yield* projects.use(at("kept"))
      assert.deepStrictEqual((yield* projects.forget(at("gone"))).recent, [])
      assert.isTrue(yield* fs.exists(at("gone")))

      // back on the list, it starts over
      assert.isTrue(Option.isNone(yield* Effect.option(projects.knownFolder(at("gone")))))
      yield* projects.use(at("gone"))
      yield* projects.use(at("kept"))
      assert.strictEqual((yield* projects.state).recent[0]?.path, at("gone"))
    })))

  it.effect("are the only folders that can be revealed by path, and one that's gone says so", () =>
    runScoped(Effect.gen(function*() {
      const { at, dir, fs, open } = yield* machine(["there", "gone"])
      const projects = yield* open(1)
      yield* fs.makeDirectory(at("there"))
      assert.strictEqual(Option.getOrNull(yield* projects.knownFolder(at("there"))), at("there"))
      assert.isTrue(Option.isNone(yield* projects.knownFolder(at("gone"))))
      assert.match(yield* refusalOf(projects.knownFolder(dir)), /picked/i)
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

describe("the open maps", () => {
  const big = "Map_LevelEditorMain&Big Loop_me.balledit"
  const hairpin = "Map_LevelEditorMain&Hairpin_me.balledit"

  it.effect("are kept per project, for opening it again; with no project there is nothing to keep", () =>
    runScoped(Effect.gen(function*() {
      const { at, open } = yield* machine(["one", "two"])
      const window = yield* open(1)
      yield* window.rememberOpenMaps({ files: [big], active: big })
      assert.deepStrictEqual((yield* window.state).openMaps, { files: [], active: null })

      yield* window.use(at("one"))
      assert.deepStrictEqual((yield* window.state).openMaps, { files: [], active: null })
      yield* window.rememberOpenMaps({ files: [big, hairpin], active: hairpin })
      yield* window.use(at("two"))
      assert.deepStrictEqual((yield* window.state).openMaps, { files: [], active: null })
      assert.deepStrictEqual((yield* window.use(at("one"))).openMaps, { files: [big, hairpin], active: hairpin })

      // all closed: nothing to reopen
      yield* window.rememberOpenMaps({ files: [], active: null })
      assert.deepStrictEqual((yield* (yield* open(2)).switchTo(at("two"))).openMaps, { files: [], active: null })
      assert.deepStrictEqual((yield* window.state).openMaps, { files: [], active: null })
    })))

  it.effect("refuse what isn't a map file name, and an active map that isn't one of them", () =>
    runScoped(Effect.gen(function*() {
      const { at, open } = yield* machine(["one"])
      const window = yield* open(1)
      yield* window.use(at("one"))
      assert.match(
        yield* refusalOf(window.rememberOpenMaps({ files: ["../x"], active: null })),
        /isn't a map file name/
      )
      assert.match(
        yield* refusalOf(window.rememberOpenMaps({ files: [big], active: hairpin })),
        /isn't a map file name/
      )
    })))
})

describe("the projects folder", () => {
  it.effect("lists the projects in it by name, recent or not, and those can be opened as recent ones can", () =>
    runScoped(Effect.gen(function*() {
      const { at, dir, fs, open, path } = yield* machine(["Zebra"])
      const window = yield* open(1)
      assert.deepStrictEqual(yield* window.listFolder, [])
      for (const name of ["Zebra", "alpha"]) {
        yield* fs.makeDirectory(at(name))
        yield* fs.writeFileString(
          path.join(at(name), "ballest-project.json"),
          JSON.stringify({ formatVersion: 1, name: `${name} tracks`, exportTarget: "game" })
        )
      }
      // a folder that isn't a project, and a file, aren't listed
      yield* fs.makeDirectory(at("just a folder"))
      yield* fs.writeFileString(path.join(dir, "notes.txt"), "")

      const listed = yield* window.listFolder
      assert.deepStrictEqual(listed.map((p) => [p.path, p.name]), [
        [at("alpha"), "alpha tracks"],
        [at("Zebra"), "Zebra tracks"]
      ])
      assert.isNull(listed[0]?.lastOpened)
      assert.strictEqual((yield* window.switchTo(at("alpha"))).current?.path, at("alpha"))
      assert.match(yield* refusalOf(window.switchTo(at("just a folder"))), /picked/)
    })))
})
