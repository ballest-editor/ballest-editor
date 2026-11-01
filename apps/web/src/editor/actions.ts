/** UI-facing operations that run Effects through the single app runtime. */
import { Cause, Effect, Exit, Fiber, Option, Queue, Stream } from "effect"
import { toast } from "sonner"
import type { UeTransform, Vec3 } from "../domain/coords"
import { asNewDraft, isNeverPublished, setLevelNames } from "../domain/edits"
import { copyNameOf, currentCreatedAt, mapFileNameOf, mapLabelOf, newMapFile } from "../domain/factory"
import {
  gameLinkChanges,
  type GameLinkNotice,
  type GameLinkResult,
  gameLinkResultOf,
  playWithoutPluginNotice,
  PLUGIN_MISSING,
  RESOLVED_BY_PLAY,
  sameGameLinkResult
} from "../domain/gameLink"
import {
  type Axis,
  type AxisEdit,
  selectionAxisEdit,
  type TransformField,
  writeFieldAbout
} from "../domain/groupTransform"
import type { PropertyChange } from "../domain/itemProperties"
import type { Keybinds } from "../domain/Keybinds"
import { floorHeightOf } from "../domain/level"
import { type LevelData, type MapFile, PLAYER_START_CLASS } from "../domain/MapFile"
import { type MapPrefs, mapPrefsKeyOf } from "../domain/MapPrefs"
import { localToWorld, type PivotChoice, pivotFor } from "../domain/pivot"
import type { Settings } from "../domain/Settings"
import type { UnsavedAction } from "../domain/unsaved"
import { CatalogLoader } from "../services/CatalogLoader"
import { KeybindStore } from "../services/KeybindStore"
import { MapCodec } from "../services/MapCodec"
import { type ExportedMap, MapExporter } from "../services/MapExporter"
import { MapPrefsStore } from "../services/MapPrefsStore"
import { MaterialLibrary } from "../services/MaterialLibrary"
import {
  type GamePathKind,
  type GamePaths,
  type MapBackup,
  type NotificationAction,
  type NotificationCommand,
  type NotificationRecord,
  Platform,
  type PlatformError,
  type PlayResult,
  type ProjectMap,
  type ProjectState,
  type UnloadKind
} from "../services/Platform"
import { type AppServices, runtime } from "../services/runtime"
import { SettingsStore } from "../services/SettingsStore"
import { type Doc, type ImportClash, type OpenFile, pivotOf, type SlotPaint, useEditor } from "./store"

const notifyFailure = <E>(cause: Cause.Cause<E>) => {
  const error = Cause.squash(cause)
  const message = typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error)
  useEditor.getState().notify("error", message)
}

const run = async <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A | undefined> => {
  const exit = await runtime.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  notifyFailure(exit.cause)
  return undefined
}

/**
 * Set once the page is about to close or reload after all (the prompt was answered, or the update pill restarts):
 * from then on it doesn't hold the unload.
 */
let leaving = false

// --- selection edits: each is one undo step, however many items it touches ---------------

export const transformSelection = (transforms: ReadonlyMap<string, UeTransform>): boolean =>
  useEditor.getState().transformItems(transforms)

/** Sets material slots (one undo step); see `EditorState.paintSlots`. */
export const paintSlots = (edits: ReadonlyArray<SlotPaint>): boolean => useEditor.getState().paintSlots(edits)

/** Sets item properties on every selected item. */
export const setSelectionProperties = (changes: ReadonlyArray<PropertyChange>): boolean =>
  useEditor.getState().setSelectionProperties(changes)

export const deleteSelection = () => useEditor.getState().deleteSelection()

export const duplicateSelection = () => useEditor.getState().duplicateSelection()

/** An item's document transform: never the live preview. */
const docTransform = (id: string): UeTransform | undefined => {
  const { doc } = useEditor.getState()
  return doc.map.items[doc.ids.indexOf(id)]?.itemTransform
}

/** An item's own pivot, local and unscaled. */
const localPivotOf = (id: string): Vec3 => pivotOf(useEditor.getState(), id).localPosition

/** The selected items' document transforms, each put through `edit` (with the item's own pivot). */
const withSelectionEdit = (
  edit: (t: UeTransform, localPivot: Vec3) => UeTransform
): ReadonlyMap<string, UeTransform> =>
  new Map(
    useEditor.getState().selectedIds.flatMap((id) => {
      const t = docTransform(id)
      return t === undefined ? [] : [[id, edit(t, localPivotOf(id))] as const]
    })
  )

/** An axis edit made from the document transforms, about the active item's pivot like the gizmo. */
const withAxisEdit = (field: TransformField, axis: Axis, edit: AxisEdit) => {
  // the active item is the last selected one
  const activeId = useEditor.getState().selectedIds.findLast((id) => docTransform(id) !== undefined)
  const active = activeId === undefined ? undefined : docTransform(activeId)
  if (activeId === undefined || active === undefined) return new Map()
  const pivot = localToWorld(active, localPivotOf(activeId))
  return withSelectionEdit(selectionAxisEdit(active, field, axis, edit, pivot))
}

/** Sets all three axes of `field` on every selected item (pasting a copied row), about each one's pivot. */
export const setSelectionField = (field: TransformField, value: Vec3): boolean =>
  transformSelection(withSelectionEdit((t, localPivot) => writeFieldAbout(t, field, value, localPivot)))

/** Applies an axis edit (an inspector field) to every selected item. */
export const editSelectionAxis = (field: TransformField, axis: Axis, edit: AxisEdit): boolean =>
  transformSelection(withAxisEdit(field, axis, edit))

/**
 * Shows an axis edit live (a scrub) without committing it; null ends the preview. The edit is
 * the whole scrub so far, from the document, not a step on top of the last preview.
 */
export const previewSelectionAxis = (field: TransformField, axis: Axis, edit: AxisEdit | null): void =>
  useEditor.getState().setPreview(edit === null ? null : withAxisEdit(field, axis, edit))

/**
 * Sets the pivot `choice` on every selected item, measured on each one's own bounds (one
 * undo step). Items whose bounds are unknown keep their pivot.
 */
