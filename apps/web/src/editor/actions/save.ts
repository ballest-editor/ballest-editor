/**
 * Save (docs/DESKTOP.md § Projects and maps): the open map into its project file, or a download in a browser,
 * the Save map dialog's last step, Rename and Duplicate. A map with no file yet is named first, and whatever was to
 * follow the save (the unsaved-changes prompt's next step, Export, Play) waits for it: `saveOpenMapThen`.
 */
import type { CreateProjectPayload } from "@ballest/contracts"
import { Effect } from "effect"
import { asNewDraft, asNewMap, setLevelNames } from "../../domain/edits"
import { mapFileNameOf, mapLabelOf } from "../../domain/factory"
import { MapExporter } from "../../services/MapExporter"
import { Platform } from "../../services/Platform"
import { type Doc, gameMapOf, type OpenFile, type ProjectMap, tabStateOf, useEditor } from "../store"
import { ASK_FIRST, writeToGame } from "./gameWrite"
import { nameProjectEffect } from "./maps"
import { cacheMapThumbnail } from "./mapThumbnails"
import { savePrefabTab } from "./prefabs"
import { run } from "./run"
import { fileOf, projectName, refreshProject, revealIn, saveTabPrefs, writeProjectMap, writeSidecarOf } from "./shared"

/**
 * The open map encoded the way the game wants it written, with the document it was made from and its tab (the save
 * lands there even when another tab is active by then).
 */
const exportOpenMap = Effect.gen(function*() {
  const { catalogIndex, doc, tabId } = useEditor.getState()
  const result = yield* (yield* MapExporter).prepare(gameMapOf(doc, catalogIndex), catalogIndex)
  return { doc, tabId, result }
})

type ExportedOpenMap = Effect.Success<typeof exportOpenMap>

/**
 * Tab `tabId` has the map `written` open, with its sidecar and prefs under the name it went to. Its thumbnail follows
 * in the background: a save doesn't wait for a render.
 */
const afterWrite = Effect.fnUntraced(function*({ doc, result, tabId }: ExportedOpenMap, written: ProjectMap) {
  useEditor.getState().markSaved(tabId, doc, result.map, fileOf(written))
  yield* writeSidecarOf(doc, written.fileName, written.hash)
  yield* saveTabPrefs(tabId)
  yield* refreshProject
  yield* Effect.forkDetach(cacheMapThumbnail(doc, written.hash))
})

/**
 * Writes the open map into the project as a new map, which its tab then has open. `replace` writes over a map of that
 * name instead (it goes to the project's backups).
 */
const createAsOpenMap = Effect.fn("createAsOpenMap")(function*(opened: ExportedOpenMap, replace = false) {
  const platform = yield* Platform
  const file = { fileName: opened.result.filename, text: opened.result.text }
  const created = yield* replace ? platform.saveMap(file) : platform.createMap(file)
  yield* afterWrite(opened, created)
  return created
})

/** A new project map from the open one (it had no file yet): the `saveAs` dialog's last step on desktop. */
const createFromOpenMap = Effect.gen(function*() {
  const created = yield* createAsOpenMap(yield* exportOpenMap)
  useEditor.getState().notify("info", `Saved ${mapLabelOf(created.fileName)} in ${projectName()}`, {
    kind: "mapSaved",
    actions: [revealIn("project")]
  })
})

/** `stepOfGameWrite`: Export or Play is saving first, so the chip tells the save, and no Export on save follows it. */
interface SaveOptions {
  readonly stepOfGameWrite: boolean
}

/**
 * Writes the open map over its project file. When its name or creator changed since (Rename, Map settings), the file
 * moves to the new name first and the old one goes to the project's backups: the game loads only a file named after
 * the map inside it. Export on save then exports it too.
 */
const writeOpenMap = Effect.fn("writeOpenMap")(function*(file: OpenFile, options: SaveOptions) {
  const opened = yield* exportOpenMap
  const { result, tabId } = opened
  const saved = yield* writeProjectMap(file.name, result.filename, result.text)
  yield* afterWrite(opened, saved)
  const label = mapLabelOf(saved.fileName)
  const renamed = saved.fileName !== file.name
  if (renamed || !options.stepOfGameWrite) {
    useEditor.getState().notify(
      "info",
      renamed ? `Renamed ${mapLabelOf(file.name)} to ${label}` : `Saved ${label}`,
      { kind: renamed ? "mapRenamed" : "mapSaved", actions: [revealIn("project")] }
    )
  }
  // the map's own Export on save, or Settings › General's for every map
  const state = useEditor.getState()
  const exportOnSave = state.settings.general.exportOnSave || tabStateOf(state, tabId)?.exportOnSave === true
  if (!options.stepOfGameWrite && exportOnSave) yield* writeToGame("export", saved.fileName, ASK_FIRST)
  return saved
})

/** A browser's Save and Export: the open map as a download, named the way the game wants it. */
const downloadOpenMap = Effect.gen(function*() {
  const { doc, tabId, result } = yield* exportOpenMap
  yield* (yield* Platform).download({ name: result.filename, text: result.text })
  useEditor.getState().markSaved(tabId, doc, result.map, { name: result.filename, path: null })
  yield* saveTabPrefs(tabId)
  useEditor.getState().notify("info", `Downloaded ${result.filename}`, { kind: "mapDownloaded" })
})

/** The file name the game wants for the open map: a file under another name is out of date. */
const gameFileNameOf = (doc: Doc) => {
  const { levelDisplayName, creatorName } = doc.map.worldSettings.levelData
  return mapFileNameOf(levelDisplayName.trim(), creatorName.trim())
}

