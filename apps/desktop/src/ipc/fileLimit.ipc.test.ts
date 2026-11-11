import { CHARACTERS_PER_FILE, InvokeChannels, ProjectMapFile } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { vi } from "vitest"
import { withHandlers } from "./handlersHarness"

// The services' layers call Electron; these tests replace them, so only the module import needs a stand-in.
vi.mock("electron", () => ({}))

// The one test at the game's own limit: the others provide a small `FileLimit`, since reading this many characters
// is slow. `truncate` grows a file with holes, NULs on read, so it costs no disk.
describe("the game's character limit", () => {
  it.effect("opens a file of 67108864 characters that is past it in bytes, and refuses one character more", () =>
    withHandlers(({ fake, project }) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const name = "Map_LevelEditorMain&Wide_me.balledit"
        const file = path.join(project, "maps", name)
        // `é` is two bytes and one character.
        yield* fake.invoke(InvokeChannels.createMap, { fileName: name, text: "é" })
        yield* fs.truncate(file, CHARACTERS_PER_FILE + 1)
        const opened = yield* fake.invokeAs(ProjectMapFile, InvokeChannels.readMap, { fileName: name })
        assert.strictEqual(opened.text.length, 67_108_864)

        yield* fs.truncate(file, CHARACTERS_PER_FILE + 2)
        const refused = yield* Effect.flip(fake.invoke(InvokeChannels.readMap, { fileName: name }))
        assert.match(String(refused.cause), /more characters than the game loads \(67108864\)/)
      })
    ))
})