export const setSelectionPivot = (choice: PivotChoice): void => {
  const { doc, selectedIds, catalogIndex, setItemPivots } = useEditor.getState()
  setItemPivots(
    new Map(selectedIds.flatMap((id) => {
      const item = doc.map.items[doc.ids.indexOf(id)]
      const pivot = item === undefined ? undefined : pivotFor(item, catalogIndex, choice)
      return pivot === undefined ? [] : [[id, pivot] as const]
    }))
  )
}

export const loadCatalog = () =>
  run(
    Effect.gen(function*() {
      const loaded = yield* CatalogLoader.use((loader) => loader.load)
      useEditor.getState().setCatalog(loaded)
    })
  )

export const loadMaterials = () =>
  run(
    Effect.gen(function*() {
      const { table, paint } = yield* MaterialLibrary.use((library) => library.load)
      useEditor.getState().setMaterials(table, paint)
    })
  )

export const loadSettings = () =>
  run(
    Effect.gen(function*() {
      useEditor.getState().setSettings(yield* SettingsStore.use((store) => store.load))
    })
  )

/** Applies immediately, then persists. */
export const saveSettings = (settings: Settings) => {
  useEditor.getState().setSettings(settings)
  return run(
    Effect.gen(function*() {
      const store = yield* SettingsStore
      yield* store.save(settings)
    })
  )
}

/** Changes some fields of one settings section (snapping, appearance...), then persists. */
export const updateSettings = <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) => {
  const { settings } = useEditor.getState()
  return saveSettings({ ...settings, [section]: { ...settings[section], ...patch } })
}

/** Stored (or default) keybinds, with the game's defaults they were derived from, into the editor. */
const applyKeybinds = (source: "load" | "reset") =>
  run(
    Effect.gen(function*() {
      const store = yield* KeybindStore
      const { keybinds, defaults } = yield* store[source]
      useEditor.getState().setKeybinds(keybinds, defaults)
    })
  )

export const loadKeybinds = () => applyKeybinds("load")

export const saveKeybinds = (keybinds: Keybinds) =>
  run(
    Effect.gen(function*() {
      yield* KeybindStore.use((store) => store.save(keybinds))
      useEditor.getState().setKeybinds(keybinds)
    })
  )

export const resetKeybinds = () => applyKeybinds("reset")

/** The resolved theme to the desktop window's controls; cosmetic, so a failure is only logged. */
export const setWindowTheme = (dark: boolean) =>
  run(
    Effect.gen(function*() {
      yield* (yield* Platform).setWindowTheme(dark)
    }).pipe(Effect.catch((error) => Effect.logWarning("Couldn't recolour the window controls", error)))
  )

/**
 * What the platform offers, the project with its maps (desktop) and the creator name it finds, into the store. The
 * desktop app starts on the Start tab; a browser, which has no project, on its one map.
 */
export const loadPlatform = () =>
  run(
    Effect.gen(function*() {
      const { capabilities } = yield* Platform
      useEditor.getState().setCapabilities(capabilities)
      if (!capabilities.projects) useEditor.getState().loadMap(useEditor.getState().doc.map, null)
      yield* refreshProject
      yield* findCreatorEffect
      if (capabilities.exportToGame) yield* checkGameLinkEffect
    })
  )

/**
 * Looks up the creator name the game would use (the Steam persona name). Settings › General shows it until the user
 * types their own. Nothing to report when it fails: the user can still type a name.
 */
export const findCreatorEffect = Effect.gen(function*() {
  useEditor.getState().setFoundCreator(yield* (yield* Platform).findCreator)
}).pipe(Effect.catch((error) => Effect.logWarning("Couldn't look up the creator name", error)))

/** Looks the creator name up again, for Settings › General: the user may have logged in to Steam since. */
export const findCreator = () => run(findCreatorEffect)

/** The desktop updater's state into the store, now and on every change; a browser's has none. */
export const followUpdateState = Effect.gen(function*() {
  const platform = yield* Platform
  yield* platform.updates.pipe(Stream.runForEach((state) => Effect.sync(() => useEditor.getState().setUpdate(state))))
})

/** Runs `effect` in the background until the returned function is called (a React effect's cleanup); failures are logged. */
const runUntilCleanup = <E>(effect: Effect.Effect<void, E, AppServices>, failure: string): () => void => {
  const fiber = runtime.runFork(effect.pipe(Effect.catch((error) => Effect.logWarning(failure, error))))
  return () => void runtime.runFork(Fiber.interrupt(fiber))
}

/** Follows the updater (`followUpdateState`) until the returned function is called: a React effect's cleanup. */
export const followUpdates = () => runUntilCleanup(followUpdateState, "Stopped following the updater")

const updateStep = (step: "downloadUpdate" | "installUpdate") =>
  Effect.gen(function*() {
    yield* (yield* Platform)[step]
  })

/** Starts downloading the release on offer; the pill follows its progress. */
export const downloadUpdate = () => run(updateStep("downloadUpdate"))

/** Quits, installs the downloaded release and starts it; unsaved edits are lost (the update pill says so first). */
export const installUpdate = () =>
  run(
    Effect.sync(() => void (leaving = true)).pipe(
      Effect.andThen(updateStep("installUpdate")),
      Effect.tapError(() => Effect.sync(() => void (leaving = false)))
    )
  )

// --- maps, the project and exports (docs/PROJECTS.md) ---------------------------------------

/** The project in use, the recent ones and its maps into the store (desktop). */
const refreshProject = Effect.gen(function*() {
  const platform = yield* Platform
  if (!platform.capabilities.projects) return
  useEditor.getState().setProject(yield* platform.projectState, yield* platform.listMaps)
})

const fileOf = (map: ProjectMap): OpenFile => ({ name: map.fileName, path: map.path })

/** A notification's Reveal: the project's maps folder, or the game's. */
const revealIn = (where: "project" | "game"): NotificationAction => ({
  label: "Reveal",
  command: where === "project" ? { _tag: "RevealProject" } : { _tag: "RevealGamePath", which: "mapsFolder" }
})

