import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  makeTestDisk,
  projectFile,
  TEST_MAPS_FOLDER,
  TEST_PROJECTS_FOLDER,
  type TestDisk
} from "../../test/desktopBridge"
import { balledits, edit, fileNameOf, layerFor, noticesWhile, reset, s } from "../../test/editorActions"
import { readSample } from "../../test/samples"
import { dirtyTabs, tabLabelOf, tabStateOf, tabsWithoutFile } from "../store"
import { createNewMap } from "./maps"
import { chooseProjectEffect, createProjectEffect, importMapFile } from "./project"
import { duplicateMapEffect, saveMapAsEffect, saveMapFile, saveMapInNewProjectEffect } from "./save"

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

  it.effect("count as unsaved from the start, so closing asks, until the first Save", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      assert.deepStrictEqual(dirtyTabs(s()), [])
      yield* createNewMap("Big Loop", "Isaac")
      assert.deepStrictEqual(dirtyTabs(s()), [tabNamed("Big Loop")])
      yield* saveMapInNewProjectEffect("My tracks")
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
      yield* saveMapInNewProjectEffect("My tracks")
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
      assert.deepStrictEqual(listed(), [...disk.files.keys()].map((file) => file.split("/maps/")[1]!).sort())
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

      yield* createProjectEffect("My tracks")
      assert.deepStrictEqual(disk.prompts, [])
      assert.isNull(s().dialog)
      assert.deepInclude(s().project?.current, { path: project })
      assert.deepStrictEqual(unsavedRows(), ["Big Loop", "Hairpin"])

      yield* saveMapAsEffect()
      s().activateTab(tabNamed("Big Loop"))
      yield* saveMapAsEffect()
      assert.deepStrictEqual(foldersWithMaps(disk), [project])
      assert.deepStrictEqual(listed(), [fileName("Big Loop"), fileName("Hairpin")])
    }).pipe(Effect.provide(layerFor(disk)))
  })

  it.effect("Open project… takes them along without asking too", () => {
    const disk = untitledDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      edit()

      disk.answers.push(project)
      yield* chooseProjectEffect
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
      const error = yield* Effect.flip(saveMapInNewProjectEffect("Taken", Effect.sync(() => void (saved = true))))
      assert.match(String(error), /already holds a project/)
      assert.isFalse(saved)
      assert.isNull(s().project?.current)
      assert.deepStrictEqual(unsavedRows(), ["Big Loop"])
      assert.deepStrictEqual([...disk.files.keys()], [taken])
    }).pipe(Effect.provide(layerFor(disk)))
  })
})

describe("leaving a named project", () => {
  it.effect("still asks about each map's unsaved edits, and the maps left open get rows", () => {
    const disk = makeTestDisk()
    return Effect.gen(function*() {
      yield* reset
      yield* createNewMap("Big Loop", "Isaac")
      edit()
      disk.promptAnswers.push("discard")
      yield* noticesWhile(() => createProjectEffect("My tracks"))
      assert.lengthOf(disk.prompts, 1)
      assert.deepInclude(s().project?.current, { path: project })
      assert.deepStrictEqual(unsavedRows(), ["Big Loop"])
    }).pipe(Effect.provide(layerFor(disk)))
  })
})
