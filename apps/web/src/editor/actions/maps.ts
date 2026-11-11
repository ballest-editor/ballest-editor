/**
 * The project's maps in the editor (docs/PROJECTS.md): New map, reading and showing a map, where a window starts,
 * what Project settings reads and writes of a map, and the project's own name and folders. Opening, Import and switching
 * projects are in `project`.
 */
import type { CreateProjectPayload, OpenMaps, ProjectFolder } from "@ballest/contracts"
import { Effect, Option } from "effect"
import { creatorOf, usableCreatorName } from "../../domain/creator"
import { currentCreatedAt, newMapFile, untitledNameOf } from "../../domain/factory"
import { type MapFile, PLAYER_START_CLASS } from "../../domain/MapFile"
import type { MapPrefs } from "../../domain/MapPrefs"
import type { loadStructure } from "../../domain/sidecar"
import { MapCodec } from "../../services/MapCodec"
import { MapExporter } from "../../services/MapExporter"
import { Platform, PlatformError } from "../../services/Platform"
import {
  blankTabs,
  type EditorState,
  inNamedProject,
  noTabOpen,
  tabLabels,
  tabStateOf,
  type TabTarget,
  tabWithFile,
  useEditor
} from "../store"
import { notifyFailure, run } from "./run"
import { fileOf, loadProjectMapFile, prefsOf, refreshProject, saveTabPrefs, showMap, writeProjectMap } from "./shared"

/** Reads one of the project's maps into the editor, in the tab `into` says. */
export const readProjectMapIntoEditor = Effect.fn("readProjectMapIntoEditor")(
  function*(fileName: string, into: TabTarget, load?: typeof loadStructure) {
    const file = yield* (yield* Platform).readMap(fileName)
    const { loaded, map } = yield* loadProjectMapFile(file, load)
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
 * Where a window starts on a project, at launch or after a switch (docs/DESKTOP.md § Document tabs): the map tabs it had
 * open when it was last used, in their order and with the same one active, and the project overview when it had none.
 * Blank tabs hold nothing, so they go; a map with edits, or with no file yet, stays open. A map gone from the project is
 * passed over, and one that won't read is reported. Nothing happens without a project: a browser keeps its one map, and
 * the welcome window its blank one.
 */
export const startOnProject = Effect.gen(function*() {
  const s = useEditor.getState()
  if (!inNamedProject(s)) return
  for (const id of blankTabs(s)) s.closeTab(id)
  const { active, files } = s.project?.openMaps ?? { files: [], active: null }
  const listed = new Set(s.projectMaps.map((map) => map.fileName))
  for (const fileName of files.filter((file) => listed.has(file))) {
    yield* openProjectMapFile(fileName).pipe(Effect.catchCause((cause) => Effect.sync(() => notifyFailure(cause))))
  }
  const activeTab = active === null ? undefined : tabWithFile(useEditor.getState(), active)
  if (activeTab !== undefined) useEditor.getState().activateTab(activeTab)
})

/** The map tabs open in the project, as `rememberOpenMaps` keeps them: those with a file, in tab order. */
const openMapsOf = (s: EditorState): OpenMaps => {
  const files = s.tabIds.flatMap((id) => {
    const tab = tabStateOf(s, id)
    return tab?.document.kind === "map" && tab.file !== null ? [tab.file.name] : []
  })
  const active = noTabOpen(s) || s.document.kind !== "map" ? null : s.file?.name ?? null
  return { files, active: active !== null && files.includes(active) ? active : null }
}

// While above 0, the open maps aren't kept: a switch of projects passes through tabs that belong to neither project.
let openMapsHeld = 0
// The follower's catch-up, for once a hold ends; null while nothing follows.
let catchUpOpenMaps: (() => void) | null = null

/** Runs `effect` without keeping the open maps as the store passes through it, then keeps what it ends on. */
export const holdingOpenMaps = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => void openMapsHeld++),
    () => effect,
    () =>
      Effect.sync(() => {
        openMapsHeld--
        if (openMapsHeld === 0) catchUpOpenMaps?.()
      })
  )

/**
 * Keeps the map tabs open in the project (`Platform.rememberOpenMaps`) as they change, from now on: opening the project
 * again reopens them (`startOnProject`). Started once the startup load has opened them, so the memory isn't wiped before
 * it is read. The returned function stops it.
 */
export const followOpenMapsEffect = Effect.gen(function*() {
  const platform = yield* Platform
  const runFork = Effect.runForkWith(yield* Effect.context())
  let known = JSON.stringify(openMapsOf(useEditor.getState()))
  const keep = () => {
    const s = useEditor.getState()
    if (openMapsHeld > 0 || !inNamedProject(s)) return
    const openMaps = openMapsOf(s)
    const key = JSON.stringify(openMaps)
    if (key === known) return
    known = key
    runFork(
      platform.rememberOpenMaps(openMaps).pipe(
        Effect.catch((error) => Effect.logWarning("Couldn't keep which maps are open", error))
      )
    )
  }
  catchUpOpenMaps = keep
  const stop = useEditor.subscribe(keep)
  return () => {
    stop()
    if (catchUpOpenMaps === keep) catchUpOpenMaps = null
  }
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