const projectName = () => useEditor.getState().project?.current.name ?? "the project"

/** The open map encoded the way the game wants it written, with the document it was made from. */
const exportOpenMap = Effect.gen(function*() {
  const { doc } = useEditor.getState()
  const result = yield* (yield* MapExporter).prepare(doc.map)
  return { doc, result }
})

/** Puts a map into the editor, with the prefs saved for it; `dirty` opens it as unsaved edits of `file`. */
const showMap = Effect.fn("showMap")(function*(
  map: MapFile,
  file: OpenFile | null,
  options?: { readonly dirty: boolean }
) {
  // unreadable prefs only cost the saved grid height and Export on save
  const prefs = yield* MapPrefsStore.use((store) => store.load(mapPrefsKeyOf(map))).pipe(
    Effect.orElseSucceed((): MapPrefs => ({}))
  )
  useEditor.getState().loadMap(map, file, prefs.gridHeight, {
    exportOnSave: prefs.exportOnSave === true,
    dirty: options?.dirty === true
  })
})

/**
 * New map: starts it the way the in-game editor does and, on desktop, saves it into the project at once (making the
 * project the first time). A browser keeps it in memory.
 */
export const createNewMap = Effect.fn("createNewMap")(function*(displayName: string, creatorName: string) {
  const platform = yield* Platform
  const createdAt = yield* currentCreatedAt
  const catalog = useEditor.getState().catalog?.catalog
  const playerStartPiece = catalog?.pieces.find((p) => p.classPath === PLAYER_START_CLASS)
  const map = newMapFile({ displayName, creatorName, createdAt, playerStartPiece })
  if (!platform.capabilities.projects) {
    useEditor.getState().loadMap(map, null)
    return
  }
  const result = yield* (yield* MapExporter).prepare(map)
  const created = yield* platform.createMap({ fileName: result.filename, text: result.text })
  yield* showMap(result.map, fileOf(created))
  yield* refreshProject
  useEditor.getState().notify("info", `Created ${mapLabelOf(created.fileName)} in ${projectName()}`, {
    kind: "mapCreated",
    actions: [revealIn("project")]
  })
})

export const newMap = (displayName: string, creatorName: string) => run(createNewMap(displayName, creatorName))

/** Opens one of the project's maps. */
export const openProjectMapFile = Effect.fn("openProjectMapFile")(function*(fileName: string) {
  const file = yield* (yield* Platform).readMap(fileName)
  const map = yield* MapCodec.use((codec) => codec.decode(file.text))
  yield* showMap(map, fileOf(file))
  useEditor.getState().notify("info", `Opened ${mapLabelOf(file.fileName)} (${map.items.length} items)`, {
    kind: "mapOpened"
  })
})

/**
 * Opens one of the project's maps in the map tab (there is one), asking about the open map's unsaved edits first;
 * when it is that map, its tab shows.
 */
export const openProjectMap = (fileName: string) => {
  const { mapOpen, file, showMapTab } = useEditor.getState()
  if (mapOpen && file?.name === fileName) showMapTab()
  else {void run(
      unlessCancelled("openMap", openProjectMapFile(fileName)).pipe(Effect.ensuring(Effect.ignore(refreshProject)))
    )}
}

/** Closes the map's tab, and Start shows; unsaved edits ask first (the shared prompt, `unlessCancelled`). */
export const closeMapTabEffect = Effect.suspend(() =>
  unlessCancelled("closeMap", Effect.sync(() => useEditor.getState().closeMap()))
)

export const closeMapTab = () => run(closeMapTabEffect)

/** Copies a picked file into the project (or reports the clash) and opens the copy. */
const importInto = Effect.fn("importInto")(function*(pending: ImportClash, replace: boolean) {
  const platform = yield* Platform
  const { source, fileName, text, map } = pending
  const result = yield* platform.importMap({ source, fileName, text, replace })
  if (result._tag === "Clash") {
    useEditor.getState().setImportClash(pending)
    return
  }
  yield* showMap(map, fileOf(result.map))
  yield* refreshProject
  useEditor.getState().notify(
    "info",
    `Imported ${mapLabelOf(fileName)} into ${projectName()} (${map.items.length} items)`,
    { kind: "mapImported", actions: [revealIn("project")] }
  )
})

/**
 * Open… in a browser: the file input, then the map in memory. Import… on desktop: a map file from anywhere is copied
 * into the project under the game's file name for it and opened from there; nothing outside the project is edited in
 * place. A `.balledit` is copied byte for byte; a `.ballmap` (a Workshop map) is written as the `.balledit` the game
 * would make of it.
 */
export const importMapFile = Effect.gen(function*() {
  const platform = yield* Platform
  const picked = yield* platform.pickMapFile
  if (Option.isNone(picked)) return
  const { name, path, text } = picked.value
  const map = yield* MapCodec.use((codec) => codec.decode(text))
  if (Option.isNone(path)) {
    yield* showMap(map, { name, path: null })
    useEditor.getState().notify("info", `Opened ${name} (${map.items.length} items)`, { kind: "mapOpened" })
    return
  }
  const { levelDisplayName, creatorName } = map.worldSettings.levelData
  const pending = name.toLowerCase().endsWith(".balledit")
    ? { fileName: mapFileNameOf(levelDisplayName.trim(), creatorName.trim()), text, map }
    : yield* (yield* MapExporter).prepare(map).pipe(
      Effect.map((prepared) => ({ fileName: prepared.filename, text: prepared.text, map: prepared.map }))
    )
  yield* importInto({ source: path.value, ...pending }, false)
})

export const importMap = () => run(unlessCancelled("openMap", importMapFile))

/** The clash dialog's Replace: the project's map of that name goes to backups. */
export const replaceOnImportEffect = Effect.gen(function*() {
  const { importClash, setImportClash } = useEditor.getState()
  if (importClash === null) return
  setImportClash(null)
  yield* importInto(importClash, true)
})

export const replaceOnImport = () => run(replaceOnImportEffect)

