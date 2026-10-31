/**
 * Editor document + UI state. The document is a MapFile (schema-typed) plus a parallel
 * array of stable ids for React keys and selection. All edits go through domain/edits.
 */
import type { UpdateState } from "@ballest/contracts"
import { type Effect, Option } from "effect"
import { toast } from "sonner"
import { create } from "zustand"
import { type CatalogIndex, type CatalogPiece, indexCatalog } from "../domain/Catalog"
import type { UeTransform, Vec3 } from "../domain/coords"
import { type Creator, creatorOf, type FoundCreator } from "../domain/creator"
import {
  addItem,
  type Clip,
  copyItems,
  pasteItems,
  removeItems,
  setLevelData,
  setLevelNames,
  setLighting,
  setPivots,
  setProperties,
  setSlotMaterials,
  setTransforms,
  type SlotMaterial,
  validateItem
} from "../domain/edits"
import { itemFromPiece, newMapFile } from "../domain/factory"
import { type DerivedKeybinds, deriveKeybinds } from "../domain/GameKeybinds"
import type { PropertyChange } from "../domain/itemProperties"
import type { Keybinds } from "../domain/Keybinds"
import { floorHeightOf } from "../domain/level"
import { LIMITS } from "../domain/limits"
import { isPlayerStart, type ItemTransform, type LevelData, type MapFile } from "../domain/MapFile"
import type { MaterialTable } from "../domain/Materials"
import type { PaintPicker } from "../domain/Paint"
import { type Pivot, pivotAt } from "../domain/pivot"
import { defaultSettings, type Settings } from "../domain/Settings"
import { type Lighting, lightingOf } from "../domain/sunlight"
import type { LoadedCatalog } from "../services/CatalogLoader"
import type { GamePaths, PlatformCapabilities, PluginStatus, ProjectMap, ProjectState } from "../services/Platform"

import type { GizmoSpace } from "./gizmo/handles"

/** The game folder types, for components (which reach services only through editor/). */
export type { GamePath, GamePathKind, GamePaths, PluginStatus } from "../services/Platform"
export interface Doc {
  readonly map: MapFile
  readonly ids: ReadonlyArray<string>
}

/**
 * The selected item ids: a set kept in selection order, without duplicates. The last one
 * is the active item (the gizmo's local axes follow it).
 */
export type Selection = ReadonlyArray<string>

/** How a click changes the selection: plain click, add-to-selection, or toggle. */
export type SelectMode = "replace" | "add" | "toggle"

/**
 * One undo/redo step, seen from the side it restores: the document and the selection that
 * went with it, plus the selection on the other side of the step. Undoing a delete selects
 * the restored items; redoing it leaves what the delete left. A `selectionOnly` step (the
 * "Undo selection changes" setting) restores just the selection and leaves the doc alone.
 */
export interface Snapshot {
  readonly doc: Doc
  readonly selectedIds: Selection
  readonly otherSelectedIds: Selection
  readonly selectionOnly: boolean
}

/** A material slot edit on the item with this id (see `SlotMaterial`). */
export type SlotPaint = Omit<SlotMaterial, "index"> & { readonly id: string }

export type Tool = "select" | "translate" | "rotate" | "scale"
/**
 * `saveAs` names a map that has no file yet before it goes into the project (desktop), or before it is downloaded
 * (browser: Export). `rename` and `duplicate` are the Map menu's (desktop).
 */
export type Dialog =
  | "new"
  | "saveAs"
  | "rename"
  | "duplicate"
  | "settings"
  | "mapSettings"
  | "replacePublished"
  | "importClash"
export type SettingsCategory = "general" | "editor" | "camera" | "keybinds" | "appearance" | "lighting" | "game"

const HISTORY_LIMIT = 200
const SPEED_STEPS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16]

/**
 * The file the open map was read from or last saved to. On desktop it is the map's file in the project (`name` is its
 * file name there, which Save writes); a browser never sees a path.
 */
export interface OpenFile {
  readonly name: string
  readonly path: string | null
}

/** A file in the game's maps folder that is the draft of a published map (`levelPublishedFileId` > 0). */
export interface PublishedDraft {
  readonly name: string
  readonly publishedFileId: number
}

