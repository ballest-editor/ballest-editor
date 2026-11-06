import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  makeTestDisk,
  projectFile,
  TEST_MAPS_FOLDER,
  TEST_PROJECT,
  TEST_PROJECTS_FOLDER,
  type TestDisk
} from "../../test/desktopBridge"
import { balledits, edit, fileNameOf, layerFor, noticesWhile, reset, s } from "../../test/editorActions"
import { readSample } from "../../test/samples"
import { isChooserRequired, isModalOpen, windowTitleOf } from "../store"
import {
  chooseProjectEffect,
  forgetRecentProjectEffect,
  newProjectEffect,
  openInNewWindowEffect,
  openInThisWindowEffect,
  openRecentInNewWindowEffect,
  switchProjectEffect
} from "./project"

const SEASON = `${TEST_PROJECTS_FOLDER}/Season 3`
const OTHER = `${TEST_PROJECTS_FOLDER}/Other`

/** The project's maps folder on the test disk: what a project being on disk comes to there. */
const mapFile = (project: string) => projectFile("Map_LevelEditorMain&Track_Isaac.balledit", project)

/** The test bridge's project in use. */
const inUse = (disk: TestDisk) => disk.project.current

const asked = () => {
  const { dialog } = s()
  return dialog?.id === "whereToOpen" ? dialog : null
}

/** Untitled Project with its blank map. */
const untitledDisk = () => {
  const disk = makeTestDisk()
  disk.project.current = null
  return disk
}

/** A window that must choose: nothing in use, `OTHER` and `TEST_PROJECT` recent, `TEST_PROJECT` open elsewhere. */
const chooserDisk = (files: Record<string, string> = {}) => {
  const disk = makeTestDisk(files)
  disk.project = {
    ...disk.project,
    current: null,
    recent: [TEST_PROJECT, OTHER],
    chooserRequired: true,
    openElsewhere: [TEST_PROJECT]
  }
  return disk
}