/** The clash dialog's Import as copy: the imported map is renamed `<name> 2` (or the next free number). */
export const importAsCopyEffect = Effect.gen(function*() {
  const { importClash, setImportClash, projectMaps } = useEditor.getState()
  if (importClash === null) return
  setImportClash(null)
  const { levelDisplayName, creatorName } = importClash.map.worldSettings.levelData
  const creator = creatorName.trim()
  const taken = new Set(projectMaps.map((m) => m.fileName))
  const name = copyNameOf(levelDisplayName.trim(), creator, taken)
  const prepared = yield* (yield* MapExporter).prepare(setLevelNames(importClash.map, name, creator))
  yield* importInto({ ...importClash, fileName: prepared.filename, text: prepared.text, map: prepared.map }, false)
})

export const importAsCopy = () => run(importAsCopyEffect)

/**
 * Writes `result` (made from `doc`) into the project as a new map, which the editor then has open. `replace` writes
 * over a map of that name instead (it goes to the project's backups).
 */
const createAsOpenMap = Effect.fn("createAsOpenMap")(function*(doc: Doc, result: ExportedMap, replace = false) {
  const platform = yield* Platform
  const file = { fileName: result.filename, text: result.text }
  const created = yield* replace ? platform.saveMap(file) : platform.createMap(file)
  useEditor.getState().markSaved(doc, result.map, fileOf(created))
  yield* saveMapPrefs
  yield* refreshProject
  return created
})

/** A new project map from the open one (it had no file yet): the `saveAs` dialog's last step on desktop. */
const createFromOpenMap = Effect.gen(function*() {
  const { doc, result } = yield* exportOpenMap
  const created = yield* createAsOpenMap(doc, result)
  useEditor.getState().notify("info", `Saved ${mapLabelOf(created.fileName)} in ${projectName()}`, {
    kind: "mapSaved",
    actions: [revealIn("project")]
  })
})

/**
 * Writes the open map over its project file. When its name or creator changed since (Rename, Map settings), the file
 * moves to the new name first and the old one goes to the project's backups: the game loads only a file named after
 * the map inside it. Export on save then exports it too.
 */
const writeOpenMap = Effect.fn("writeOpenMap")(function*(file: OpenFile, options: { readonly exportAfter: boolean }) {
  const platform = yield* Platform
  const { doc, result } = yield* exportOpenMap
  const saved = result.filename === file.name
    ? yield* platform.saveMap({ fileName: file.name, text: result.text })
    : yield* platform.renameMap({ from: file.name, to: result.filename, text: result.text })
  useEditor.getState().markSaved(doc, result.map, fileOf(saved))
  // a rename moves the prefs to the new name
  yield* saveMapPrefs
  yield* refreshProject
  const label = mapLabelOf(saved.fileName)
  useEditor.getState().notify(
    "info",
    saved.fileName === file.name ? `Saved ${label}` : `Renamed ${mapLabelOf(file.name)} to ${label}`,
    { kind: saved.fileName === file.name ? "mapSaved" : "mapRenamed", actions: [revealIn("project")] }
  )
  if (options.exportAfter && useEditor.getState().exportOnSave) yield* exportProjectMap(saved.fileName, false)
  return saved
})

/** A browser's Save and Export: the open map as a download, named the way the game wants it. */
const downloadOpenMap = Effect.gen(function*() {
  const { doc, result } = yield* exportOpenMap
  yield* (yield* Platform).download({ name: result.filename, text: result.text })
  useEditor.getState().markSaved(doc, result.map, { name: result.filename, path: null })
  yield* saveMapPrefs
  useEditor.getState().notify("info", `Downloaded ${result.filename}`, { kind: "mapDownloaded" })
})

/**
 * Save, then `then`: on desktop, writes the project file and asks nothing (a map that has no file yet is named first,
 * in the `saveAs` dialog, and `then` waits for it). In a browser, downloads it, asking for the name first unless it
 * is the file's.
 */
const saveOpenMapThen = <E, R>(then: Effect.Effect<void, E, R>) =>
  Effect.gen(function*() {
    const platform = yield* Platform
    const { doc, file, nameThen } = useEditor.getState()
    // It may run later, from the dialog: it takes its services along.
    const nameFirst = Effect.gen(function*() {
      nameThen(Effect.provideContext(then, yield* Effect.context<R>()))
    })
    if (platform.capabilities.projects) {
      if (file === null) return yield* nameFirst
      yield* writeOpenMap(file, { exportAfter: true })
      return yield* then
    }
    const { levelDisplayName, creatorName } = doc.map.worldSettings.levelData
    if (file?.name !== mapFileNameOf(levelDisplayName.trim(), creatorName.trim())) return yield* nameFirst
    yield* downloadOpenMap
    yield* then
  })

export const saveMapFile = saveOpenMapThen(Effect.void)

export const saveMap = () => run(saveMapFile)

/** The `saveAs` dialog's last step, once the name is confirmed: into the project (desktop) or a download (browser). */
export const saveMapAsEffect = Effect.gen(function*() {
  const platform = yield* Platform
  const { file, takeAfterSave } = useEditor.getState()
  const then = takeAfterSave()
  if (!platform.capabilities.projects) yield* downloadOpenMap
  else yield* file === null ? createFromOpenMap : writeOpenMap(file, { exportAfter: true }).pipe(Effect.asVoid)
  if (then !== null) yield* then
})

export const saveMapAs = () => run(saveMapAsEffect)

// --- unsaved changes: one prompt before anything that would lose them ------------------------

/** The open map's name, as the prompt shows it. */
const openMapName = () => useEditor.getState().doc.map.worldSettings.levelData.levelDisplayName.trim() || "Untitled"

/**
 * Runs `next` unless the open map has unsaved edits and the user cancels. With unsaved edits the platform asks first
 * (Save, Don't save, Cancel): Save saves the map, naming it first if it has to, then goes on; Don't save goes on.
 */
export const unlessCancelled = <E, R>(action: UnsavedAction, next: Effect.Effect<void, E, R>) =>
  Effect.gen(function*() {
    if (!useEditor.getState().dirty) return yield* next
    const choice = yield* (yield* Platform).confirmUnsaved(action, openMapName())
    if (choice === "save") yield* saveOpenMapThen(next)
    else if (choice === "discard") yield* next
  })