/** An import whose file name the project already has: the clash dialog asks to replace that map or import a copy. */
export interface ImportClash {
  /** The picked file. */
  readonly source: string
  readonly fileName: string
  /** What would be written under `fileName`, and the map it decodes to (a copy is renamed from it). */
  readonly text: string
  readonly map: MapFile
}

/** Something a notification offers to do (a toast's button), like showing the folder a file went to. */
export interface NoticeAction {
  readonly label: string
  readonly run: () => void
}

let nextId = 0
const freshId = () => `item-${++nextId}`
const freshIds = (n: number) => Array.from({ length: n }, freshId)
const docOf = (map: MapFile): Doc => ({ map, ids: freshIds(map.items.length) })

export const initialMap = () => newMapFile({ displayName: "Untitled", creatorName: "", createdAt: "" })

export interface EditorState {
  readonly doc: Doc
  /**
   * The height (UE cm) the grid is drawn at and palette pieces land on: by default the player
   * start's, taken when the map loads so it stays put while the start is moved. Project settings
   * can change it (kept per map in MapPrefsStore, not in the file or its history).
   */
  readonly floorHeight: number
  /** Undo stack, oldest first (at most HISTORY_LIMIT entries). */
  readonly past: ReadonlyArray<Snapshot>
  /** Redo stack, next first; cleared by any new edit. */
  readonly future: ReadonlyArray<Snapshot>
  /** Edited since it was opened or last saved. */
  readonly dirty: boolean
  /** Null for a map that was never opened or saved. */
  readonly file: OpenFile | null
  /** The project in use and the recent ones (desktop; null until the startup load, and in a browser). */
  readonly project: ProjectState | null
  /** The project's maps, most recently changed first (desktop). */
  readonly projectMaps: ReadonlyArray<ProjectMap>
  /** The open map's "Export on save" (desktop, off by default; kept with the map's prefs). */
  readonly exportOnSave: boolean
  /** An import waiting on the clash dialog. */
  readonly importClash: ImportClash | null
  /** What the platform (browser or desktop app) offers; the browser's until the startup load says otherwise. */
  readonly capabilities: PlatformCapabilities
  /** The game's folders as last looked up (desktop; null until Settings › Game asks). */
  readonly gamePaths: GamePaths | null
  /** The creator name found on this machine (desktop: the Steam persona name), as last looked up; none until then. */
  readonly foundCreator: Option.Option<FoundCreator>
  /** The editor-link plugin, as last looked up (desktop; null until Settings › Game asks). */
  readonly pluginStatus: PluginStatus | null
  /** Export found a published map's draft under the map's file name; the replacePublished dialog asks. */
  readonly publishedDraft: PublishedDraft | null
  /** The desktop updater's state, once main has sent it; null in a browser. */
  readonly update: UpdateState | null
  readonly selectedIds: Selection
  readonly tool: Tool
  /** Whether the gizmo follows the selected item's axes or the world's. */
  readonly gizmoSpace: GizmoSpace
  /** The open modal dialog; editor keybinds are suspended while one is open. */
  readonly dialog: Dialog | null
  /**
   * What the unsaved-changes prompt's Save goes on to do (close, start a new map...) when the map had to be named
   * first: runs once the `saveAs` dialog has saved it, and is dropped when that dialog is cancelled or another opens.
   */
  readonly afterSave: Effect.Effect<void, unknown> | null
  readonly settingsCategory: SettingsCategory
  /** The keybind cheat sheet: shown while its binding is held. */
  readonly cheatSheet: boolean
  readonly catalog: LoadedCatalog | null
  /** Lookups over `catalog`, built once per catalog load. */
  readonly catalogIndex: CatalogIndex | null
  /** True until the startup loads (catalog, materials, settings) have finished, successfully or not. */
  readonly booting: boolean
  /** Approximate game materials; null until loaded (everything renders neutral meanwhile). */
  readonly materialTable: MaterialTable | null
  /** The game's material picker (finishes x colours); empty until loaded. */
  readonly paint: PaintPicker
  readonly keybinds: Keybinds
  readonly settings: Settings
  /** The game's defaults (and which actions fell back to editor defaults). */
  readonly keybindDefaults: DerivedKeybinds
  readonly missingGlbs: ReadonlySet<string>
  /**
   * The last copied items (Ctrl+C), as they were when copied. Not part of the document or
   * its history, so it survives undo and loading another map.
   */
  readonly clipboard: Clip | null
  /**
   * Live transforms of the items under a continuous interaction (gizmo drag, number-field
   * scrub), by id. Not in the document until the interaction commits, as one undo step;
   * undo and redo wait while it (or lightingPreview) is set.
   */
  readonly preview: ReadonlyMap<string, UeTransform> | null
  /** Live sun settings while a lighting slider or field is dragged; committed on release. */
  readonly lightingPreview: Lighting | null
  /** Multiplier on the fly speed, changed by speedFaster/speedSlower. */
  readonly cameraSpeed: number
  /** Bumped to ask the camera to frame the selection / the whole map. */
  readonly focusRequest: number
  readonly frameAllRequest: number

