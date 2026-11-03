import { InvokeChannels, ProjectState } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Option, Path } from "effect"
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
              projectsFolder: path.dirname(project)
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
              projectsFolder: path.dirname(project)
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

            dialogs.answers.push(other)
            const chosen = yield* fake.invoke(InvokeChannels.chooseProject)
            assert.deepStrictEqual(chosen, {
              current: { path: other, name: "Elsewhere", exists: false },
              recent: [{ path: project, name: "My maps", exists: true }],
              lastOpenMap: null,
              projectsFolder: path.dirname(project)
            })
            // Only a recent project can be switched to by path.
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
})