/**
 * Opens the `saveAs` dialog to name the open map; `then` runs once the dialog has saved it, and not after its Cancel.
 * The one place that names a map before going on.
 */
const nameFirst = <E, R>(then: Effect.Effect<void, E, R>) =>
  Effect.gen(function*() {
    // It runs later, from the dialog: it takes its services along.
    useEditor.getState().openDialog({
      id: "saveAs",
      afterSave: Effect.provideContext(then, yield* Effect.context<R>())
    })
  })

/**
 * Save, then `then`: on desktop, writes the project file and asks nothing (a map that has no file yet is named first,
 * in the `saveAs` dialog, and `then` waits for it). In a browser, downloads it, asking for the name first unless it
 * is the file's. Export on save exports what was written, unless the save is `stepOfGameWrite`.
 */
export const saveOpenMapThen = <E, R>(
  then: Effect.Effect<void, E, R>,
  options: SaveOptions = { stepOfGameWrite: false }
) =>
  Effect.gen(function*() {
    const platform = yield* Platform
    const { doc, document, file } = useEditor.getState()
    if (document.kind === "prefab") {
      yield* savePrefabTab
      return yield* then
    }
    if (platform.capabilities.projects) {
      if (file === null) return yield* nameFirst(then)
      yield* writeOpenMap(file, options)
      return yield* then
    }
    if (file?.name !== gameFileNameOf(doc)) return yield* nameFirst(then)
    yield* downloadOpenMap
    yield* then
  })

/**
 * Runs `then` with the open map's project file name, for Export and Play, which copy that file: unsaved edits, or a
 * file named for an old name, are saved first (`saveOpenMapThen`, as their step: no toast or Export on save of its own).
 * A map with no file yet is named first, and `then` runs once the Save map dialog has saved it.
 */
export const withSavedOpenMap = <E, R>(then: (fileName: string) => Effect.Effect<void, E, R>) =>
  Effect.gen(function*() {
    const { doc, file, dirty, tabId } = useEditor.getState()
    if (file !== null && !dirty && file.name === gameFileNameOf(doc)) return yield* then(file.name)
    const withSaved = Effect.suspend(() => {
      const saved = tabStateOf(useEditor.getState(), tabId)?.file ?? null
      return saved === null ? Effect.void : then(saved.name)
    })
    yield* saveOpenMapThen(withSaved, { stepOfGameWrite: true })
  })

export const saveMapFile = saveOpenMapThen(Effect.void)

export const saveMap = () => run(saveMapFile)

/**
 * The `saveAs` dialog's last step, once the name is confirmed: into the project (desktop) or a download (browser), then
 * the dialog's `afterSave`.
 */
export const saveMapAsEffect = (afterSave: Effect.Effect<void, unknown> = Effect.void) =>
  Effect.gen(function*() {
    const platform = yield* Platform
    const { file } = useEditor.getState()
    if (!platform.capabilities.projects) yield* downloadOpenMap
    else yield* file === null ? createFromOpenMap : writeOpenMap(file, { stepOfGameWrite: false }).pipe(Effect.asVoid)
    yield* afterSave
  })

export const saveMapAs = (afterSave?: Effect.Effect<void, unknown>) => run(saveMapAsEffect(afterSave))

/**
 * The `saveAs` dialog's last step in Untitled Project: makes the project, which this window then is, and saves the open
 * map into it. The other tabs stay open and are named into it by their own first Save. A project that can't be made
 * stops here with its own error, and the map stays open, unsaved.
 */
export const saveMapInNewProjectEffect = (project: CreateProjectPayload, afterSave?: Effect.Effect<void, unknown>) =>
  nameProjectEffect(project).pipe(Effect.andThen(saveMapAsEffect(afterSave)))

export const saveMapInNewProject = (project: CreateProjectPayload, afterSave?: Effect.Effect<void, unknown>) =>
  run(saveMapInNewProjectEffect(project, afterSave))

/** Rename: new name and creator, then the file moves to match (the old one goes to backups). */
export const renameOpenMap = (displayName: string, creatorName: string) => {
  useEditor.getState().renameLevel(displayName, creatorName)
  return saveMapAs()
}

/**
 * Duplicate: the open map, as it is now, saved into the project under a new name; editing goes on in the copy. The
 * original file keeps its last save. `replace` writes over a map the project has under that name (it goes to the
 * project's backups).
 */
export const duplicateMapEffect = Effect.fn("duplicateMapEffect")(
  function*(displayName: string, creatorName: string, replace = false, newDraft = false) {
    const { catalogIndex, doc, file, tabId } = useEditor.getState()
    const named = asNewMap(setLevelNames(gameMapOf(doc, catalogIndex), displayName, creatorName))
    const result = yield* (yield* MapExporter).prepare(newDraft ? asNewDraft(named) : named, catalogIndex)
    const created = yield* createAsOpenMap({ doc, tabId, result }, replace)
    const from = file === null ? "" : ` from ${mapLabelOf(file.name)}`
    const over = replace ? " (the map it replaced went to the backups)" : ""
    useEditor.getState().notify(
      "info",
      `${newDraft ? "Saved a new draft" : "Duplicated"}${from}: now editing ${mapLabelOf(created.fileName)}${over}`,
      { kind: "mapDuplicated", actions: [revealIn("project")] }
    )
  }
)

export const duplicateMap = (displayName: string, creatorName: string, replace: boolean) =>
  run(duplicateMapEffect(displayName, creatorName, replace))
