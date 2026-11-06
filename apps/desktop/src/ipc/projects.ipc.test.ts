import { InvokeChannels, ProjectState } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, FileSystem, Option, Path } from "effect"
import { vi } from "vitest"
import { readSettings, withHandlers } from "./handlersHarness"

// The services' layers call Electron; these tests replace them, so only the module import needs a stand-in
// (requiring the real package from Node would download the binary).
vi.mock("electron", () => ({}))

describe("Projects over IPC", () => {
  it.effect(
    "Untitled Project until the first Save names it; the open map is kept per project",
    () =>
      withHandlers(
        ({ dir, fake, project }) =>
          Effect.gen(function*() {
            const fs = yield* FileSystem.FileSystem
            const path = yield* Path.Path
            const name = "Map_LevelEditorMain&Track_me.balledit"
            const text = "{\r\n\t\"items\": [ \"é\" ]\r\n}"

            // No project yet: Untitled Project. Nothing is listed or revealed, remembering an open map is a no-op, and
            // writing a map is refused until a project is named.
            assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.projectState), {
              current: null,
              recent: [],
              lastOpenMap: null,
              projectsFolder: path.dirname(project),
              chooserRequired: false,
              openElsewhere: [],
              startRefused: null
            })
            assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.listMaps), [])
            assert.isFalse(yield* fake.invoke(InvokeChannels.revealProject, { which: "maps" }))
            yield* fake.invoke(InvokeChannels.rememberOpenMap, { fileName: name })
            assert.isNull((yield* fake.invokeAs(ProjectState, InvokeChannels.projectState)).lastOpenMap)
            const unnamed = yield* Effect.flip(fake.invoke(InvokeChannels.createMap, { fileName: name, text }))
            assert.match(String(unnamed.cause), /no project yet/)

            // The first Save names the project; it is on disk from then on.
            const named = yield* fake.invokeAs(ProjectState, InvokeChannels.createProject, { name: "My maps" })
            assert.deepStrictEqual(named, {
              current: { path: project, name: "My maps", exists: true },
              recent: [],
              lastOpenMap: null,
              projectsFolder: path.dirname(project),
              chooserRequired: false,
              openElsewhere: [],
              startRefused: null
            })
            assert.isTrue(yield* fake.invoke(InvokeChannels.revealProject, { which: "maps" }))
            assert.isTrue(yield* fake.invoke(InvokeChannels.revealProject, { which: "project" }))
            // the backups folder is made by the first backup
            assert.isFalse(yield* fake.invoke(InvokeChannels.revealProject, { which: "backups" }))
            assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.listMaps), [])

            // Project settings › General renames the project in its file; the folder keeps its name
            const renamedProject = yield* fake.invokeAs(ProjectState, InvokeChannels.renameProject, {
              name: " Season 3 "
            })
            assert.deepInclude(renamedProject.current, { path: project, name: "Season 3" })
            assert.deepInclude(JSON.parse(yield* fs.readFileString(path.join(project, "ballest-project.json"))), {
              name: "Season 3"
            })
            const blank = yield* Effect.flip(fake.invoke(InvokeChannels.renameProject, { name: "  " }))
            assert.match(String(blank.cause), /can't name a folder/)

            // the open map is kept per project for the next launch; a name that isn't a map file's is refused
            yield* fake.invoke(InvokeChannels.rememberOpenMap, { fileName: name })
            assert.strictEqual((yield* fake.invokeAs(ProjectState, InvokeChannels.projectState)).lastOpenMap, name)
            assert.deepInclude((yield* readSettings(fs, dir)).project?.lastOpenMap, { [project]: name })
            assert.match(
              String((yield* Effect.flip(fake.invoke(InvokeChannels.rememberOpenMap, { fileName: "../x" }))).cause),
              /isn't a map file name/
            )
            yield* fake.invoke(InvokeChannels.rememberOpenMap, { fileName: null })
            assert.isNull((yield* fake.invokeAs(ProjectState, InvokeChannels.projectState)).lastOpenMap)
          }),
        undefined,
        "none"
      )
  )

  it.effect("refuses a project open in another window, by every way in, with the reason", () =>
    withHandlers(({ dialogs, dir, fake, launcher, otherWindow, project }) =>
      Effect.gen(function*() {
        const path = yield* Path.Path
        const other = path.join(dir, "Elsewhere")
        dialogs.answers.push(other)
        yield* fake.invoke(InvokeChannels.chooseProject)
        yield* fake.invoke(InvokeChannels.switchProject, { path: other })
        yield* fake.invoke(InvokeChannels.switchProject, { path: project })
        yield* otherWindow(other)

        const reason = /is open in another window/
        const refused = (channel: string, payload?: unknown) =>
          Effect.flip(fake.invoke(channel, payload)).pipe(Effect.map((error) => String(error.cause)))
        const target = { _tag: "Existing", path: other }
        assert.match(yield* refused(InvokeChannels.switchProject, { path: other }), reason)
        assert.match(yield* refused(InvokeChannels.checkProject, target), reason)
        assert.match(yield* refused(InvokeChannels.openProjectWindow, target), reason)
        dialogs.answers.push(other)
        assert.match(yield* refused(InvokeChannels.chooseProject), reason)

        const state = yield* fake.invokeAs(ProjectState, InvokeChannels.projectState)
        assert.strictEqual(state.current?.path, project)
        assert.deepStrictEqual(state.openElsewhere, [other])
        assert.deepStrictEqual(launcher.started, [])
      })
    ))

  it.effect("New window starts a copy on the project, makes a new one first, and changes nothing here", () =>
    withHandlers(({ fake, launcher, project }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const season = path.join(path.dirname(project), "Season 3")

        yield* fake.invoke(InvokeChannels.checkProject, { _tag: "New", name: "Season 3" })
        assert.isFalse(yield* fs.exists(season))

        yield* fake.invoke(InvokeChannels.openProjectWindow, { _tag: "New", name: "Season 3" })
        assert.deepStrictEqual(launcher.started, [season])
        assert.isTrue(yield* fs.exists(path.join(season, "ballest-project.json")))
        assert.strictEqual((yield* fake.invokeAs(ProjectState, InvokeChannels.projectState)).current?.path, project)
      })
    ))

  it.effect("a window that can't be started is an error the page can show", () =>
    withHandlers(({ dialogs, dir, fake, launcher }) =>
      Effect.gen(function*() {
        const other = (yield* Path.Path).join(dir, "Elsewhere")
        dialogs.answers.push(other)
        yield* fake.invoke(InvokeChannels.chooseProject)
        launcher.failing.now = true
        const error = yield* Effect.flip(
          fake.invoke(InvokeChannels.openProjectWindow, { _tag: "Existing", path: other })
        )
        assert.match(String(error.cause), /Couldn't start a new window for .*Elsewhere/)
      })
    ))

  it.effect("the payload of a project target is decoded before a handler runs", () =>
    withHandlers(({ fake, launcher }) =>
      Effect.gen(function*() {
        const error = yield* Effect.flip(fake.invoke(InvokeChannels.openProjectWindow, { _tag: "Existing", path: 3 }))
        assert.isDefined(error)
        assert.deepStrictEqual(launcher.started, [])
      })
    ))

  it.effect(
    "chooses another project folder, refuses the game's maps folder and switches back",
    () =>
      withHandlers(
        ({ fake, dialogs, dir, project, steam }) =>
          Effect.gen(function*() {
            const fs = yield* FileSystem.FileSystem
            const path = yield* Path.Path
            const other = path.join(dir, "Elsewhere")

            dialogs.answers.push(null)
            assert.isNull(yield* fake.invoke(InvokeChannels.chooseProject))
            // No project yet, so the dialog starts where projects are made.
            assert.strictEqual(Option.getOrNull(dialogs.asked[0]!.defaultPath), path.dirname(project))
            yield* fake.invoke(InvokeChannels.createProject, { name: "My maps" })

            for (const refused of [steam.maps, path.join(steam.maps, "sub")]) {
              dialogs.answers.push(refused)
              const error = yield* Effect.flip(fake.invoke(InvokeChannels.chooseProject))
              assert.match(String(error.cause), /game's maps folder or inside it/)
            }

            // The dialog only picks: the page then says where the folder opens.
            dialogs.answers.push(other)
            const chosen = yield* fake.invoke(InvokeChannels.chooseProject)
            assert.deepStrictEqual(chosen, { path: other, name: "Elsewhere", exists: false })
            assert.strictEqual((yield* fake.invokeAs(ProjectState, InvokeChannels.projectState)).current?.path, project)
            const used = yield* fake.invokeAs(ProjectState, InvokeChannels.switchProject, { path: other })
            assert.deepInclude(used, {
              current: { path: other, name: "Elsewhere", exists: false },
              recent: [{ path: project, name: "My maps", exists: true, lastOpened: "1970-01-01T00:00:00.000Z" }]
            })
            // Only a recent project or a picked folder can be switched to by path.
            const error = yield* Effect.flip(
              fake.invoke(InvokeChannels.switchProject, { path: path.join(dir, "Random") })
            )
            assert.match(String(error.cause), /picked/)
            const back = yield* fake.invokeAs(ProjectState, InvokeChannels.switchProject, { path: project })
            assert.strictEqual(back.current?.path, project)
            assert.deepStrictEqual(back.recent.map((p) => p.path), [other])

            // New project makes `<projectsFolder>/<name>` on disk and uses it; a second one of that name is refused.
            const made = yield* fake.invokeAs(ProjectState, InvokeChannels.createProject, { name: " Season 3 " })
            const season = path.join(path.dirname(project), "Season 3")
            assert.deepInclude(made.current, { path: season, name: "Season 3", exists: true })
            assert.deepStrictEqual(made.recent.map((p) => p.path), [project, other])
            assert.isTrue(yield* fs.exists(path.join(season, "maps")))
            assert.strictEqual(yield* fs.readFileString(path.join(season, ".gitignore")), ".ballest/\n")
            const again = yield* Effect.flip(fake.invoke(InvokeChannels.createProject, { name: "Season 3" }))
            assert.match(String(again.cause), /already holds a project/)
            for (const bad of ["", ".hidden", "a/b", "x".repeat(65)]) {
              const refused = yield* Effect.flip(fake.invoke(InvokeChannels.createProject, { name: bad }))
              assert.match(String(refused.cause), /can't name a folder/)
            }
          }),
        undefined,
        "none"
      )
  )

  it.effect("a recovery snapshot goes through main under a UUID, and no other name is taken", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        const key = "00000000-0000-4000-8000-00000000000a"
        yield* fake.invoke(InvokeChannels.writeRecovery, { key, text: "{}" })
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.listRecovery), [{ key, text: "{}" }])
        yield* fake.invoke(InvokeChannels.removeRecovery, { key })
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.listRecovery), [])

        const refused = yield* Effect.exit(
          fake.invoke(InvokeChannels.writeRecovery, { key: "../../escape", text: "{}" })
        )
        assert.isTrue(Exit.isFailure(refused))
      })
    ))
})
