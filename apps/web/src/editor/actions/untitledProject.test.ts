import { isMapFileName } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  makeTestDisk,
  projectFile,
  TEST_MAPS_FOLDER,
  TEST_PROJECTS_FOLDER,
  type TestDisk
} from "../../test/desktopBridge"
import {
  balledits,
  createNewMap,
  edit,
  fileNameOf,
  layerFor,
  noticesWhile,
  reset,
  s,
  submitSaveMap
} from "../../test/editorActions"
import { readSample } from "../../test/samples"
import {
  dirtyTabs,
  projectTitleOf,
  projectUnsavedOf,
  tabLabelOf,
  tabLabels,
  tabStateOf,
  tabsWithoutFile,
  windowTitleOf
} from "../store"
import { canMakeProject, newMapEffect } from "./maps"
import {
  chooseProjectEffect,
  createProjectEffect,
  importMapFile,
  newProjectEffect,
  openInThisWindowEffect,
  switchProjectEffect
} from "./project"
import { duplicateMapEffect, saveMapAsEffect, saveMapFile, saveMapInNewProjectEffect } from "./save"
import { closeTabEffect } from "./unsaved"

const fileName = (name: string) => `Map_LevelEditorMain&${name}_Isaac.balledit`
const project = `${TEST_PROJECTS_FOLDER}/My tracks`

/** A desktop on its first launch: no project in use. */
const untitledDisk = (files: Record<string, string> = {}) => {
  const disk = makeTestDisk(files)
  disk.project.current = null
  return disk
}

/** The names of the rows the Project panel gives the maps that have no file yet. */
const unsavedRows = () => {
  const state = s()
  return tabsWithoutFile(state).map((id) => tabLabelOf(tabStateOf(state, id)!))
}

/** The tab showing `name`, while it has no file yet. */
const tabNamed = (name: string) => {
  const state = s()
  return tabsWithoutFile(state).find((id) => tabLabelOf(tabStateOf(state, id)!) === name)!
}

const listed = () => s().projectMaps.map((m) => m.fileName).sort()

/** Every project folder with a map on `disk`. */
const foldersWithMaps = (disk: TestDisk) =>
  [...new Set([...disk.files.keys()].map((file) => file.split("/maps/")[0]!))].sort()

/** Big Loop and Hairpin are in the project, and no map is anywhere else. */
const assertBothInProject = (disk: TestDisk) => {
  assert.deepStrictEqual(foldersWithMaps(disk), [project])
  assert.deepStrictEqual(listed(), [fileName("Big Loop"), fileName("Hairpin")])
}