  /** Replaces the document; `floorHeight` defaults to the map's player start height. */
  readonly loadMap: (
    map: MapFile,
    file: OpenFile | null,
    floorHeight?: number,
    options?: { readonly exportOnSave?: boolean }
  ) => void
  /**
   * The map was saved as `map` (the export-time level fields applied to `from`) into `file`. When the document is
   * still `from`, `map` replaces it without an undo step and the document is clean; when it was edited meanwhile, only
   * the file is remembered.
   */
  readonly markSaved: (from: Doc, map: MapFile, file: OpenFile) => void
  readonly setProject: (project: ProjectState, maps: ReadonlyArray<ProjectMap>) => void
  /**
   * The open map no longer has a file: it stays open with its edits as unsaved, and the next Save names it into the
   * project in use (after switching to another project).
   */
  readonly detachFile: () => void
  readonly setExportOnSave: (exportOnSave: boolean) => void
  /** Asks how to import a file whose name the project has (null forgets it). */
  readonly setImportClash: (clash: ImportClash | null) => void
  readonly setCapabilities: (capabilities: PlatformCapabilities) => void
  readonly setGamePaths: (gamePaths: GamePaths) => void
  readonly setFoundCreator: (foundCreator: Option.Option<FoundCreator>) => void
  readonly setPluginStatus: (pluginStatus: PluginStatus) => void
  /** Asks whether to replace a published map's draft in the maps folder (null forgets it). */
  readonly setPublishedDraft: (draft: PublishedDraft | null) => void
  readonly setUpdate: (update: UpdateState) => void
  readonly placePiece: (piece: CatalogPiece, transform: ItemTransform) => void
  /**
   * Replaces the transforms of several items as one undo step; false (with a notice, and
   * nothing changed) when the game would reject any of them.
   */
  readonly transformItems: (transforms: ReadonlyMap<string, UeTransform>) => boolean
  /**
   * Sets material slots on several items as one undo step (none when nothing changes); false
   * (with a notice, and nothing changed) when an item or mesh component doesn't exist.
   */
  readonly paintSlots: (edits: ReadonlyArray<SlotPaint>) => boolean
  /**
   * Sets properties on every selected item as one undo step (a colour's three channels are
   * one edit); false (with a notice, and nothing changed) when a value doesn't fit its property.
   */
  readonly setSelectionProperties: (changes: ReadonlyArray<PropertyChange>) => boolean
  /** Sets the pivots of several items as one undo step (nothing when none changes). */
  readonly setItemPivots: (pivots: ReadonlyMap<string, Pivot>) => void
  readonly deleteSelection: () => void
  /** Copies the selected items in place (one undo step) and selects the copies. */
  readonly duplicateSelection: () => void
  /** Puts the selected items on the clipboard; the document is unchanged. */
  readonly copySelection: () => void
  /** Puts the selected items on the clipboard and removes them (one undo step). */
  readonly cutSelection: () => void
  /**
   * Adds the clipboard's items where they were copied, like the game (one undo step), and
   * selects them.
   */
  readonly paste: () => void
  /**
   * Starts an Alt+drag duplicate: copies the selection in place and selects the copies, with
   * no undo step yet. Returns each source id's copy id, or undefined when nothing was copied.
   */
  readonly beginDuplicateDrag: () => ReadonlyMap<string, string> | undefined
  /**
   * Ends an Alt+drag duplicate. With transforms (by copy id), the copy and the move commit
   * as one undo step; with null (a cancelled drag), or when the game would reject a
   * transform (false), the copies are removed and the selection restored.
   */
  readonly endDuplicateDrag: (transforms: ReadonlyMap<string, UeTransform> | null) => boolean
  readonly renameLevel: (displayName: string, creatorName: string) => void
  /** Sets the sun (time of day, brightness, yaw) as one undo step; non-finite values are ignored. */
  readonly setLighting: (lighting: Lighting) => void
  /** Replaces `worldSettings.levelData` as one undo step (none when nothing changes). */
  readonly setLevelData: (levelData: LevelData) => void
  readonly setFloorHeight: (floorHeight: number) => void
  /** Restores the previous snapshot, including its selection. */
  readonly undo: () => void
  readonly redo: () => void
  /** Changes the selection; its own undo step when settings.editor.undoSelection is on. */
  readonly select: (ids: Selection) => void
  readonly setTool: (tool: Tool) => void
  readonly toggleGizmoSpace: () => void
  readonly openDialog: (dialog: Dialog, category?: SettingsCategory) => void
  readonly closeDialog: () => void
  /** Opens the `saveAs` dialog to name the map, with what to do once it is saved. */
  readonly nameThen: (afterSave: Effect.Effect<void, unknown>) => void
  /** `afterSave`, cleared: the `saveAs` dialog takes it before saving. */
  readonly takeAfterSave: () => Effect.Effect<void, unknown> | null
  readonly setCheatSheet: (cheatSheet: boolean) => void
  readonly setSettingsCategory: (category: SettingsCategory) => void
  readonly setPreview: (preview: EditorState["preview"]) => void
  readonly setLightingPreview: (lighting: Lighting | null) => void
  readonly setCatalog: (catalog: LoadedCatalog) => void
  readonly finishBoot: () => void
  readonly setMaterials: (table: MaterialTable, paint: PaintPicker) => void
  readonly setKeybinds: (keybinds: Keybinds, defaults?: DerivedKeybinds) => void
  readonly setSettings: (settings: Settings) => void
  readonly reportMissingGlb: (url: string) => void
  readonly notify: (kind: "info" | "error", text: string, action?: NoticeAction) => void
  readonly changeSpeed: (direction: 1 | -1) => void
  readonly requestFocus: () => void
  readonly requestFrameAll: () => void
}

