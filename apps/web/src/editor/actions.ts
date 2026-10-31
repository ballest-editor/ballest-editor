/** UI-facing operations that run Effects through the single app runtime. */
import { Cause, Effect, Exit, Fiber, Option, Stream } from "effect"
import type { UeTransform, Vec3 } from "../domain/coords"
import { setLevelNames } from "../domain/edits"
import { copyNameOf, currentCreatedAt, mapFileNameOf, mapLabelOf, newMapFile } from "../domain/factory"
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
import { CatalogLoader } from "../services/CatalogLoader"
import { KeybindStore } from "../services/KeybindStore"
import { MapCodec } from "../services/MapCodec"
import { type ExportedMap, MapExporter } from "../services/MapExporter"
import { MapPrefsStore } from "../services/MapPrefsStore"
import { MaterialLibrary } from "../services/MaterialLibrary"
import {
  type GamePathKind,
  type GamePaths,
  Platform,
  type PlatformError,
  type ProjectMap,
  type ProjectState
} from "../services/Platform"
import { type AppServices, runtime } from "../services/runtime"
import { SettingsStore } from "../services/SettingsStore"
import {
  type Doc,
  type ImportClash,
  type NoticeAction,
  type OpenFile,
  pivotOf,
  type SlotPaint,
  useEditor
} from "./store"

const run = async <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A | undefined> => {
  const exit = await runtime.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  const error = Cause.squash(exit.cause)
  const message = typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error)
  useEditor.getState().notify("error", message)
  return undefined
}

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