describe("New map", () => {
  it.effect("adds a tab each time, numbered past the open tabs, and writes nothing", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* newMapEffect
      yield* newMapEffect
      assert.deepStrictEqual(tabLabels(s()), ["Untitled", "Untitled 2", "Untitled 3"])
      assert.strictEqual(tabLabels(s()).length, s().tabIds.length)
      assert.strictEqual(tabLabelOf(s()), "Untitled 3")
      assert.isNull(s().dialog)
      assert.isNull(s().project?.current)
      assert.strictEqual(disk.files.size, 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("in a named project it adds a tab too, and the first Save names it", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* newMapEffect
      assert.deepStrictEqual(tabLabels(s()), ["Untitled", "Untitled 2"])
      assert.strictEqual(disk.files.size, 0)
      yield* saveMapFile
      assert.strictEqual(s().dialog?.id, "saveAs")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("takes the lowest free number, and counts a saved map's tab", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* newMapEffect
      yield* newMapEffect
      yield* closeTabEffect(tabNamed("Untitled 2"))
      yield* newMapEffect
      assert.deepStrictEqual(tabLabels(s()), ["Untitled", "Untitled 3", "Untitled 2"])

      s().renameLevel("Untitled 4", "Isaac")
      yield* saveMapAsEffect()
      yield* newMapEffect
      assert.include(tabLabels(s()), "Untitled 4")
      assert.strictEqual(tabLabelOf(s()), "Untitled 2")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("an untouched new tab closes without asking; one with edits asks", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* newMapEffect
      yield* closeTabEffect(tabNamed("Untitled 2"))
      assert.deepStrictEqual(disk.prompts, [])
      assert.deepStrictEqual(tabLabels(s()), ["Untitled"])

      yield* newMapEffect
      edit()
      disk.promptAnswers.push("cancel")
      yield* closeTabEffect(tabNamed("Untitled 2"))
      assert.lengthOf(disk.prompts, 1)
      assert.deepStrictEqual(tabLabels(s()), ["Untitled", "Untitled 2"])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("waits out a drag: the map under it stays the active tab", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      s().setPreview(new Map())
      yield* newMapEffect
      s().setPreview(null)
      assert.deepStrictEqual(tabLabels(s()), ["Untitled"])
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("the first Save in Untitled Project", () => {
  it.effect("asks in the Save map dialog, and its Cancel leaves nothing on disk and no project", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      yield* saveMapFile
      assert.strictEqual(s().dialog?.id, "saveAs")
      s().closeDialog()
      assert.strictEqual(disk.files.size, 0)
      assert.isNull(s().project?.current)
      assert.deepStrictEqual(disk.project.recent, [])
      assert.isTrue(s().dirty)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("the window's title has no dot until a tab has edits", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      assert.isFalse(projectUnsavedOf(s()))
      assert.strictEqual(windowTitleOf(s()), "Untitled Project – Ballest Editor")
      edit()
      assert.strictEqual(windowTitleOf(s()), "• Untitled Project – Ballest Editor")
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("makes the project, which this window then is, and the other tabs stay for their own first Save", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* newMapEffect
      edit()
      s().renameLevel("Big Loop", "Isaac")
      assert.strictEqual(projectTitleOf(s()), "Untitled Project")
      assert.isTrue(projectUnsavedOf(s()))
      assert.strictEqual(windowTitleOf(s()), "• Untitled Project – Ballest Editor")
      yield* saveMapInNewProjectEffect({ name: "My tracks" })
      assert.strictEqual(projectTitleOf(s()), "My tracks")
      assert.deepInclude(s().project?.current, { path: project })
      assert.deepStrictEqual(listed(), [fileName("Big Loop")])
      assert.deepStrictEqual(unsavedRows(), ["Untitled"])

      s().activateTab(tabNamed("Untitled"))
      yield* saveMapFile
      assert.strictEqual(s().dialog?.id, "saveAs")
      yield* submitSaveMap("Hairpin")
      assertBothInProject(disk)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("goes in the folder Choose… picked, under the name typed", () => {
    const folder = "/home/me/Tracks/Season 3"
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      s().renameLevel("Big Loop", "Isaac")
      yield* saveMapInNewProjectEffect({ name: "My tracks", folder })
      assert.deepInclude(s().project?.current, { path: folder })
      assert.isTrue(disk.files.has(projectFile(fileName("Big Loop"), folder)))
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a project that can't be made is refused before anything else happens", () => {
    const taken = projectFile(fileName("Old"), `${TEST_PROJECTS_FOLDER}/Taken`)
    const disk = untitledDisk({ [taken]: "{}" })
    return Effect.gen(function*() {
      yield* reset
      const notices = yield* noticesWhile((seen) =>
        Effect.promise(() => canMakeProject({ name: "Taken" })).pipe(
          Effect.map((made) => ({ made, seen }))
        )
      )
      assert.isUndefined(notices.made)
      assert.isNull(s().project?.current)
      assert.deepStrictEqual([...disk.files.keys()], [taken])
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("maps made in Untitled Project", () => {
  it.effect("each has a row in the Project panel, whichever tab is active", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      yield* createNewMap("Hairpin", "Isaac")
      yield* createNewMap("Shuttle", "Isaac")
      // the fresh map gave way to the first one
      assert.deepStrictEqual(unsavedRows(), ["Big Loop", "Hairpin", "Shuttle"])
      s().activateTab(tabNamed("Big Loop"))
      assert.deepStrictEqual(unsavedRows(), ["Big Loop", "Hairpin", "Shuttle"])
      assert.strictEqual(disk.files.size, 0)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("count as unsaved once touched, so closing asks, until the first Save", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      assert.deepStrictEqual(dirtyTabs(s()), [])
      yield* createNewMap("Big Loop", "Isaac")
      assert.deepStrictEqual(dirtyTabs(s()), [tabNamed("Big Loop")])
      yield* saveMapInNewProjectEffect({ name: "My tracks" })
      assert.deepStrictEqual(dirtyTabs(s()), [])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("all land in the project the first Save names, listed as each one is saved", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      yield* createNewMap("Hairpin", "Isaac")

      // the first Save names the project; the other tab's map keeps its row
      yield* saveMapInNewProjectEffect({ name: "My tracks" })
      assert.deepStrictEqual(listed(), [fileName("Hairpin")])
      assert.deepStrictEqual(unsavedRows(), ["Big Loop"])

      // the second goes in the same project: the project is known, so the dialog has no name to ask
      s().activateTab(tabNamed("Big Loop"))
      yield* saveMapFile
      assert.strictEqual(s().dialog?.id, "saveAs")
      assert.deepInclude(s().project?.current, { path: project })
      s().closeDialog()
      yield* saveMapAsEffect()
      assert.deepStrictEqual(listed(), [fileName("Big Loop"), fileName("Hairpin")])
      assert.deepStrictEqual(unsavedRows(), [])

      // New map, Duplicate and Import go there too
      yield* createNewMap("Shuttle", "Isaac")
      yield* duplicateMapEffect("Shuttle 2", "Isaac")
      const sample = balledits[0]!
      const inGame = `${TEST_MAPS_FOLDER}/${fileNameOf(sample)}`
      disk.files.set(inGame, readSample(sample))
      disk.answers.push(inGame)
      yield* importMapFile
      disk.files.delete(inGame)

      assert.deepStrictEqual(foldersWithMaps(disk), [project])
      const inMaps = [...disk.files.keys()].map((file) => file.split("/maps/")[1]!).filter(isMapFileName)
      assert.deepStrictEqual(listed(), inMaps.sort())
      assert.lengthOf(listed(), 5)
      assert.isTrue(disk.files.has(projectFile(fileName("Shuttle 2"), project)))
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("New project… takes them along without asking, so Save can't name a second project", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      edit()
      yield* createNewMap("Hairpin", "Isaac")
      edit()

      yield* createProjectEffect({ name: "My tracks" })
      assert.deepStrictEqual(disk.prompts, [])
      assert.isNull(s().dialog)
      assert.deepInclude(s().project?.current, { path: project })
      assert.deepStrictEqual(unsavedRows(), ["Big Loop", "Hairpin"])

      yield* saveMapAsEffect()
      s().activateTab(tabNamed("Big Loop"))
      yield* saveMapAsEffect()
      assertBothInProject(disk)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Open project… asks where it opens, and This window takes them along without asking about edits", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      edit()

      disk.answers.push(project)
      yield* chooseProjectEffect
      assert.strictEqual(s().dialog?.id, "whereToOpen")
      yield* openInThisWindowEffect
      assert.deepStrictEqual(disk.prompts, [])
      assert.deepInclude(s().project?.current, { path: project })
      assert.deepStrictEqual(unsavedRows(), ["Big Loop"])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a project name that is taken stops the Save with its own error, and the map stays open", () => {
    const taken = projectFile(fileName("Old"), `${TEST_PROJECTS_FOLDER}/Taken`)
    const disk = untitledDisk({ [taken]: "{}" })
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      let saved = false
      const error = yield* Effect.flip(
        saveMapInNewProjectEffect({ name: "Taken" }, Effect.sync(() => void (saved = true)))
      )
      assert.match(String(error), /already holds a project/)
      assert.isFalse(saved)
      assert.isNull(s().project?.current)
      assert.deepStrictEqual(unsavedRows(), ["Big Loop"])
      assert.deepStrictEqual([...disk.files.keys()], [taken])
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("This window, leaving Untitled Project", () => {
  /** Answers the whereToOpen dialog `open` left up: This window. */
  const here = <E, R>(open: Effect.Effect<void, E, R>) =>
    noticesWhile(() => open.pipe(Effect.andThen(openInThisWindowEffect)))

  it.effect("New project: no prompt, the maps carry over unsaved, and a blank tab is dropped", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* newMapEffect
      edit()
      yield* newMapEffect
      assert.deepStrictEqual(tabLabels(s()), ["Untitled", "Untitled 2", "Untitled 3"])

      yield* here(newProjectEffect("My tracks"))
      assert.deepStrictEqual(disk.prompts, [])
      assert.deepInclude(s().project?.current, { path: project })
      assert.deepStrictEqual(tabLabels(s()), ["Untitled 2"])
      assert.deepStrictEqual(dirtyTabs(s()), s().tabIds)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Open project: no prompt for maps with edits", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      edit()
      disk.answers.push(project)
      yield* here(chooseProjectEffect)
      assert.deepStrictEqual(disk.prompts, [])
      assert.deepInclude(s().project?.current, { path: project })
      assert.deepStrictEqual(tabLabels(s()), ["Untitled"])
      assert.isTrue(s().dirty)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a recent project, with only blank tabs: they give way to the map it opens on", () => {
    const sample = balledits[0]!
    const name = fileNameOf(sample)
    const disk = untitledDisk({ [projectFile(name, project)]: readSample(sample) })
    disk.project.recent = [project]
    return Effect.gen(function*() {
      yield* reset
      yield* newMapEffect
      yield* here(switchProjectEffect(project))
      assert.deepStrictEqual(disk.prompts, [])
      assert.lengthOf(s().tabIds, 1)
      assert.strictEqual(s().file?.name, name)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("an empty project, with only blank tabs: one blank Untitled is left, since there is always a map", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* newMapEffect
      yield* here(newProjectEffect("My tracks"))
      assert.deepStrictEqual(tabLabels(s()), ["Untitled"])
      assert.deepStrictEqual(dirtyTabs(s()), [])
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("This window, leaving a named project", () => {
  it.effect("asks about each map with unsaved edits, and the maps left open get rows", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      edit()
      yield* createNewMap("Hairpin", "Isaac")
      edit()
      disk.promptAnswers.push("discard", "discard")
      yield* noticesWhile(() => createProjectEffect({ name: "My tracks" }))
      assert.lengthOf(disk.prompts, 2)
      assert.deepInclude(s().project?.current, { path: project })
      assert.deepStrictEqual(unsavedRows(), ["Big Loop", "Hairpin"])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("a Cancel stops the switch", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      edit()
      disk.promptAnswers.push("cancel")
      yield* createProjectEffect({ name: "My tracks" })
      assert.lengthOf(disk.prompts, 1)
      assert.notDeepInclude(s().project?.current, { path: project })
      assert.isNotNull(s().file)
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("asks nothing with no unsaved edits, and a blank tab is dropped there too", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      yield* newMapEffect
      yield* noticesWhile(() => createProjectEffect({ name: "My tracks" }))
      assert.deepStrictEqual(disk.prompts, [])
      assert.deepInclude(s().project?.current, { path: project })
      assert.deepStrictEqual(tabLabels(s()), ["Big Loop"])
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