/** Whether the page holds a close or a reload (its `beforeunload` cancels it) so the prompt can ask first. */
export const holdsUnload = () => useEditor.getState().dirty && !leaving

/** The desktop window held a close or a reload: asks, then closes or reloads unless the user cancelled. */
export const answerUnloadRequest = (kind: UnloadKind) =>
  unlessCancelled(
    kind,
    Effect.gen(function*() {
      leaving = true
      yield* (yield* Platform).leave(kind)
    })
  )

/** Answers the window's held closes and reloads (`answerUnloadRequest`) until the returned function is called. */
export const followUnloadRequests = (): () => void => {
  const fiber = runtime.runFork(
    Effect.gen(function*() {
      yield* (yield* Platform).unloadRequests.pipe(
        Stream.runForEach((kind) =>
          answerUnloadRequest(kind).pipe(Effect.catchCause((cause) => Effect.sync(() => notifyFailure(cause))))
        )
      )
    }).pipe(Effect.catch((error) => Effect.logWarning("Stopped following the window's close requests", error)))
  )
  return () => void runtime.runFork(Fiber.interrupt(fiber))
}

/** New map: asks about unsaved edits first, then the New map dialog (name and creator). */
export const startNewMapEffect = unlessCancelled(
  "newMap",
  Effect.sync(() => useEditor.getState().openDialog("new"))
)

export const startNewMap = () => run(startNewMapEffect)

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
    const { doc, file } = useEditor.getState()
    const named = setLevelNames(doc.map, displayName, creatorName)
    const result = yield* (yield* MapExporter).prepare(newDraft ? asNewDraft(named) : named)
    const created = yield* createAsOpenMap(doc, result, replace)
    const from = file === null ? "" : ` from ${mapLabelOf(file.name)}`
    const over = replace ? " (the map it replaced went to the backups)" : ""
    useEditor.getState().notify(
      "info",
      `${newDraft ? "Saved a new draft" : "Duplicated"}${from}: now editing ${mapLabelOf(created.fileName)}${over}`,
      { kind: "mapDuplicated", actions: [revealIn("project")] }
    )
  }
)

export const duplicateMap = (displayName: string, creatorName: string, replace = false) =>
  run(duplicateMapEffect(displayName, creatorName, replace))

/** Copies a saved project map into the game's maps folder; a published map's draft there asks first. */
const exportProjectMap = Effect.fn("exportProjectMap")(function*(fileName: string, replacePublished: boolean) {
  const exported = yield* (yield* Platform).exportMap(fileName, { replacePublished })
  if (exported._tag === "Published") {
    useEditor.getState().setPublishedDraft({
      name: exported.file.name,
      publishedFileId: exported.publishedFileId,
      from: "export"
    })
    return
  }
  yield* refreshProject
  useEditor.getState().notify("info", `Exported ${mapLabelOf(fileName)} to the game's maps folder`, {
    kind: "mapExported",
    actions: [revealIn("game")]
  })
})

/**
 * Runs `then` with the open map's project file name, for Export and Play, which copy that file: unsaved edits are
 * saved first. A map with no file yet is named first, and `then` runs once the Save map dialog has saved it.
 */
const withSavedOpenMap = <E, R>(then: (fileName: string) => Effect.Effect<void, E, R>) =>
  Effect.gen(function*() {
    const { doc, file, dirty, nameThen } = useEditor.getState()
    if (file === null) {
      const named = Effect.suspend(() => {
        const saved = useEditor.getState().file
        return saved === null ? Effect.void : then(saved.name)
      })
      // It runs later, from the dialog: it takes its services along.
      nameThen(Effect.provideContext(named, yield* Effect.context<R>()))
      return
    }
    const { levelDisplayName, creatorName } = doc.map.worldSettings.levelData
    yield* then(
      dirty || file.name !== mapFileNameOf(levelDisplayName.trim(), creatorName.trim())
        ? (yield* writeOpenMap(file, { exportAfter: false })).fileName
        : file.name
    )
  })

/**
 * Export to game: writes the map into the game's UserSavedMaps folder under the game's file name, where the in-game
 * editor lists it. The export is a copy of the project file, so unsaved edits are saved first. A map with no file yet
 * is named first.
 */
export const exportToGameEffect = (replacePublished: boolean) =>
  withSavedOpenMap((fileName) => exportProjectMap(fileName, replacePublished))

export const exportToGame = () => run(exportToGameEffect(false))

/** The replacePublished dialog's answer: replace the published map's draft after all, and go on with Export or Play. */
export const replacePublishedDraft = () => {
  const from = useEditor.getState().publishedDraft?.from ?? "export"
  useEditor.getState().setPublishedDraft(null)
  return run(from === "play" ? playEffect(true) : exportToGameEffect(true))
}

// --- Play (docs/DESKTOP.md § Play) -----------------------------------------------------------

/** Tells how Play went: racing, starting the game to race, or exported only because the plugin can't be reached. */
const notifyPlayed = (fileName: string, played: Extract<PlayResult, { readonly _tag: "Played" }>) => {
  const { notify, resolveNotifications } = useEditor.getState()
  const label = mapLabelOf(fileName)
  const { plugin, sent, launch } = played
  if (launch === "failed") {
    notify("error", `Exported ${label}, but couldn't ask Steam to start the game. Is Steam running?`, {
      kind: "play",
      actions: [revealIn("game")]
    })
  } else if (sent) {
    for (const kind of RESOLVED_BY_PLAY) resolveNotifications(kind)
    const outdated = plugin.status === "outdated"
    notify("info", launch === "running" ? `Racing ${label} in the game` : `Starting the game to race ${label}`, {
      kind: "play",
      ...(launch === "launched" && { body: "The race starts once the game and the plugin manager are up." }),
      ...(outdated && { actions: [{ label: "Update plugin", command: { _tag: "InstallPlugin" } }] })
    })
  } else {
    notifyNotice(playWithoutPluginNotice(label, launch === "launched", plugin.status))
  }
}

