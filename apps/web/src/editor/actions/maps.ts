/**
 * The project's maps in the editor (docs/PROJECTS.md): New map, reading and showing a map, the map the app starts on,
 * what Project settings reads and writes of a map, and the project's own name and folders. Opening, Import and switching
 * projects are in `project`.
 */
import type { CreateProjectPayload, ProjectFolder } from "@ballest/contracts"
import { Effect, Option } from "effect"
import { creatorOf, usableCreatorName } from "../../domain/creator"
import { currentCreatedAt, newMapFile, untitledNameOf } from "../../domain/factory"
import { type MapFile, PLAYER_START_CLASS } from "../../domain/MapFile"
import type { MapPrefs } from "../../domain/MapPrefs"
import { MapCodec } from "../../services/MapCodec"
import { MapExporter } from "../../services/MapExporter"
import { Platform, PlatformError } from "../../services/Platform"
import { tabLabels, type TabTarget, tabWithFile, useEditor } from "../store"
import { notifyFailure, run } from "./run"
import { fileOf, loadProjectMapFile, prefsOf, refreshProject, saveTabPrefs, showMap, writeProjectMap } from "./shared"

/** Reads one of the project's maps into the editor, in the tab `into` says. */
export const readProjectMapIntoEditor = Effect.fn("readProjectMapIntoEditor")(
  function*(fileName: string, into: TabTarget) {
    const file = yield* (yield* Platform).readMap(fileName)
    const { loaded, map } = yield* loadProjectMapFile(file)
    yield* showMap(map, fileOf(file), { into, loaded })
  }
)

/**
 * Opens one of the project's maps: the tab that has it open becomes the active one, else it opens in a new tab (in
 * place of the fresh map the app starts on, while that is untouched). Nothing is asked: no map is replaced.
 */
export const openProjectMapFile = Effect.fn("openProjectMapFile")(function*(fileName: string) {
  const open = tabWithFile(useEditor.getState(), fileName)
  if (open === undefined) yield* readProjectMapIntoEditor(fileName, "newTab")
  else useEditor.getState().activateTab(open)
})

/** Opens one of the project's maps in a new tab behind the active one, which stays active. An open map stays as it is. */
export const openProjectMapBehind = Effect.fn("openProjectMapBehind")(function*(fileName: string) {
  if (tabWithFile(useEditor.getState(), fileName) === undefined) {
    yield* readProjectMapIntoEditor(fileName, "backgroundTab")
  }
})

/**
 * Opens one of the project's maps with its tab in the gap `at` of the strip as it stands now: a map dropped on it. An
 * open map's tab moves there, and it becomes the active one either way.
 */
export const openProjectMapAtGap = Effect.fn("openProjectMapAtGap")(function*(fileName: string, at: number) {
  const tabsBefore = useEditor.getState().tabIds
  yield* openProjectMapFile(fileName)
  const { moveTab, tabId } = useEditor.getState()
  const from = tabsBefore.indexOf(tabId)
  // `moveTab` counts without the tab it moves
  moveTab(tabId, from >= 0 && at > from ? at - 1 : at)
})

/**
 * A new map the way the in-game editor starts one: the player start and the goal ring where the game puts them, and the
 * creator in use (none yet: the first Save asks). Nothing is written.
 */
const untitledMap = Effect.fnUntraced(function*(displayName: string) {
  const { catalog, settings, foundCreator } = useEditor.getState()
  const playerStartPiece = catalog?.catalog.pieces.find((p) => p.classPath === PLAYER_START_CLASS)
  const creatorName = usableCreatorName(creatorOf(settings.general.creatorName, foundCreator))
  const createdAt = yield* currentCreatedAt
  return newMapFile({ displayName, creatorName, createdAt, playerStartPiece })
})

/** A fresh map in the active tab, for when there is no map to open: the first Save names it. */
export const freshMapEffect = Effect.gen(function*() {
  useEditor.getState().loadMap(yield* untitledMap("Untitled"), null, undefined, { fresh: true })
})

/**
 * New map: a tab of its own, whatever is open, in any window. It asks nothing and writes nothing: it goes by the next
 * free Untitled name until its first Save names it.
 */
export const newMapEffect = Effect.gen(function*() {
  const map = yield* untitledMap(untitledNameOf(new Set(tabLabels(useEditor.getState()))))
  useEditor.getState().loadMap(map, null, undefined, { fresh: true, into: "addedTab" })
})

export const startNewMap = () => run(newMapEffect)

/**
 * The map the desktop app starts on (docs/DESKTOP.md § Document tabs): the one open when it last ran, else the project's
 * most recently edited one, else a fresh unsaved map. One that can't be read any more is reported, and the next
 * choice is taken.
 */