/** What the platform offers, the project with its maps (desktop) and the creator name it finds, into the store. */
export const loadPlatform = () =>
  run(
    Effect.gen(function*() {
      useEditor.getState().setCapabilities((yield* Platform).capabilities)
      yield* refreshProject
      yield* findCreatorEffect
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

/** Follows the updater (`followUpdateState`) until the returned function is called: a React effect's cleanup. */
export const followUpdates = (): () => void => {
  const fiber = runtime.runFork(
    followUpdateState.pipe(Effect.catch((error) => Effect.logWarning("Stopped following the updater", error)))
  )
  return () => void runtime.runFork(Fiber.interrupt(fiber))
}

const updateStep = (step: "downloadUpdate" | "installUpdate") =>
  run(Effect.gen(function*() {
    yield* (yield* Platform)[step]
  }))

/** Starts downloading the release on offer; the pill follows its progress. */
export const downloadUpdate = () => updateStep("downloadUpdate")

/** Quits, installs the downloaded release and starts it; unsaved edits are lost. */
export const installUpdate = () => updateStep("installUpdate")

// --- maps, the project and exports (docs/PROJECTS.md) ---------------------------------------

/** The project in use, the recent ones and its maps into the store (desktop). */
const refreshProject = Effect.gen(function*() {
  const platform = yield* Platform
  if (!platform.capabilities.projects) return
  useEditor.getState().setProject(yield* platform.projectState, yield* platform.listMaps)
})

const fileOf = (map: ProjectMap): OpenFile => ({ name: map.fileName, path: map.path })

/** A toast's Reveal: the project's maps folder, or the game's. */
const revealIn = (where: "project" | "game"): NoticeAction => ({
  label: "Reveal",
  run: () => void (where === "project" ? revealProject() : revealGamePath("mapsFolder"))
})

const projectName = () => useEditor.getState().project?.current.name ?? "the project"

/** The open map encoded the way the game wants it written, with the document it was made from. */
const exportOpenMap = Effect.gen(function*() {
  const { doc } = useEditor.getState()
  const result = yield* (yield* MapExporter).prepare(doc.map)
  return { doc, result }
})

/** Puts a map into the editor, with the prefs saved for it. */
const showMap = Effect.fn("showMap")(function*(map: MapFile, file: OpenFile | null) {
  // unreadable prefs only cost the saved grid height and Export on save
  const prefs = yield* MapPrefsStore.use((store) => store.load(mapPrefsKeyOf(map))).pipe(
    Effect.orElseSucceed((): MapPrefs => ({}))
  )
  useEditor.getState().loadMap(map, file, prefs.gridHeight, { exportOnSave: prefs.exportOnSave === true })
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
  useEditor.getState().notify(
    "info",
    `Created ${mapLabelOf(created.fileName)} in ${projectName()}`,
    revealIn("project")
  )
})

export const newMap = (displayName: string, creatorName: string) => run(createNewMap(displayName, creatorName))

/** Opens one of the project's maps. */
export const openProjectMapFile = Effect.fn("openProjectMapFile")(function*(fileName: string) {
  const file = yield* (yield* Platform).readMap(fileName)
  const map = yield* MapCodec.use((codec) => codec.decode(file.text))
  yield* showMap(map, fileOf(file))
  useEditor.getState().notify("info", `Opened ${mapLabelOf(file.fileName)} (${map.items.length} items)`)
})

export const openProjectMap = (fileName: string) =>
  run(openProjectMapFile(fileName).pipe(Effect.ensuring(Effect.ignore(refreshProject))))

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
    revealIn("project")
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
    useEditor.getState().notify("info", `Opened ${name} (${map.items.length} items)`)
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

export const importMap = () => run(importMapFile)

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

/** Writes `result` (made from `doc`) into the project as a new map, which the editor then has open. */
const createAsOpenMap = Effect.fn("createAsOpenMap")(function*(doc: Doc, result: ExportedMap) {
  const created = yield* (yield* Platform).createMap({ fileName: result.filename, text: result.text })
  useEditor.getState().markSaved(doc, result.map, fileOf(created))
  yield* saveMapPrefs
  yield* refreshProject
  return created
})

/** A new project map from the open one (it had no file yet): the `saveAs` dialog's last step on desktop. */
const createFromOpenMap = Effect.gen(function*() {
  const { doc, result } = yield* exportOpenMap
  const created = yield* createAsOpenMap(doc, result)
  useEditor.getState().notify("info", `Saved ${mapLabelOf(created.fileName)} in ${projectName()}`, revealIn("project"))
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
    revealIn("project")
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
  useEditor.getState().notify("info", `Downloaded ${result.filename}`)
})

/**
 * Save: on desktop, writes the project file and asks nothing (a map that has no file yet is named first, in the
 * `saveAs` dialog). In a browser, downloads it, asking for the name first unless it is the file's.
 */
export const saveMapFile = Effect.gen(function*() {
  const platform = yield* Platform
  const { doc, file, openDialog } = useEditor.getState()
  if (platform.capabilities.projects) {
    if (file === null) openDialog("saveAs")
    else yield* writeOpenMap(file, { exportAfter: true })
    return
  }
  const { levelDisplayName, creatorName } = doc.map.worldSettings.levelData
  if (file?.name === mapFileNameOf(levelDisplayName.trim(), creatorName.trim())) yield* downloadOpenMap
  else openDialog("saveAs")
})

export const saveMap = () => run(saveMapFile)

/** The `saveAs` dialog's last step, once the name is confirmed: into the project (desktop) or a download (browser). */
export const saveMapAsEffect = Effect.gen(function*() {
  const platform = yield* Platform
  if (!platform.capabilities.projects) return yield* downloadOpenMap
  const { file } = useEditor.getState()
  yield* file === null ? createFromOpenMap : writeOpenMap(file, { exportAfter: true }).pipe(Effect.asVoid)
})

export const saveMapAs = () => run(saveMapAsEffect)

/** Rename: new name and creator, then the file moves to match (the old one goes to backups). */
export const renameOpenMap = (displayName: string, creatorName: string) => {
  useEditor.getState().renameLevel(displayName, creatorName)
  return saveMapAs()
}

/**
 * Duplicate: the open map, as it is now, saved into the project under a new name; editing goes on in the copy. The
 * original file keeps its last save.
 */
export const duplicateMapEffect = Effect.fn("duplicateMapEffect")(function*(displayName: string, creatorName: string) {
  const { doc, file } = useEditor.getState()
  const result = yield* (yield* MapExporter).prepare(setLevelNames(doc.map, displayName, creatorName))
  const created = yield* createAsOpenMap(doc, result)
  const from = file === null ? "" : ` from ${mapLabelOf(file.name)}`
  useEditor.getState().notify(
    "info",
    `Duplicated${from}: now editing ${mapLabelOf(created.fileName)}`,
    revealIn("project")
  )
})

export const duplicateMap = (displayName: string, creatorName: string) =>
  run(duplicateMapEffect(displayName, creatorName))

/** Copies a saved project map into the game's maps folder; a published map's draft there asks first. */
const exportProjectMap = Effect.fn("exportProjectMap")(function*(fileName: string, replacePublished: boolean) {
  const exported = yield* (yield* Platform).exportMap(fileName, { replacePublished })
  if (exported._tag === "Published") {
    useEditor.getState().setPublishedDraft({ name: exported.file.name, publishedFileId: exported.publishedFileId })
    return
  }
  yield* refreshProject
  useEditor.getState().notify(
    "info",
    `Exported ${mapLabelOf(fileName)} to the game's maps folder`,
    revealIn("game")
  )
})

/**
 * Export to game: writes the map into the game's UserSavedMaps folder under the game's file name, where the in-game
 * editor lists it. The export is a copy of the project file, so unsaved edits are saved first. A map with no file yet
 * is named first.
 */
export const exportToGameEffect = (replacePublished: boolean) =>
  Effect.gen(function*() {
    const { doc, file, dirty, openDialog } = useEditor.getState()
    if (file === null) {
      openDialog("saveAs")
      return
    }
    const { levelDisplayName, creatorName } = doc.map.worldSettings.levelData
    const current = dirty || file.name !== mapFileNameOf(levelDisplayName.trim(), creatorName.trim())
      ? (yield* writeOpenMap(file, { exportAfter: false })).fileName
      : file.name
    yield* exportProjectMap(current, replacePublished)
  })

export const exportToGame = () => run(exportToGameEffect(false))

/** The replacePublished dialog's answer: replace the published map's draft after all. */
export const replacePublishedDraft = () => {
  useEditor.getState().setPublishedDraft(null)
  return run(exportToGameEffect(true))
}

/** Export on save for the open map, kept with its prefs. */
export const setExportOnSave = (exportOnSave: boolean) => {
  useEditor.getState().setExportOnSave(exportOnSave)
  return run(saveMapPrefs)
}

/** Uses another project from now on. The open map stays open; it belonged to the old project, so it is unsaved here. */
const changeProject = (
  change: (platform: Platform["Service"]) => Effect.Effect<Option.Option<ProjectState>, PlatformError>
) =>
  run(
    Effect.gen(function*() {
      const before = useEditor.getState().project?.current.path
      const next = yield* change(yield* Platform)
      if (Option.isNone(next)) return
      if (next.value.current.path !== before) useEditor.getState().detachFile()
      yield* refreshProject
      useEditor.getState().notify("info", `Using the project ${next.value.current.name}`, revealIn("project"))
    })
  )

/** A folder dialog; the chosen folder becomes the project (the game's maps folder is refused, with the reason). */
export const chooseProject = () => changeProject((platform) => platform.chooseProject)

export const switchProject = (path: string) => changeProject((platform) => Effect.asSome(platform.switchProject(path)))

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
    useEditor.getState().notify("info", "Ballest of Them All is already running")
    return
  }
  yield* platform.launchGame
  useEditor.getState().notify("info", "Starting Ballest of Them All through Steam")
})