/** Exports a saved project map and races it in the game; a published map's draft in the maps folder asks first. */
const playProjectMap = Effect.fn("playProjectMap")(function*(fileName: string, replacePublished: boolean) {
  const result = yield* (yield* Platform).play(fileName, { replacePublished })
  switch (result._tag) {
    case "Published":
      useEditor.getState().setPublishedDraft({
        name: result.file.name,
        publishedFileId: result.publishedFileId,
        from: "play"
      })
      return
    case "PublishedMap":
      useEditor.getState().openDialog("newDraft")
      return
    case "Played":
      yield* refreshProject
      notifyPlayed(fileName, result)
  }
})

/**
 * Play: Export to game (saving unsaved edits first, naming a map with no file yet), then the plugin races it in the
 * game, which starts if it isn't running. The plugin manager only races maps never published, so a published map's
 * draft offers to save a new draft of it instead (the `newDraft` dialog).
 */
export const playEffect = (replacePublished: boolean) =>
  Effect.suspend(() =>
    isNeverPublished(useEditor.getState().doc.map.worldSettings.levelData.levelPublishedFileId)
      ? withSavedOpenMap((fileName) => playProjectMap(fileName, replacePublished))
      : Effect.sync(() => useEditor.getState().openDialog("newDraft"))
  )

export const playMap = () => run(playEffect(false))

/** The newDraft dialog's answer: a copy of the map that was never published, under a new name; then Play races it. */
export const playAsNewDraft = (displayName: string, creatorName: string, replace = false) =>
  run(duplicateMapEffect(displayName, creatorName, replace, true).pipe(Effect.andThen(playEffect(false))))

/**
 * A game session Play started or joined has ended: the game may have changed the export (the in-game editor saves
 * over it), so the project's maps are listed again. Sync detection (#141) runs its check here.
 */
const playSessionEnded = refreshProject

/** Follows the end of each game session Play started (`playSessionEnded`) until the returned function is called. */
export const followPlaySessions = () =>
  runUntilCleanup(
    Effect.gen(function*() {
      yield* (yield* Platform).playSessionEnds.pipe(
        Stream.runForEach(() =>
          playSessionEnded.pipe(Effect.catchCause((cause) => Effect.sync(() => notifyFailure(cause))))
        )
      )
    }),
    "Stopped following the game sessions Play started"
  )

// --- backups and Recover (docs/PROJECTS.md § The files) --------------------------------------

/** The versions main kept of the files it wrote over, newest first, for the Recover dialog (desktop). */
export const listBackups = () =>
  run(Effect.gen(function*() {
    return yield* (yield* Platform).listBackups
  }))

/** What a backup holds, decoded the way Open would: its map's names and item count, or why it can't be opened. */
export type BackupSummary =
  | {
    readonly _tag: "Map"
    readonly displayName: string
    readonly creatorName: string
    readonly items: number
  }
  | { readonly _tag: "Unreadable"; readonly message: string }

export const describeBackupEffect = Effect.fn("describeBackupEffect")(function*(backup: MapBackup) {
  const file = yield* (yield* Platform).readBackup(backup)
  const map = yield* MapCodec.use((codec) => codec.decode(file.text))
  const { levelDisplayName, creatorName } = map.worldSettings.levelData
  return { _tag: "Map", displayName: levelDisplayName, creatorName, items: map.items.length } satisfies BackupSummary
}, Effect.catch((error) => Effect.succeed({ _tag: "Unreadable", message: error.message } satisfies BackupSummary)))

export const describeBackup = (backup: MapBackup) => run(describeBackupEffect(backup))

/**
 * Recover: opens a backup as unsaved edits of the project map it is a version of, so Save writes it over that map
 * (whose file is backed up first). A map no longer in the project opens as a new one, named on Save. `recoverBackup`
 * asks about the open map's unsaved edits first, like opening any other map.
 */
export const recoverBackupEffect = Effect.fn("recoverBackupEffect")(function*(backup: MapBackup) {
  const file = yield* (yield* Platform).readBackup(backup)
  const map = yield* MapCodec.use((codec) => codec.decode(file.text))
  yield* refreshProject
  const inProject = useEditor.getState().projectMaps.find((m) => m.fileName === backup.fileName)
  yield* showMap(map, inProject === undefined ? null : fileOf(inProject), { dirty: true })
  const label = mapLabelOf(backup.fileName)
  useEditor.getState().notify(
    "info",
    inProject === undefined
      ? `Opened a previous version of ${label} (${map.items.length} items). It is no longer in the project: Save adds it.`
      : `Opened a previous version of ${label} (${map.items.length} items), unsaved. Save writes it over the map; the current file is backed up first.`
  )
})

export const recoverBackup = (backup: MapBackup) => run(unlessCancelled("openMap", recoverBackupEffect(backup)))

/** Export on save for the open map, kept with its prefs. */
export const setExportOnSave = (exportOnSave: boolean) => {
  useEditor.getState().setExportOnSave(exportOnSave)
  return run(saveMapPrefs)
}

/**
 * Uses another project from now on, asking about unsaved edits first (Save writes them into the project being left).
 * The open map stays open; it belonged to the old project, so it is unsaved here.
 */
const changeProject = (
  change: (platform: Platform["Service"]) => Effect.Effect<Option.Option<ProjectState>, PlatformError>
) =>
  run(unlessCancelled(
    "switchProject",
    Effect.gen(function*() {
      const before = useEditor.getState().project?.current.path
      const next = yield* change(yield* Platform)
      if (Option.isNone(next)) return
      if (next.value.current.path !== before) useEditor.getState().detachFile()
      yield* refreshProject
      useEditor.getState().notify("info", `Using the project ${next.value.current.name}`, {
        kind: "projectChanged",
        actions: [revealIn("project")]
      })
    })
  ))

/** A folder dialog; the chosen folder becomes the project (the game's maps folder is refused, with the reason). */
export const chooseProject = () => changeProject((platform) => platform.chooseProject)

/** Goes back to a recent project; the one in use already is left alone. */
export const switchProject = (path: string) =>
  path === useEditor.getState().project?.current.path
    ? Promise.resolve(undefined)
    : changeProject((platform) => Effect.asSome(platform.switchProject(path)))

