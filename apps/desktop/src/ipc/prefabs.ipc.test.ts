import { InvokeChannels, PrefabBackups, PrefabInfo, PrefabInfos, PrefabRead, PrefabSummary } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { vi } from "vitest"
import { sha256 } from "../project/files"
import { opened, withHandlers } from "./handlersHarness"

// The services' layers call Electron; these tests replace them, so only the module import needs a stand-in
// (requiring the real package from Node would download the binary).
vi.mock("electron", () => ({}))

const prefabText = (n: number) =>
  `{"format":"BallestPrefab","items":[${"{\"class\":\"/Game/A.A_C\"},".repeat(n)}{"class":"/Game/B.B_C"}]}`
const bytes = (text: string) => new TextEncoder().encode(text)

/** The fake game's prefabs folder, beside its maps folder under `Saved`. */
const userFolder = (maps: string) =>
  Path.Path.pipe(Effect.map((path) => path.join(path.dirname(maps), "SaveGames", "Prefabs")))

describe("prefabs over IPC", () => {
  it.effect("lists each tier by name with what the panel shows, and keeps the two apart", () =>
    withHandlers(({ fake, project, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const user = yield* userFolder(steam.maps)
        assert.deepStrictEqual(yield* fake.invokeAs(PrefabInfos, InvokeChannels.listPrefabs, { tier: "user" }), [])
        yield* fake.invoke(InvokeChannels.writePrefab, { tier: "user", name: "b", text: prefabText(2), replace: false })
        yield* fake.invoke(InvokeChannels.writePrefab, { tier: "user", name: "a", text: "not json", replace: false })
        yield* fake.invoke(InvokeChannels.writePrefab, {
          tier: "project",
          name: "c",
          text: prefabText(1),
          replace: false
        })
        yield* fs.writeFileString(path.join(user, "two words.json"), "{}")
        yield* fs.writeFileString(path.join(user, "note.txt"), "{}")

        const inUser = yield* fake.invokeAs(PrefabInfos, InvokeChannels.listPrefabs, { tier: "user" })
        assert.deepStrictEqual(inUser.map((p) => p.name), ["a", "b"])
        assert.deepInclude(inUser[1], {
          tier: "user",
          path: path.join(user, "b.json"),
          hash: sha256(bytes(prefabText(2))),
          itemCount: 3
        })
        assert.deepInclude(inUser[0], { itemCount: null })
        const inProject = yield* fake.invokeAs(PrefabInfos, InvokeChannels.listPrefabs, { tier: "project" })
        assert.deepStrictEqual(inProject.map((p) => p.path), [path.join(project, "prefabs", "c.json")])
      })
    ))

  it.effect("reads what the game wrote, and sees the file change", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const user = yield* userFolder(steam.maps)
        yield* fs.makeDirectory(user, { recursive: true })
        yield* fs.writeFileString(path.join(user, "qa.json"), prefabText(1))
        const read = yield* fake.invokeAs(PrefabRead, InvokeChannels.readPrefab, { tier: "user", name: "qa" })
        assert.strictEqual(read.text, prefabText(1))
        yield* fs.writeFileString(path.join(user, "qa.json"), prefabText(3))
        const [after] = yield* fake.invokeAs(PrefabInfos, InvokeChannels.listPrefabs, { tier: "user" })
        assert.strictEqual(after?.hash, sha256(bytes(prefabText(3))))
        assert.strictEqual(after?.itemCount, 4)
      })
    ))

  it.effect("keeps what a write, a rename and a delete replace, and refuses a taken name", () =>
    withHandlers(({ dir, fake, project, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const user = yield* userFolder(steam.maps)
        const write = (tier: string, name: string, text: string, replace: boolean) =>
          fake.invokeAs(PrefabInfo, InvokeChannels.writePrefab, { tier, name, text, replace })
        yield* write("project", "p", prefabText(1), false)
        const taken = yield* Effect.flip(write("project", "p", prefabText(2), false))
        assert.match(String(taken.cause), /already a prefab called p/)
        yield* write("project", "p", prefabText(2), true)
        const kept = path.join(project, ".ballest", "backups")
        assert.isTrue((yield* fs.readDirectory(kept)).some((name) => name.endsWith(" p.json")))

        yield* write("project", "other", prefabText(1), false)
        const clash = yield* Effect.flip(
          fake.invoke(InvokeChannels.renamePrefab, { tier: "project", from: "p", to: "other" })
        )
        assert.match(String(clash.cause), /already a prefab called other/)
        const renamed = yield* fake.invokeAs(PrefabInfo, InvokeChannels.renamePrefab, {
          tier: "project",
          from: "p",
          to: "q"
        })
        assert.strictEqual(renamed.name, "q")
        assert.isFalse(yield* fs.exists(path.join(project, "prefabs", "p.json")))
        assert.strictEqual(yield* fs.readFileString(path.join(project, "prefabs", "q.json")), prefabText(2))

        yield* write("user", "u", prefabText(1), false)
        yield* write("user", "u", prefabText(2), true)
        yield* fake.invoke(InvokeChannels.deletePrefab, { tier: "user", name: "u" })
        assert.isFalse(yield* fs.exists(path.join(user, "u.json")))
        const userKept = yield* fs.readDirectory(path.join(dir, "userData", "backups"))
        assert.lengthOf(userKept.filter((name) => name.endsWith(" u.json")), 2)
      })
    ))

  it.effect("keeps prefab backups out of the maps' list, and lists them by tier", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        yield* fake.invoke(InvokeChannels.writePrefab, { tier: "user", name: "u", text: prefabText(1), replace: false })
        yield* fake.invoke(InvokeChannels.deletePrefab, { tier: "user", name: "u" })
        yield* fake.invoke(InvokeChannels.writePrefab, {
          tier: "project",
          name: "p",
          text: prefabText(2),
          replace: false
        })
        yield* fake.invoke(InvokeChannels.writePrefab, {
          tier: "project",
          name: "p",
          text: prefabText(3),
          replace: true
        })
        assert.deepStrictEqual(yield* fake.invoke(InvokeChannels.listBackups), [])
        const kept = yield* fake.invokeAs(PrefabBackups, InvokeChannels.listPrefabBackups)
        assert.sameDeepMembers(kept.map(({ name, tier }) => ({ name, tier })), [
          { name: "u", tier: "user" },
          { name: "p", tier: "project" }
        ])
        const ref = { id: kept.find((backup) => backup.name === "p")?.id, tier: "project" }
        assert.deepStrictEqual(yield* fake.invokeAs(PrefabSummary, InvokeChannels.describePrefabBackup, ref), {
          itemCount: 3
        })
      })
    ))

  it.effect("restores a project prefab, keeping the file it replaces", () =>
    withHandlers(({ fake, project }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const file = path.join(project, "prefabs", "p.json")
        const write = (text: string, replace: boolean) =>
          fake.invoke(InvokeChannels.writePrefab, { tier: "project", name: "p", text, replace })
        yield* write(prefabText(1), false)
        yield* write(prefabText(2), true)
        const [first] = yield* fake.invokeAs(PrefabBackups, InvokeChannels.listPrefabBackups)

        const restored = yield* fake.invokeAs(PrefabInfo, InvokeChannels.restorePrefabBackup, {
          tier: "project",
          id: first!.id
        })
        assert.deepInclude(restored, { name: "p", tier: "project", path: file, itemCount: 2 })
        assert.strictEqual(yield* fs.readFileString(file), prefabText(1))

        const after = yield* fake.invokeAs(PrefabBackups, InvokeChannels.listPrefabBackups)
        assert.lengthOf(after, 2)
        const kept = yield* fs.readFileString(path.join(project, ".ballest", "backups", after[0]!.id))
        assert.strictEqual(kept, prefabText(2))
      })
    ))

  it.effect("brings back a deleted prefab in the game's folder, byte for byte", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const file = path.join(yield* userFolder(steam.maps), "u.json")
        const text = `\uFEFF${prefabText(1)}\r\n`
        yield* fake.invoke(InvokeChannels.writePrefab, { tier: "user", name: "u", text, replace: false })
        yield* fake.invoke(InvokeChannels.deletePrefab, { tier: "user", name: "u" })
        assert.isFalse(yield* fs.exists(file))

        const [kept] = yield* fake.invokeAs(PrefabBackups, InvokeChannels.listPrefabBackups)
        yield* fake.invoke(InvokeChannels.restorePrefabBackup, { tier: "user", id: kept!.id })
        assert.deepStrictEqual(yield* fs.readFile(file), bytes(text))
        assert.deepStrictEqual(
          (yield* fake.invokeAs(PrefabInfos, InvokeChannels.listPrefabs, { tier: "user" })).map((p) => p.name),
          ["u"]
        )
      })
    ))

  it.effect("writes nothing when the prefab already holds the backup's bytes", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        const write = (text: string) =>
          fake.invoke(InvokeChannels.writePrefab, { tier: "project", name: "p", text, replace: true })
        yield* write(prefabText(1))
        yield* write(prefabText(2))
        yield* write(prefabText(1))
        const before = yield* fake.invokeAs(PrefabBackups, InvokeChannels.listPrefabBackups)
        yield* fake.invoke(InvokeChannels.restorePrefabBackup, { tier: "project", id: before.at(-1)?.id })
        assert.lengthOf(yield* fake.invokeAs(PrefabBackups, InvokeChannels.listPrefabBackups), before.length)
      })
    ))

  it.effect("refuses a name it didn't write, a map's backup and a name that would leave the folder", () =>
    withHandlers(({ fake }) =>
      Effect.gen(function*() {
        const ids = [
          "notes.json",
          "2026-10-31T12-00-00-000Z ../../up.json",
          "2026-10-31T12-00-00-000Z Map_LevelEditorMain&Big Loop_Isaac.balledit"
        ]
        for (const id of ids) {
          for (const channel of [InvokeChannels.describePrefabBackup, InvokeChannels.restorePrefabBackup]) {
            const refused = yield* Effect.flip(fake.invoke(channel, { tier: "user", id }))
            assert.match(String(refused.cause), /doesn't exist any more/)
          }
        }
      })
    ))

  it.effect("writes nothing in the game beyond its prefabs folder, and refuses a name that would leave it", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const refused = yield* Effect.flip(
          fake.invoke(InvokeChannels.writePrefab, { tier: "user", name: "../up", text: "{}", replace: true })
        )
        assert.match(String(refused.cause), /prefab name/)
        yield* fake.invoke(InvokeChannels.writePrefab, { tier: "user", name: "a", text: "{}", replace: false })
        const saved = path.dirname(steam.maps)
        assert.deepStrictEqual(yield* fs.readDirectory(path.join(saved, "SaveGames")), ["Prefabs"])
        assert.deepStrictEqual(yield* fs.readDirectory(yield* userFolder(steam.maps)), ["a.json"])
      })
    ))

  it.effect("shows a tier's folder once it has one", () =>
    withHandlers(({ fake, steam }) =>
      Effect.gen(function*() {
        const user = yield* userFolder(steam.maps)
        assert.isFalse(yield* fake.invoke(InvokeChannels.revealPrefabs, { tier: "project" }))
        yield* fake.invoke(InvokeChannels.writePrefab, { tier: "user", name: "a", text: "{}", replace: false })
        assert.isTrue(yield* fake.invoke(InvokeChannels.revealPrefabs, { tier: "user" }))
        assert.include(opened, user)
      })
    ))
})