export const launchGame = () => run(launchGameEffect)

/** Looks the editor-link plugin up again: it depends on the game folders. */
const refreshPluginStatus = Effect.gen(function*() {
  useEditor.getState().setPluginStatus(yield* (yield* Platform).pluginStatus)
})

/** Runs a lookup that may return the game's folders (none: the user cancelled) and shows them, and the plugin. */
const showGamePaths = <E>(
  lookup: (platform: Platform["Service"]) => Effect.Effect<Option.Option<GamePaths>, E, AppServices>
) =>
  run(
    Effect.gen(function*() {
      const paths = yield* lookup(yield* Platform)
      if (Option.isNone(paths)) return
      useEditor.getState().setGamePaths(paths.value)
      yield* refreshPluginStatus
    })
  )

/** Looks the game's folders up again, for Settings › Game. */
export const loadGamePaths = () => showGamePaths((platform) => Effect.asSome(platform.gamePaths))

/** A folder dialog; the chosen folder replaces the one found for `which`. */
export const chooseGamePath = (which: GamePathKind) => showGamePaths((platform) => platform.chooseGamePath(which))

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
  const done = status === "outdated"
    ? `Updated the editor's plugin to ${plugin.bundledVersion}`
    : "Installed the editor's plugin"
  useEditor.getState().notify("info", restartGame ? `${done}. Restart the game to use Play.` : done)
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