export const revealProject = () =>
  run(
    Effect.gen(function*() {
      yield* (yield* Platform).revealProject
    })
  )

/** Starts the game through Steam, unless it is already running. */
export const launchGameEffect = Effect.gen(function*() {
  const platform = yield* Platform
  if (yield* platform.isGameRunning) {
    useEditor.getState().notify("info", "Ballest of Them All is already running", { kind: "gameLaunch" })
    return
  }
  yield* platform.launchGame
  useEditor.getState().notify("info", "Starting Ballest of Them All through Steam", { kind: "gameLaunch" })
})

export const launchGame = () => run(launchGameEffect)

/** Looks the editor-link plugin up again: it depends on the game folders. */
const refreshPluginStatus = Effect.gen(function*() {
  useEditor.getState().setPluginStatus(yield* (yield* Platform).pluginStatus)
})

// --- the Game link (docs/PROJECTS.md § Shell) ---------------------------------------------

/** Keeps `current` for the next launch to compare with, unless it is what was kept already; a failure is only logged. */
const rememberGameLink = (current: GameLinkResult) =>
  Effect.gen(function*() {
    if (sameGameLinkResult(useEditor.getState().gameLink.last, current)) return
    useEditor.getState().setGameLink({ last: current })
    yield* (yield* Platform).rememberGameLink(current)
  }).pipe(Effect.catch((error) => Effect.logWarning("Couldn't keep the Game link's result", error)))

/** Records a Game link notice (or one of Play's, which share its kinds) in the notification centre. */
const notifyNotice = ({ level, title, kind, body, persistent, actions }: GameLinkNotice) =>
  useEditor.getState().notify(level, title, { kind, persistent, actions, ...(body !== undefined && { body }) })

/** Tells the notification centre what `previous` → `current` changed: new notices, and pinned ones resolved. */
const reportGameLink = (previous: GameLinkResult | null, current: GameLinkResult) => {
  const { notices, resolve } = gameLinkChanges(previous, current)
  const { resolveNotifications } = useEditor.getState()
  for (const kind of resolve) resolveNotifications(kind)
  for (const notice of notices) notifyNotice(notice)
}

/**
 * After the game's folders or the plugin were looked up again in this session: the pinned notifications whose cause
 * is gone resolve themselves, and the result is kept. Nothing new is notified; the checklist already shows it.
 */
const noteGameLink = Effect.gen(function*() {
  const { gamePaths, pluginStatus } = useEditor.getState()
  if (gamePaths === null || pluginStatus === null) return
  const current = gameLinkResultOf(gamePaths, pluginStatus)
  reportGameLink(null, current)
  yield* rememberGameLink(current)
})

/**
 * The startup check behind the Start tab's Game link (desktop): looks up the game's folders and the plugin, and
 * notifies only what changed since the last launch (none on the first, when the checklist itself is in front of the
 * user). Persistent notices (game not found, plugin manager missing) stay pinned until their cause goes away.
 */
export const checkGameLinkEffect = Effect.gen(function*() {
  const platform = yield* Platform
  const memory = yield* platform.gameLinkMemory
  useEditor.getState().muteNotifications(memory.muted)
  useEditor.getState().setGameLink({ firstRun: memory.last === null, last: memory.last })
  const paths = yield* platform.gamePaths
  useEditor.getState().setGamePaths(paths)
  const plugin = yield* platform.pluginStatus
  useEditor.getState().setPluginStatus(plugin)
  const current = gameLinkResultOf(paths, plugin)
  reportGameLink(memory.last, current)
  yield* rememberGameLink(current)
}).pipe(Effect.catch((error) => Effect.logWarning("Couldn't check the Game link", error)))

/** Runs a lookup that may return the game's folders (none: the user cancelled) and shows them, and the plugin. */
const gamePathsShown = <E, R>(
  lookup: (platform: Platform["Service"]) => Effect.Effect<Option.Option<GamePaths>, E, R>
) =>
  Effect.gen(function*() {
    const paths = yield* lookup(yield* Platform)
    if (Option.isNone(paths)) return
    useEditor.getState().setGamePaths(paths.value)
    useEditor.getState().setGamePathProblem(null)
    yield* refreshPluginStatus
    yield* noteGameLink
  })

const showGamePaths = <E>(
  lookup: (platform: Platform["Service"]) => Effect.Effect<Option.Option<GamePaths>, E, AppServices>
) => run(gamePathsShown(lookup))

/** Looks the game's folders up again, for Settings › Game. */
export const loadGamePaths = () => showGamePaths((platform) => Effect.asSome(platform.gamePaths))

/** A folder dialog; the chosen folder replaces the one found for `which`. */
export const chooseGamePath = (which: GamePathKind) => showGamePaths((platform) => platform.chooseGamePath(which))

/**
 * Choose folder… on the Start tab's Game link: `chooseGamePath`, but a folder main refuses (not the game's) is shown on
 * the checklist's row instead of toasted, and nothing is saved.
 */
export const chooseGameLinkFolderEffect = (which: GamePathKind) =>
  gamePathsShown((platform) =>
    platform.chooseGamePath(which).pipe(
      Effect.catch((error) =>
        Effect.sync(() => useEditor.getState().setGamePathProblem({ which, message: error.message })).pipe(
          Effect.as(Option.none<GamePaths>())
        )
      )
    )
  )

export const chooseGameLinkFolder = (which: GamePathKind) => run(chooseGameLinkFolderEffect(which))

/** Check again on the Game link: the folders, the plugin and the creator, looked up afresh. */
export const refreshGameLink = () => Promise.all([loadGamePaths(), findCreator()])

/** Goes back to the folders found through Steam, one after the other (each reset rewrites the desktop settings). */
export const resetGamePaths = (kinds: ReadonlyArray<GamePathKind>) =>
  showGamePaths((platform) =>
    Effect.forEach(kinds, platform.resetGamePath).pipe(Effect.andThen(Effect.asSome(platform.gamePaths)))
  )