export const openStartingMap = Effect.gen(function*() {
  const { project, projectMaps } = useEditor.getState()
  const last = project?.lastOpenMap ?? null
  const candidates = [
    ...(last !== null && projectMaps.some((m) => m.fileName === last) ? [last] : []),
    ...projectMaps.filter((m) => m.fileName !== last).map((m) => m.fileName)
  ]
  for (const fileName of candidates) {
    const opened = yield* readProjectMapIntoEditor(fileName, "active").pipe(
      Effect.as(true),
      Effect.catchCause((cause) => Effect.sync(() => notifyFailure(cause)).pipe(Effect.as(false)))
    )
    if (opened) return
    // only the kept map and the most recent one are tried: the rest are the user's to pick
    if (fileName !== last) break
  }
  yield* freshMapEffect
})

/**
 * Keeps which map is open in the project (`Platform.rememberOpenMap`) as it changes, from now on: the next launch
 * opens it again. Started once the starting map is open, so the memory isn't wiped before it is read. The returned
 * function stops it.
 */
export const followOpenMapEffect = Effect.gen(function*() {
  const platform = yield* Platform
  const runFork = Effect.runForkWith(yield* Effect.context())
  let known = useEditor.getState().file?.name ?? null
  return useEditor.subscribe((s) => {
    const fileName = s.file?.name ?? null
    // a definition's tab isn't a map to come back to
    if (fileName === known || s.document.kind === "prefab") return
    known = fileName
    runFork(
      platform.rememberOpenMap(fileName).pipe(
        Effect.catch((error) => Effect.logWarning("Couldn't keep which map is open", error))
      )
    )
  })
})

/** A project map as Project settings edits it: the file decoded, with the prefs kept for it. */
export interface ProjectMapSettings {
  readonly map: MapFile
  readonly prefs: MapPrefs
}

/** Reads a project map and its prefs for Project settings, without opening it. */
export const projectMapSettingsEffect = Effect.fn("projectMapSettingsEffect")(function*(fileName: string) {
  const file = yield* (yield* Platform).readMap(fileName)
  const map = yield* MapCodec.use((codec) => codec.decode(file.text))
  return { map, prefs: yield* prefsOf(map) } satisfies ProjectMapSettings
})

export const readProjectMapSettings = (fileName: string) => run(projectMapSettingsEffect(fileName))

/**
 * Project settings editing a map no tab has open: the file is read, `patch` applied and the result written through the
 * same path as Save (its name may change, moving the file; the old one goes to the backups).
 */
export const patchProjectMapEffect = Effect.fn("patchProjectMapEffect")(
  function*(fileName: string, patch: (map: MapFile) => MapFile) {
    const read = yield* (yield* Platform).readMap(fileName)
    const map = yield* MapCodec.use((codec) => codec.decode(read.text))
    const result = yield* (yield* MapExporter).prepare(patch(map))
    const saved = yield* writeProjectMap(fileName, result.filename, result.text)
    yield* refreshProject
    return saved
  }
)

/** Moves the active tab's grid (and where pieces land); saved with the map's prefs, not in its history. */
export const setGridHeight = (gridHeight: number) => {
  const { patchTab, tabId } = useEditor.getState()
  patchTab(tabId, { floorHeight: gridHeight })
  return run(saveTabPrefs(tabId))
}

/**
 * Untitled Project becomes a project (the first Save, Project settings): the folder picked, or
 * `<projectsFolder>/<name>`. The open maps stay open, unsaved, and nothing is asked: nothing is left behind.
 */
export const nameProjectEffect = Effect.fn("nameProjectEffect")(function*(project: CreateProjectPayload) {
  yield* (yield* Platform).createProject(project)
  yield* refreshProject
})

/** Refuses a project the first Save would make, with the reason; true when it can be made. Nothing is written. */
export const canMakeProject = (project: CreateProjectPayload) =>
  run(
    Effect.flatMap(Effect.service(Platform), (platform) => platform.checkProject({ _tag: "New", ...project })).pipe(
      Effect.as(true)
    )
  )

/** The Save map dialog's Choose…: a folder for the new project, refused as Open project… refuses it; null on Cancel. */
export const pickProjectFolder = () =>
  run(Effect.flatMap(Effect.service(Platform), (platform) => platform.chooseProject).pipe(Effect.map(Option.getOrNull)))

/** Shows one of the project's folders in the file manager: its `maps/` unless asked otherwise. */
export const revealProject = (which: ProjectFolder = "maps") =>
  run(Effect.flatMap(Effect.service(Platform), (platform) => platform.revealProject(which)))

/** Puts `text` on the system clipboard; true once it is there. */
export const copyText = (text: string) =>
  run(
    Effect.tryPromise({
      try: () => navigator.clipboard.writeText(text),
      catch: () => new PlatformError({ message: "Couldn't copy to the clipboard." })
    }).pipe(Effect.as(true))
  )

/** Project settings › General: the project's name, in its file; the folder keeps its name. */
export const renameProjectEffect = (name: string) =>
  Effect.flatMap(Effect.service(Platform), (platform) => platform.renameProject(name)).pipe(
    Effect.andThen(refreshProject)
  )
