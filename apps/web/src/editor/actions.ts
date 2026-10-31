/** UI-facing operations that run Effects through the single app runtime. */
import { Cause, Effect, Exit, Fiber, Option, Stream } from "effect"
import type { UeTransform, Vec3 } from "../domain/coords"
import { currentCreatedAt, mapFileNameOf, newMapFile } from "../domain/factory"
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
import { type LevelData, PLAYER_START_CLASS } from "../domain/MapFile"
import { type MapPrefs, mapPrefsKeyOf } from "../domain/MapPrefs"
import { localToWorld, type PivotChoice, pivotFor } from "../domain/pivot"
import type { Settings } from "../domain/Settings"
import { CatalogLoader } from "../services/CatalogLoader"
import { KeybindStore } from "../services/KeybindStore"
import { MapCodec } from "../services/MapCodec"
import { MapExporter } from "../services/MapExporter"
import { MapPrefsStore } from "../services/MapPrefsStore"
import { MaterialLibrary } from "../services/MaterialLibrary"
import { type OpenedMap, Platform } from "../services/Platform"
import { type AppServices, runtime } from "../services/runtime"
import { SettingsStore } from "../services/SettingsStore"
import { pivotOf, type SlotPaint, useEditor } from "./store"

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

export const newMap = (displayName: string, creatorName: string) =>
  run(
    Effect.gen(function*() {
      const createdAt = yield* currentCreatedAt
      const catalog = useEditor.getState().catalog?.catalog
      const playerStartPiece = catalog?.pieces.find((p) => p.classPath === PLAYER_START_CLASS)
      useEditor.getState().loadMap(newMapFile({ displayName, creatorName, createdAt, playerStartPiece }), null)
    })
  )

/** The resolved theme to the desktop window's controls; cosmetic, so a failure is only logged. */
export const setWindowTheme = (dark: boolean) =>
  run(
    Effect.gen(function*() {
      yield* (yield* Platform).setWindowTheme(dark)
    }).pipe(Effect.catch((error) => Effect.logWarning("Couldn't recolour the window controls", error)))
  )

/** What the platform offers, and its recent files, into the store. */
export const loadPlatform = () =>
  run(
    Effect.gen(function*() {
      useEditor.getState().setCapabilities((yield* Platform).capabilities)
      yield* refreshRecentFiles
    })
  )

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

const refreshRecentFiles = Effect.gen(function*() {
  const platform = yield* Platform
  if (!platform.capabilities.filePaths) return
  useEditor.getState().setRecentFiles(yield* platform.recentMaps)
})

const loadOpened = Effect.fn("loadOpened")(function*(opened: OpenedMap) {
  const map = yield* MapCodec.use((codec) => codec.decode(opened.text))
  // unreadable prefs only cost the saved grid height
  const prefs = yield* MapPrefsStore.use((store) => store.load(mapPrefsKeyOf(map))).pipe(
    Effect.orElseSucceed((): MapPrefs => ({}))
  )
  useEditor.getState().loadMap(map, { name: opened.name, path: Option.getOrNull(opened.path) }, prefs.gridHeight)
  useEditor.getState().notify("info", `Opened ${opened.name} (${map.items.length} items)`)
})

/** Asks for a map file (the open dialog, or the browser's file picker) and opens it. */
export const openMapFile = Effect.gen(function*() {
  const opened = yield* Platform.use((platform) => platform.openMap)
  if (Option.isNone(opened)) return
  yield* loadOpened(opened.value).pipe(Effect.ensuring(Effect.ignore(refreshRecentFiles)))
})

/** Opens one of the recent files; one that has gone drops off the list. */
export const openRecentFile = (path: string) =>
  Effect.gen(function*() {
    yield* loadOpened(yield* (yield* Platform).openRecent(path))
  }).pipe(Effect.ensuring(Effect.ignore(refreshRecentFiles)))

/**
 * Saves the open map. Save as asks where (desktop) or downloads (browser); Save writes over the open file, unless the
 * map has been renamed since (the game only loads a file named after the map inside it) or it isn't a `.balledit`.
 * Then it asks too, starting in the open file's folder.
 */
export const saveMapFile = (mode: "save" | "saveAs") =>
  Effect.gen(function*() {
    const platform = yield* Platform
    const { doc, file } = useEditor.getState()
    const result = yield* MapExporter.use((exporter) => exporter.prepare(doc.map))
    const overwrite = mode === "save" && file?.name === result.filename
    const saved = yield* platform.saveMap(
      { name: result.filename, text: result.text },
      { path: Option.fromNullOr(overwrite ? file.path : null), near: Option.fromNullOr(file?.path ?? null) }
    )
    if (Option.isNone(saved)) return
    const { name, path } = saved.value
    useEditor.getState().markSaved(doc, result.map, { name, path: Option.getOrNull(path) })
    useEditor.getState().notify("info", `${platform.capabilities.filePaths ? "Saved" : "Downloaded"} ${name}`)
    // the save may have renamed the map: its prefs follow it to the new name
    yield* saveMapPrefs
    yield* refreshRecentFiles
  })

export const openMap = () => run(openMapFile)

export const openRecent = (path: string) => run(openRecentFile(path))

/**
 * Save: writes over the open file when it is named after the map; otherwise opens the Save as dialog, which confirms
 * the map's name first.
 */
export const saveMap = () => {
  const { doc, file, openDialog } = useEditor.getState()
  const { levelDisplayName, creatorName } = doc.map.worldSettings.levelData
  if (file?.name !== mapFileNameOf(levelDisplayName.trim(), creatorName.trim())) {
    openDialog("saveAs")
    return Promise.resolve(undefined)
  }
  return run(saveMapFile("save"))
}

/** The Save as dialog's last step, once the name is confirmed. */
export const saveMapAs = () => run(saveMapFile("saveAs"))

/**
 * The open map's prefs, under its current name: the grid height when it isn't the player
 * start's (what a load would pick anyway).
 */
const saveMapPrefs = Effect.gen(function*() {
  const { doc, floorHeight } = useEditor.getState()
  const prefs = floorHeight === floorHeightOf(doc.map) ? {} : { gridHeight: floorHeight }
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