export const useEditor = create<EditorState>()((set, get) => {
  /**
   * Push `before` (by default the current doc and selection) onto the undo stack and replace
   * the doc; clears the redo stack.
   */
  const commit = (doc: Doc, extra: Partial<EditorState> = {}, before?: DocState) =>
    set((s) => ({
      ...extra,
      doc,
      past: [...s.past, {
        doc: before?.doc ?? s.doc,
        selectedIds: before?.selectedIds ?? s.selectedIds,
        otherSelectedIds: extra.selectedIds ?? s.selectedIds,
        selectionOnly: false
      }].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true
    }))

  /**
   * Document indices of the selected items that can be copied, in selection order. A map has
   * exactly one player start (every sample does); copying it would make a second, so it is
   * left out, with a notice.
   */
  const copyableIndices = (s: EditorState): Array<number> => {
    const all = selectedIndices(s)
    const indices = all.filter((i) => {
      const item = s.doc.map.items[i]
      return item !== undefined && !isPlayerStart(item)
    })
    if (indices.length < all.length) s.notify("info", "The player start isn't copied: a map has only one.")
    return indices
  }

  /** The doc with the clip's items added and their fresh ids; undefined (with a notice) when there's no room. */
  const withClip = (s: EditorState, clip: Clip): (Doc & { readonly added: ReadonlyArray<string> }) | undefined => {
    if (clip.items.length === 0) return undefined
    if (s.doc.map.items.length + clip.items.length > LIMITS.itemsPerLevel) {
      s.notify("error", `The game allows at most ${LIMITS.itemsPerLevel.toLocaleString()} items in a map.`)
      return undefined
    }
    const added = freshIds(clip.items.length)
    return { map: pasteItems(s.doc.map, clip), ids: [...s.doc.ids, ...added], added }
  }

  /** Where an Alt+drag duplicate started, while one is in progress. */
  let duplicateDragBase: DocState | null = null

  /** Swaps in a history snapshot; its selection is restored for the items that still exist. */
  const restore = (s: EditorState, snapshot: Snapshot) => {
    const doc = snapshot.selectionOnly ? s.doc : snapshot.doc
    const existing = new Set(doc.ids)
    return {
      doc,
      dirty: snapshot.selectionOnly ? s.dirty : true,
      selectedIds: snapshot.selectedIds.filter((id) => existing.has(id)),
      // the side being left, for the opposite stack
      current: {
        doc: s.doc,
        selectedIds: snapshot.otherSelectedIds,
        otherSelectedIds: snapshot.selectedIds,
        selectionOnly: snapshot.selectionOnly
      }
    }
  }

  const fallbackDefaults = deriveKeybinds(undefined)

  const startingMap = initialMap()

  return {
    doc: docOf(startingMap),
    floorHeight: floorHeightOf(startingMap),
    past: [],
    future: [],
    dirty: false,
    file: null,
    project: null,
    projectMaps: [],
    exportOnSave: false,
    importClash: null,
    capabilities: { projects: false, exportToGame: false, launchGame: false, play: false, updates: false },
    gamePaths: null,
    foundCreator: Option.none(),
    pluginStatus: null,
    publishedDraft: null,
    update: null,
    selectedIds: [],
    tool: "translate",
    gizmoSpace: "world",
    dialog: null,
    afterSave: null,
    settingsCategory: "general",
    cheatSheet: false,
    catalog: null,
    catalogIndex: null,
    booting: true,
    materialTable: null,
    paint: [],
    keybinds: fallbackDefaults.keybinds,
    settings: defaultSettings,
    keybindDefaults: fallbackDefaults,
    missingGlbs: new Set(),
    clipboard: null,
    preview: null,
    lightingPreview: null,
    cameraSpeed: 1,
    focusRequest: 0,
    frameAllRequest: 0,

    loadMap: (map, file, floorHeight, options) =>
      set((s) => ({
        doc: docOf(map),
        floorHeight: floorHeight ?? floorHeightOf(map),
        past: [],
        future: [],
        dirty: false,
        file,
        exportOnSave: options?.exportOnSave ?? false,
        selectedIds: [],
        frameAllRequest: s.frameAllRequest + 1
      })),

    markSaved: (from, map, file) =>
      set((s) => s.doc === from ? { doc: { ...s.doc, map }, dirty: false, file } : { file }),
    setProject: (project, projectMaps) => set({ project, projectMaps }),
    detachFile: () => set((s) => s.file === null ? s : { file: null, dirty: true }),
    setExportOnSave: (exportOnSave) => set({ exportOnSave }),
    setImportClash: (importClash) => set({ importClash, dialog: importClash === null ? null : "importClash" }),
    setCapabilities: (capabilities) => set({ capabilities }),
    setGamePaths: (gamePaths) => set({ gamePaths }),
    setFoundCreator: (foundCreator) => set({ foundCreator }),
    setPluginStatus: (pluginStatus) => set({ pluginStatus }),
    setPublishedDraft: (publishedDraft) =>
      set({ publishedDraft, dialog: publishedDraft === null ? null : "replacePublished" }),
    setUpdate: (update) => set({ update }),

    placePiece: (piece, transform) => {
      const item = validateItem(itemFromPiece(piece, transform))
      if (Option.isNone(item)) {
        get().notify("error", `Catalog entry ${piece.className} doesn't produce a valid item.`)
        return
      }
      const { doc } = get()
      const id = freshId()
      commit({ map: addItem(doc.map, item.value), ids: [...doc.ids, id] }, { selectedIds: [id] })
    },

    transformItems: (transforms) => {
      const { doc } = get()
      const entries = [...transforms].map(([id, t]) => [doc.ids.indexOf(id), t] as const)
      const next = setTransforms(doc.map, entries)
      if (Option.isSome(next)) {
        // a drag that ends where it started leaves no step
        if (!entries.every(([index]) => sameItemTransform(doc.map, next.value, index))) {
          commit({ map: next.value, ids: doc.ids })
        }
        return true
      }
      get().notify("error", INVALID_TRANSFORM)
      return false
    },

    paintSlots: (edits) => {
      const { doc } = get()
      const next = setSlotMaterials(doc.map, edits.map(({ id, ...edit }) => ({ ...edit, index: doc.ids.indexOf(id) })))
      if (Option.isNone(next)) {
        get().notify("error", "Those items no longer have that material slot.")
        return false
      }
      if (next.value !== doc.map) commit({ map: next.value, ids: doc.ids })
      return true
    },

    setSelectionProperties: (changes) => {
      const s = get()
      const indices = selectedIndices(s)
      const next = setProperties(s.doc.map, indices, changes)
      if (Option.isNone(next)) {
        const names = changes.map((c) => `${JSON.stringify(c.value)} for ${c.property.name}`).join(", ")
        s.notify("error", `Not a valid value: ${names}.`)
        return false
      }
      const unchanged = indices.every((i) =>
        changes.every(({ property, value }) =>
          s.doc.map.items[i]?.[property.list].some((p) => p.propertyName === property.name && p.currentValue === value)
        )
      )
      if (!unchanged) commit({ map: next.value, ids: s.doc.ids })
      return true
    },

    setItemPivots: (pivots) => {
      const { doc } = get()
      const entries = [...pivots].flatMap(([id, pivot]) => {
        const index = doc.ids.indexOf(id)
        return index < 0 || samePivot(pivotAt(doc.map, index), pivot) ? [] : [[index, pivot] as const]
      })
      if (entries.length > 0) commit({ map: setPivots(doc.map, entries), ids: doc.ids })
    },

    deleteSelection: () => {
      const s = get()
      const indices = selectedIndices(s)
      if (indices.length === 0) return
      commit(withoutItems(s.doc, indices), { selectedIds: [] })
    },

    duplicateSelection: () => {
      const s = get()
      const next = withClip(s, copyItems(s.doc.map, copyableIndices(s)))
      if (next !== undefined) commit(next, { selectedIds: next.added })
    },

    copySelection: () => {
      const s = get()
      const clip = copyItems(s.doc.map, copyableIndices(s))
      if (clip.items.length > 0) set({ clipboard: clip })
    },

    cutSelection: () => {
      const s = get()
      // only what was copied goes: cutting never removes the player start
      const indices = copyableIndices(s)
      if (indices.length === 0) return
      commit(withoutItems(s.doc, indices), { selectedIds: [], clipboard: copyItems(s.doc.map, indices) })
    },

    paste: () => {
      const s = get()
      const next = s.clipboard === null ? undefined : withClip(s, s.clipboard)
      if (next !== undefined) commit(next, { selectedIds: next.added })
    },

    beginDuplicateDrag: () => {
      const s = get()
      if (duplicateDragBase !== null) return undefined
      const indices = copyableIndices(s)
      const next = withClip(s, copyItems(s.doc.map, indices))
      if (next === undefined) return undefined
      duplicateDragBase = { doc: s.doc, selectedIds: s.selectedIds }
      set({ doc: next, selectedIds: next.added })
      // every index is in range, so copyItems keeps them all and the copies line up with them
      return new Map(indices.flatMap((index, n) => {
        const id = s.doc.ids[index]
        const copy = next.added[n]
        return id === undefined || copy === undefined ? [] : [[id, copy] as const]
      }))
    },

    endDuplicateDrag: (transforms) => {
      const before = duplicateDragBase
      duplicateDragBase = null
      if (before === null) return false
      const { doc } = get()
      const next = transforms === null
        ? Option.none()
        : setTransforms(doc.map, [...transforms].map(([id, t]) => [doc.ids.indexOf(id), t] as const))
      if (Option.isNone(next)) {
        set({ doc: before.doc, selectedIds: before.selectedIds })
        if (transforms !== null) get().notify("error", INVALID_TRANSFORM)
        return false
      }
      commit({ map: next.value, ids: doc.ids }, {}, before)
      return true
    },

    renameLevel: (displayName, creatorName) => {
      const { doc } = get()
      const { levelDisplayName, creatorName: currentCreator } = doc.map.worldSettings.levelData
      if (displayName === levelDisplayName && creatorName === currentCreator) return
      commit({ map: setLevelNames(doc.map, displayName, creatorName), ids: doc.ids })
    },

    setLighting: (lighting) => {
      const { doc } = get()
      const next = setLighting(doc.map, lighting)
      if (Option.isNone(next) || sameLighting(lightingOf(doc.map.worldSettings), lighting)) return
      commit({ map: next.value, ids: doc.ids })
    },

    setLevelData: (levelData) => {
      const { doc } = get()
      if (JSON.stringify(levelData) === JSON.stringify(doc.map.worldSettings.levelData)) return
      commit({ map: setLevelData(doc.map, levelData), ids: doc.ids })
    },

    setFloorHeight: (floorHeight) => set({ floorHeight }),

    undo: () =>
      set((s) => {
        const prev = s.past.at(-1)
        if (prev === undefined || interacting(s)) return s
        const { current, ...next } = restore(s, prev)
        return { ...next, past: s.past.slice(0, -1), future: [current, ...s.future] }
      }),

    redo: () =>
      set((s) => {
        const following = s.future[0]
        if (following === undefined || interacting(s)) return s
        const { current, ...next } = restore(s, following)
        return { ...next, past: [...s.past, current].slice(-HISTORY_LIMIT), future: s.future.slice(1) }
      }),

    select: (ids) =>
      set((s) => {
        const selectedIds = [...new Set(ids)]
        if (sameSelection(selectedIds, s.selectedIds)) return s
        if (!s.settings.editor.undoSelection) return { selectedIds }
        const step: Snapshot = {
          doc: s.doc,
          selectedIds: s.selectedIds,
          otherSelectedIds: selectedIds,
          selectionOnly: true
        }
        return { selectedIds, past: [...s.past, step].slice(-HISTORY_LIMIT), future: [] }
      }),
    setTool: (tool) => set({ tool }),
    toggleGizmoSpace: () => set((s) => ({ gizmoSpace: s.gizmoSpace === "world" ? "local" : "world" })),
    openDialog: (dialog, category) =>
      set((s) => ({
        dialog,
        settingsCategory: category ?? s.settingsCategory,
        afterSave: dialog === "saveAs" ? s.afterSave : null
      })),
    // The saveAs dialog closes itself before it saves, so this keeps `afterSave`; its Cancel drops it.
    closeDialog: () => set({ dialog: null }),
    nameThen: (afterSave) => set({ dialog: "saveAs", afterSave }),
    takeAfterSave: () => {
      const { afterSave } = get()
      set({ afterSave: null })
      return afterSave
    },
    setCheatSheet: (cheatSheet) => set({ cheatSheet }),
    setSettingsCategory: (settingsCategory) => set({ settingsCategory }),
    setPreview: (preview) => set({ preview }),
    setLightingPreview: (lightingPreview) => set({ lightingPreview }),
    setCatalog: (catalog) => set({ catalog, catalogIndex: indexCatalog(catalog.catalog) }),
    finishBoot: () => set({ booting: false }),
    setMaterials: (materialTable, paint) => set({ materialTable, paint }),
    setSettings: (settings) => set({ settings }),
    setKeybinds: (keybinds, defaults) => set((s) => ({ keybinds, keybindDefaults: defaults ?? s.keybindDefaults })),
    reportMissingGlb: (url) =>
      set((s) => (s.missingGlbs.has(url) ? s : { missingGlbs: new Set([...s.missingGlbs, url]) })),
    notify: (kind, text, action) => {
      const options = action === undefined ? {} : { action: { label: action.label, onClick: action.run } }
      if (kind === "error") toast.error(text, options)
      else toast(text, options)
    },
    changeSpeed: (direction) =>
      set((s) => {
        const i = SPEED_STEPS.indexOf(s.cameraSpeed)
        const next = SPEED_STEPS[Math.min(SPEED_STEPS.length - 1, Math.max(0, (i < 0 ? 3 : i) + direction))]
        return { cameraSpeed: next ?? s.cameraSpeed }
      }),
    requestFocus: () => set((s) => ({ focusRequest: s.focusRequest + 1 })),
    requestFrameAll: () => set((s) => ({ frameAllRequest: s.frameAllRequest + 1 }))
  }
})