describe("asking where a project opens", () => {
  it.effect("a window with nothing unsaved doesn't ask: the project opens here", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* noticesWhile(() => newProjectEffect("Season 3"))
      assert.isNull(s().dialog)
      assert.deepStrictEqual(disk.prompts, [])
      assert.strictEqual(inUse(disk), SEASON)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Untitled Project with only its untouched map doesn't ask either", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* noticesWhile(() => newProjectEffect("Season 3"))
      assert.isNull(s().dialog)
      assert.strictEqual(inUse(disk), SEASON)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Open project… and a recent project open here too", () => {
    const disk = makeTestDisk()
    disk.project.recent = [OTHER]
    return Effect.gen(function*() {
      yield* reset
      yield* noticesWhile(() => switchProjectEffect(OTHER))
      assert.isNull(s().dialog)
      assert.strictEqual(inUse(disk), OTHER)
      disk.answers.push(`${TEST_PROJECTS_FOLDER}/Picked`)
      yield* noticesWhile(() => chooseProjectEffect)
      assert.isNull(s().dialog)
      assert.strictEqual(inUse(disk), `${TEST_PROJECTS_FOLDER}/Picked`)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a new project goes in the folder picked for it", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* noticesWhile(() => newProjectEffect("Season 3", `${TEST_PROJECTS_FOLDER}/Elsewhere`))
      assert.strictEqual(inUse(disk), `${TEST_PROJECTS_FOLDER}/Elsewhere`)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  for (const [window, makeDisk] of [["A project window", makeTestDisk], ["Untitled Project", untitledDisk]] as const) {
    it.effect(`${window} with unsaved changes asks, and nothing changes until they are answered`, () => {
      const disk = makeDisk()
      const before = inUse(disk)
      return Effect.gen(function*() {
        yield* reset
        edit()
        yield* newProjectEffect("Season 3")
        assert.deepInclude(asked(), { name: "Season 3", target: { _tag: "New", name: "Season 3" } })
        assert.strictEqual(inUse(disk), before)
        assert.deepStrictEqual(disk.project.recent, [])
      }).pipe(Effect.provide(layerFor(disk)))
    })
  }

  it.effect("Untitled Project's New window leaves this window untitled, its map and all", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      const { tabId, tabIds } = s()
      yield* newProjectEffect("Season 3")
      yield* noticesWhile(() => openInNewWindowEffect)
      assert.deepStrictEqual(disk.project.windows, [SEASON])
      assert.isNull(inUse(disk))
      assert.isNull(s().project?.current)
      assert.strictEqual(s().tabId, tabId)
      assert.deepStrictEqual(s().tabIds, tabIds)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Open project… and a recent project ask, after the folder is known", () => {
    const disk = makeTestDisk()
    disk.project.recent = [OTHER]
    return Effect.gen(function*() {
      yield* reset
      edit()
      disk.answers.push(`${TEST_PROJECTS_FOLDER}/Picked`)
      yield* chooseProjectEffect
      assert.deepInclude(asked(), {
        name: "Picked",
        target: { _tag: "Existing", path: `${TEST_PROJECTS_FOLDER}/Picked` }
      })
      s().closeDialog()

      yield* switchProjectEffect(OTHER)
      assert.deepInclude(asked(), { name: "Other", target: { _tag: "Existing", path: OTHER } })
      assert.strictEqual(inUse(disk), TEST_PROJECT)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a cancelled folder dialog asks nothing, and the project in use is left alone", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      disk.answers.push(null)
      yield* chooseProjectEffect
      yield* switchProjectEffect(TEST_PROJECT)
      assert.isNull(s().dialog)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("a recent project's menu", () => {
  const other = { name: "Other", path: OTHER }

  it.effect("Open in new window asks nothing, unsaved changes or not, and this window stays as it was", () => {
    const disk = makeTestDisk()
    disk.project.recent = [OTHER]
    return Effect.gen(function*() {
      yield* reset
      edit()
      const notices = yield* noticesWhile((seen) => openRecentInNewWindowEffect(other).pipe(Effect.as(seen)))
      assert.deepStrictEqual(notices, ["Opening Other in a new window"])
      assert.isNull(s().dialog)
      assert.deepStrictEqual(disk.project.windows, [OTHER])
      assert.deepStrictEqual(disk.prompts, [])
      assert.strictEqual(inUse(disk), TEST_PROJECT)
      assert.isTrue(s().dirty)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Open in new window is refused for a project open elsewhere, and the list catches up", () => {
    const disk = makeTestDisk()
    disk.project.recent = [OTHER]
    return Effect.gen(function*() {
      yield* reset
      disk.project.openElsewhere = [OTHER]
      assert.match(String(yield* Effect.flip(openRecentInNewWindowEffect(other))), /is open in another window/)
      assert.deepStrictEqual(disk.project.windows, [])
      assert.deepStrictEqual(s().project?.openElsewhere, [OTHER])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("from the start screen, Open in new window leaves this window choosing", () => {
    const disk = chooserDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* noticesWhile(() => openRecentInNewWindowEffect(other))
      assert.deepStrictEqual(disk.project.windows, [OTHER])
      assert.isTrue(isChooserRequired(s()))
      assert.isNull(inUse(disk))
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Remove from recent takes it off the list, and only that", () => {
    const disk = makeTestDisk()
    disk.project.recent = [OTHER]
    return Effect.gen(function*() {
      yield* reset
      yield* forgetRecentProjectEffect(OTHER)
      assert.deepStrictEqual(disk.project.recent, [])
      assert.deepStrictEqual(s().project?.recent, [])
      assert.strictEqual(inUse(disk), TEST_PROJECT)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("the answer", () => {
  it.effect("Cancel leaves everything as it was: no folder, no project, no window", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      yield* newProjectEffect("Season 3")
      s().closeDialog()
      assert.strictEqual(inUse(disk), TEST_PROJECT)
      assert.deepStrictEqual(disk.project.recent, [])
      assert.deepStrictEqual(disk.project.windows, [])
      assert.deepStrictEqual(disk.prompts, [])
      assert.isTrue(s().dirty)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("This window asks about unsaved edits, and only then makes the project", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      yield* newProjectEffect("Season 3")
      disk.promptAnswers.push("cancel")
      yield* openInThisWindowEffect
      assert.lengthOf(disk.prompts, 1)
      assert.strictEqual(inUse(disk), TEST_PROJECT)
      assert.deepStrictEqual(disk.project.recent, [])

      yield* newProjectEffect("Season 3")
      disk.promptAnswers.push("discard")
      yield* noticesWhile(() => openInThisWindowEffect)
      assert.strictEqual(inUse(disk), SEASON)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("New window starts a copy on the project and leaves this window as it was", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      const { tabId, tabIds } = s()
      yield* newProjectEffect("Season 3")
      const notices = yield* noticesWhile((seen) => openInNewWindowEffect.pipe(Effect.as(seen)))
      assert.deepStrictEqual(disk.project.windows, [SEASON])
      assert.deepStrictEqual(notices, ["Opening Season 3 in a new window"])
      assert.isNull(s().dialog)
      assert.strictEqual(inUse(disk), TEST_PROJECT)
      assert.deepStrictEqual(disk.prompts, [])
      assert.strictEqual(s().tabId, tabId)
      assert.deepStrictEqual(s().tabIds, tabIds)
      assert.isTrue(s().dirty)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a window that can't be started fails with the reason, and this window stays", () => {
    const disk = makeTestDisk()
    disk.project.recent = [OTHER]
    disk.project.windowFailure = `Couldn't start a new window for ${OTHER}.`
    return Effect.gen(function*() {
      yield* reset
      edit()
      yield* switchProjectEffect(OTHER)
      const error = yield* Effect.flip(openInNewWindowEffect)
      assert.match(String(error), /Couldn't start a new window/)
      assert.strictEqual(inUse(disk), TEST_PROJECT)
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("Always do this", () => {
  const always = (projectOpensIn: "thisWindow" | "newWindow") => {
    const { settings, setSettings } = s()
    setSettings({ ...settings, general: { ...settings.general, projectOpensIn } })
  }
  const askAgain = Effect.sync(() => {
    const { settings, setSettings } = s()
    setSettings({ ...settings, general: { ...settings.general, projectOpensIn: "ask" } })
  })

  it.effect("This window: nothing asks where, and a named project's edits are still asked about", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      always("thisWindow")
      edit()
      disk.promptAnswers.push("discard")
      yield* noticesWhile(() => newProjectEffect("Season 3"))
      assert.isNull(s().dialog)
      assert.lengthOf(disk.prompts, 1)
      assert.strictEqual(inUse(disk), SEASON)
    }).pipe(Effect.ensuring(askAgain), Effect.provide(layerFor(disk)))
  })

  it.effect("New window: nothing asks where, and this window stays as it was", () => {
    const disk = makeTestDisk()
    disk.project.recent = [OTHER]
    return Effect.gen(function*() {
      yield* reset
      always("newWindow")
      yield* noticesWhile(() => switchProjectEffect(OTHER))
      assert.isNull(s().dialog)
      assert.deepStrictEqual(disk.project.windows, [OTHER])
      assert.strictEqual(inUse(disk), TEST_PROJECT)
    }).pipe(Effect.ensuring(askAgain), Effect.provide(layerFor(disk)))
  })

  it.effect("a refused project is still refused, and the required chooser's pick is still this window", () => {
    const disk = chooserDisk()
    return Effect.gen(function*() {
      yield* reset
      always("newWindow")
      assert.match(String(yield* Effect.flip(switchProjectEffect(TEST_PROJECT))), /is open in another window/)
      yield* noticesWhile(() => switchProjectEffect(OTHER))
      assert.deepStrictEqual(disk.project.windows, [])
      assert.strictEqual(inUse(disk), OTHER)
    }).pipe(Effect.ensuring(askAgain), Effect.provide(layerFor(disk)))
  })
})

describe("a project that can't be opened", () => {
  it.effect("open in another window: refused with the reason before anything is asked", () => {
    const disk = makeTestDisk()
    disk.project.recent = [OTHER]
    disk.project.openElsewhere = [OTHER]
    return Effect.gen(function*() {
      yield* reset
      edit()
      const recent = yield* Effect.flip(switchProjectEffect(OTHER))
      assert.match(String(recent), /is open in another window/)
      disk.answers.push(OTHER)
      const picked = yield* Effect.flip(chooseProjectEffect)
      assert.match(String(picked), /is open in another window/)
      assert.isNull(s().dialog)
      assert.deepStrictEqual(disk.prompts, [])
      assert.strictEqual(inUse(disk), TEST_PROJECT)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a refusal brings the list up to date, so a stale row shows what main knows", () => {
    const disk = makeTestDisk()
    disk.project.recent = [OTHER]
    return Effect.gen(function*() {
      yield* reset
      disk.project.openElsewhere = [OTHER]
      assert.deepStrictEqual(s().project?.openElsewhere, [])
      yield* Effect.flip(switchProjectEffect(OTHER))
      assert.deepStrictEqual(s().project?.openElsewhere, [OTHER])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("the game's maps folder is refused before anything is asked", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      disk.answers.push(`${TEST_MAPS_FOLDER}/sub`)
      assert.match(String(yield* Effect.flip(chooseProjectEffect)), /game's maps folder/)
      assert.isNull(s().dialog)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a new project's name that is taken stays on the name dialog", () => {
    const disk = makeTestDisk({ [mapFile(SEASON)]: "{}" })
    return Effect.gen(function*() {
      yield* reset
      s().openDialog({ id: "newProject" })
      assert.match(String(yield* Effect.flip(newProjectEffect("Season 3"))), /already holds a project/)
      assert.strictEqual(s().dialog?.id, "newProject")
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("the required chooser", () => {
  it.effect("is up from main's say, keeps the editor's keys off and lets no other dialog open", () => {
    const disk = chooserDisk()
    return Effect.gen(function*() {
      yield* reset
      assert.isTrue(isChooserRequired(s()))
      assert.isTrue(isModalOpen(s()))
      s().openDialog({ id: "gameLink" })
      assert.isNull(s().dialog)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a window without it works as before", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      assert.isFalse(isChooserRequired(s()))
      assert.isFalse(isModalOpen(s()))
      s().openDialog({ id: "gameLink" })
      assert.strictEqual(s().dialog?.id, "gameLink")
      assert.isTrue(isModalOpen(s()))
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("titles the window Ballest Editor: no project, and no dot even with edits behind it", () => {
    const disk = chooserDisk()
    return Effect.gen(function*() {
      yield* reset
      assert.strictEqual(windowTitleOf(s()), "Ballest Editor")
      edit()
      assert.strictEqual(windowTitleOf(s()), "Ballest Editor")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("has the blank map behind it, unsaved and in no project", () => {
    const disk = chooserDisk()
    return Effect.gen(function*() {
      yield* reset
      assert.isNull(s().project?.current)
      assert.isNull(s().file)
      assert.isFalse(s().dirty)
      assert.lengthOf(s().tabIds, 1)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a pick is always this window: nothing asked, the chooser ends, and the project's map opens", () => {
    const sample = balledits[0]!
    const name = fileNameOf(sample)
    const disk = chooserDisk({ [projectFile(name, OTHER)]: readSample(sample) })
    return Effect.gen(function*() {
      yield* reset
      yield* noticesWhile(() => switchProjectEffect(OTHER))
      assert.isNull(s().dialog)
      assert.deepStrictEqual(disk.project.windows, [])
      assert.strictEqual(inUse(disk), OTHER)
      assert.isFalse(isChooserRequired(s()))
      assert.strictEqual(s().file?.name, name)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("New project and Open project there go to this window too", () => {
    const disk = chooserDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      yield* noticesWhile(() => newProjectEffect("Season 3"))
      assert.isNull(s().dialog)
      assert.strictEqual(inUse(disk), SEASON)
      assert.isFalse(isChooserRequired(s()))
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a project open in another window can't be picked: the chooser stays", () => {
    const disk = chooserDisk()
    return Effect.gen(function*() {
      yield* reset
      assert.match(String(yield* Effect.flip(switchProjectEffect(TEST_PROJECT))), /is open in another window/)
      assert.isTrue(isChooserRequired(s()))
      assert.isNull(inUse(disk))
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("the web review build", () => {
  it("has no project, so there is no chooser and nothing to ask", () => {
    assert.isFalse(isChooserRequired({ project: null }))
    assert.isFalse(isModalOpen({ dialog: null, project: null }))
  })
})