/**
 * Install / Update in Settings › Game: copies the app's editor-link plugin into the game's plugins folder. Only ever
 * run when the user asks. The plugin manager loads a plugin copied in by hand when the game starts, hence the restart.
 */
export const installPluginEffect = Effect.gen(function*() {
  const { status } = useEditor.getState().pluginStatus ?? {}
  const { plugin, restartGame } = yield* (yield* Platform).installPlugin
  useEditor.getState().setPluginStatus(plugin)
  yield* noteGameLink
  useEditor.getState().resolveNotifications(PLUGIN_MISSING)
  const done = status === "outdated"
    ? `Updated the editor's plugin to ${plugin.bundledVersion}`
    : "Installed the editor's plugin"
  useEditor.getState().notify("info", restartGame ? `${done}. Restart the game to use Play.` : done, {
    kind: "pluginInstalled"
  })
})

export const installPlugin = () => run(installPluginEffect)

/** Opens a web page in the browser (the desktop app's default browser). */
export const openExternalLink = (url: string) =>
  run(
    Effect.gen(function*() {
      yield* (yield* Platform).openExternal(url)
    })
  )

export const revealGamePath = (which: GamePathKind) =>
  run(
    Effect.gen(function*() {
      yield* (yield* Platform).revealGamePath(which)
    })
  )

/**
 * The open map's prefs, under its current name: the grid height when it isn't the player
 * start's (what a load would pick anyway), and Export on save when it is on.
 */
const saveMapPrefs = Effect.gen(function*() {
  const { doc, floorHeight, exportOnSave } = useEditor.getState()
  const prefs: MapPrefs = {
    ...(floorHeight !== floorHeightOf(doc.map) && { gridHeight: floorHeight }),
    ...(exportOnSave && { exportOnSave })
  }
  yield* MapPrefsStore.use((store) => store.save(mapPrefsKeyOf(doc.map), prefs))
})

/**
 * Changes the map's level fields (one undo step). Its prefs are saved again under its
 * (possibly new) name.
 */
export const setLevelData = (levelData: LevelData) => {
  useEditor.getState().setLevelData(levelData)
  return run(saveMapPrefs)
}

/** Moves the grid (and where pieces land); saved with the map's prefs, not in its history. */
export const setGridHeight = (gridHeight: number) => {
  useEditor.getState().setFloorHeight(gridHeight)
  return run(saveMapPrefs)
}

// --- notifications (docs/PROJECTS.md § Shell) ------------------------------------------------

/** Runs a notification's button. */
export const runNotificationCommand = (command: NotificationCommand): void => {
  switch (command._tag) {
    case "RevealProject":
      void revealProject()
      return
    case "RevealGamePath":
      void revealGamePath(command.which)
      return
    case "ChooseGamePath":
      void chooseGamePath(command.which)
      return
    case "OpenMap":
      openProjectMap(command.fileName)
      return
    case "OpenExternal":
      void openExternalLink(command.url)
      return
    case "InstallPlugin":
      void installPlugin()
  }
}

/** "Don't show again" on a notification: its kind is muted from now on, across restarts (desktop). */
export const muteNotificationKindEffect = (kind: string) =>
  Effect.gen(function*() {
    useEditor.getState().muteNotifications(yield* (yield* Platform).muteNotifications(kind))
  })

export const muteNotificationKind = (kind: string) => run(muteNotificationKindEffect(kind))

/** A notification's button, from its toast or the notification centre: it is read once acted on. */
export const runNotificationAction = (notice: NotificationRecord, action: NotificationAction) => {
  useEditor.getState().markNotificationsRead([notice.id])
  runNotificationCommand(action.command)
}

const toastNotification = (notice: NotificationRecord) => {
  const [first] = notice.actions
  const options = {
    ...(notice.body !== null && { description: notice.body }),
    ...(first !== undefined && {
      action: { label: first.label, onClick: () => runNotificationAction(notice, first) }
    })
  }
  if (notice.level === "error") toast.error(notice.title, options)
  else toast(notice.title, options)
}

/** When this run of the editor began: a notification from before it was kept from an earlier run, not news. */
const sessionStart = Date.now()

/**
 * Toasts each new notification (its first button on the toast) until the returned function is called: a React effect's
 * cleanup. The toast goes away by itself; the notification stays in the notification centre.
 */
export const showToasts = (): () => void => {
  const shown = new Set<string>()
  const showNew = (log: ReadonlyArray<NotificationRecord>) => {
    // oldest first, so the newest is on top
    for (const notice of log.toReversed()) {
      if (shown.has(notice.id) || Date.parse(notice.at) < sessionStart) continue
      shown.add(notice.id)
      toastNotification(notice)
    }
  }
  showNew(useEditor.getState().notifications)
  return useEditor.subscribe((state, previous) => {
    if (state.notifications !== previous.notifications) showNew(state.notifications)
  })
}

/**
 * Restores the notifications kept from earlier runs under this session's, then keeps the list after every change, one
 * write at a time (desktop: `notifications.json`; a browser forgets them). Runs until interrupted. A failed write is
 * only logged: reporting it would be another notification to write.
 */
export const keepNotifications = Effect.gen(function*() {
  const platform = yield* Platform
  const kept = yield* platform.loadNotifications
  const changes = Stream.callback<ReadonlyArray<NotificationRecord>>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const unsubscribe = useEditor.subscribe((state, previous) => {
          if (state.notifications !== previous.notifications) Queue.offerUnsafe(queue, state.notifications)
        })
        // the merged list is the first change written
        useEditor.getState().restoreNotifications(kept)
        return unsubscribe
      }),
      (unsubscribe) => Effect.sync(unsubscribe)
    )
  )
  yield* changes.pipe(
    Stream.runForEach((records) =>
      platform.saveNotifications(records).pipe(
        Effect.catch((error) => Effect.logWarning("Couldn't keep the notifications", error))
      )
    )
  )
})

/** Keeps the notifications (`keepNotifications`) until the returned function is called: a React effect's cleanup. */
export const followNotifications = () => runUntilCleanup(keepNotifications, "Couldn't read the kept notifications")