/** A document and the selection that goes with it. */
interface DocState {
  readonly doc: Doc
  readonly selectedIds: Selection
}

/** The doc without the items at `indices`. */
const withoutItems = (doc: Doc, indices: ReadonlyArray<number>): Doc => {
  const removed = new Set(indices)
  return { map: removeItems(doc.map, indices), ids: doc.ids.filter((_, i) => !removed.has(i)) }
}

const INVALID_TRANSFORM = "That transform isn't valid for the game (non-finite or zero rotation)."

const sameVec = (a: Vec3, b: Vec3) => a.x === b.x && a.y === b.y && a.z === b.z

const samePivot = (a: Pivot, b: Pivot) => a.choice === b.choice && sameVec(a.localPosition, b.localPosition)

/** True when item `index` has the same transform in both maps (an edit that changed nothing). */
const sameItemTransform = (before: MapFile, after: MapFile, index: number): boolean => {
  const a = before.items[index]?.itemTransform
  const b = after.items[index]?.itemTransform
  if (a === undefined || b === undefined) return false
  const qa = a.rotation
  const qb = b.rotation
  return sameVec(a.translation, b.translation) && sameVec(a.scale3D, b.scale3D) &&
    qa.x === qb.x && qa.y === qb.y && qa.z === qb.z && qa.w === qb.w
}

/** A drag or scrub is showing values that aren't committed yet; undo and redo wait for it. */
const interacting = (s: EditorState) => s.preview !== null || s.lightingPreview !== null

const sameLighting = (a: Lighting, b: Lighting) =>
  a.timeOfDay === b.timeOfDay && a.brightness === b.brightness && a.angle === b.angle

const sameSelection = (a: Selection, b: Selection) => a.length === b.length && a.every((id, i) => id === b[i])

/**
 * The selection after clicking `id` (null: empty space). A plain click selects just that
 * item, or clears; adding keeps the rest and makes the item active; toggling adds or
 * removes it. Clicking empty space with a modifier leaves the selection alone.
 */
export const nextSelection = (current: Selection, id: string | null, mode: SelectMode): Selection => {
  if (mode === "replace") return id === null ? [] : [id]
  if (id === null) return current
  const rest = current.filter((x) => x !== id)
  return mode === "toggle" && rest.length < current.length ? rest : [...rest, id]
}

/** Document indices of the selected items, in selection order. */
export const selectedIndices = (s: EditorState): Array<number> =>
  s.selectedIds.map((id) => s.doc.ids.indexOf(id)).filter((i) => i >= 0)

/** The active (last selected) item's id, if any. */
export const activeId = (s: EditorState): string | undefined => s.selectedIds.at(-1)

/** The sun as shown: the live preview, else the document. */
export const shownLighting = (s: EditorState): Lighting => s.lightingPreview ?? lightingOf(s.doc.map.worldSettings)

/** An item's pivot (Default when it has none, or isn't in the document). */
export const pivotOf = (s: EditorState, id: string): Pivot => pivotAt(s.doc.map, s.doc.ids.indexOf(id))

/** An item's transform as shown: the live preview, else the document. */
export const shownTransform = (s: EditorState, id: string): UeTransform | undefined =>
  s.preview?.get(id) ?? s.doc.map.items[s.doc.ids.indexOf(id)]?.itemTransform

/** The desktop updater's state; null in a browser, and until main has answered. */
export const useUpdateState = () => useEditor((s) => s.update)

/** The creator in use: the one typed in Settings › General, else the one found (domain/creator). */
export const useCreator = (): Creator => {
  const setting = useEditor((s) => s.settings.general.creatorName)
  const found = useEditor((s) => s.foundCreator)
  return creatorOf(setting, found)
}
