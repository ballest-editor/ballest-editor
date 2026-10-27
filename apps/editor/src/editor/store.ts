/**
 * Editor document + UI state. The document is a MapFile (schema-typed) plus a parallel
 * array of stable ids for React keys and selection. All edits go through domain/edits.
 */
import { Option } from "effect"
import { toast } from "sonner"
import { create } from "zustand"
import { type CatalogIndex, type CatalogPiece, indexCatalog } from "../domain/Catalog"
import type { UeTransform, Vec3 } from "../domain/coords"
import { addItem, removeItems, setLevelNames, setTransform, setTranslation, validateItem } from "../domain/edits"
import { itemFromPiece, newMapFile } from "../domain/factory"
import { type DerivedKeybinds, deriveKeybinds } from "../domain/GameKeybinds"
import type { Keybinds } from "../domain/Keybinds"
import type { ItemTransform, MapFile } from "../domain/MapFile"
import type { MaterialTable } from "../domain/Materials"
import { defaultSettings, type Settings } from "../domain/Settings"
import type { LoadedCatalog } from "../services/CatalogLoader"

import type { GizmoSpace } from "./gizmo/handles"
export interface Doc {
  readonly map: MapFile
  readonly ids: ReadonlyArray<string>
}

/**
 * One undo/redo step, seen from the side it restores: the document and the selection that
 * went with it, plus the selection on the other side of the step. Undoing a delete selects
 * the restored item; redoing it leaves what the delete left. A `selectionOnly` step (the
 * "Undo selection changes" setting) restores just the selection and leaves the doc alone.
 */
export interface Snapshot {
  readonly doc: Doc
  readonly selectedId: string | null
  readonly otherSelectedId: string | null
  readonly selectionOnly: boolean
}

export type Tool = "select" | "translate" | "rotate" | "scale"
export type Dialog = "new" | "export" | "settings"
export type SettingsCategory = "general" | "camera" | "keybinds" | "appearance"

const HISTORY_LIMIT = 200
const SPEED_STEPS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16]

let nextId = 0
const freshId = () => `item-${++nextId}`
const freshIds = (n: number) => Array.from({ length: n }, freshId)
const docOf = (map: MapFile): Doc => ({ map, ids: freshIds(map.items.length) })

export const initialMap = () => newMapFile({ displayName: "Untitled", creatorName: "", createdAt: "" })

export interface EditorState {
  readonly doc: Doc
  /** Undo stack, oldest first (at most HISTORY_LIMIT entries). */
  readonly past: ReadonlyArray<Snapshot>
  /** Redo stack, next first; cleared by any new edit. */
  readonly future: ReadonlyArray<Snapshot>
  readonly dirty: boolean
  readonly sourceName: string | null
  readonly selectedId: string | null
  readonly tool: Tool
  /** Whether the gizmo follows the selected item's axes or the world's. */
  readonly gizmoSpace: GizmoSpace
  /** The open modal dialog; editor keybinds are suspended while one is open. */
  readonly dialog: Dialog | null
  readonly settingsCategory: SettingsCategory
  readonly catalog: LoadedCatalog | null
  /** Lookups over `catalog`, built once per catalog load. */
  readonly catalogIndex: CatalogIndex | null
  /** True until the startup loads (catalog, materials, settings) have finished, successfully or not. */
  readonly booting: boolean
  /** Approximate game materials; null until loaded (everything renders neutral meanwhile). */
  readonly materialTable: MaterialTable | null
  readonly keybinds: Keybinds
  readonly settings: Settings
  /** The game's defaults (and which actions fell back to editor defaults). */
  readonly keybindDefaults: DerivedKeybinds
  readonly missingGlbs: ReadonlySet<string>
  /**
   * Live transform of the item under a continuous interaction (gizmo drag, number-field
   * scrub). Not in the document until the interaction commits, as one undo step; undo and
   * redo wait while it is set.
   */
  readonly preview: { readonly id: string; readonly transform: UeTransform } | null
  /** Multiplier on the fly speed, changed by speedFaster/speedSlower. */
  readonly cameraSpeed: number
  /** Bumped to ask the camera to frame the selection / the whole map. */
  readonly focusRequest: number
  readonly frameAllRequest: number

  readonly loadMap: (map: MapFile, sourceName: string | null) => void
  readonly replaceMapSilently: (map: MapFile) => void
  readonly placePiece: (piece: CatalogPiece, transform: ItemTransform) => void
  readonly moveItem: (id: string, translation: Vec3) => void
  /** Replaces the item's transform; false (with a notice) when the game would reject it. */
  readonly transformItem: (id: string, transform: UeTransform) => boolean
  readonly deleteSelection: () => void
  readonly renameLevel: (displayName: string, creatorName: string) => void
  /** Restores the previous snapshot, including its selection. */
  readonly undo: () => void
  readonly redo: () => void
  /** Changes the selection; its own undo step when settings.general.undoSelection is on. */
  readonly select: (id: string | null) => void
  readonly setTool: (tool: Tool) => void
  readonly toggleGizmoSpace: () => void
  readonly openDialog: (dialog: Dialog, category?: SettingsCategory) => void
  readonly closeDialog: () => void
  readonly setSettingsCategory: (category: SettingsCategory) => void
  readonly setPreview: (preview: EditorState["preview"]) => void
  readonly setCatalog: (catalog: LoadedCatalog) => void
  readonly finishBoot: () => void
  readonly setMaterialTable: (table: MaterialTable) => void
  readonly setKeybinds: (keybinds: Keybinds, defaults?: DerivedKeybinds) => void
  readonly setSettings: (settings: Settings) => void
  readonly reportMissingGlb: (url: string) => void
  readonly notify: (kind: "info" | "error", text: string) => void
  readonly changeSpeed: (direction: 1 | -1) => void
  readonly requestFocus: () => void
  readonly requestFrameAll: () => void
}

export const useEditor = create<EditorState>()((set, get) => {
  /** Push the current doc onto the undo stack and replace it; clears the redo stack. */
  const commit = (doc: Doc, extra: Partial<EditorState> = {}) =>
    set((s) => ({
      ...extra,
      doc,
      past: [...s.past, {
        doc: s.doc,
        selectedId: s.selectedId,
        otherSelectedId: extra.selectedId === undefined ? s.selectedId : extra.selectedId,
        selectionOnly: false
      }].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true
    }))

  /** Swaps in a history snapshot; its selection is restored when that item still exists. */
  const restore = (s: EditorState, snapshot: Snapshot) => {
    const doc = snapshot.selectionOnly ? s.doc : snapshot.doc
    return {
      doc,
      dirty: snapshot.selectionOnly ? s.dirty : true,
      selectedId: snapshot.selectedId !== null && doc.ids.includes(snapshot.selectedId) ? snapshot.selectedId : null,
      // the side being left, for the opposite stack
      current: {
        doc: s.doc,
        selectedId: snapshot.otherSelectedId,
        otherSelectedId: snapshot.selectedId,
        selectionOnly: snapshot.selectionOnly
      }
    }
  }

  const indexOf = (id: string | null) => (id === null ? -1 : get().doc.ids.indexOf(id))
  const fallbackDefaults = deriveKeybinds(undefined)

  return {
    doc: docOf(initialMap()),
    past: [],
    future: [],
    dirty: false,
    sourceName: null,
    selectedId: null,
    tool: "translate",
    gizmoSpace: "world",
    dialog: null,
    settingsCategory: "general",
    catalog: null,
    catalogIndex: null,
    booting: true,
    materialTable: null,
    keybinds: fallbackDefaults.keybinds,
    settings: defaultSettings,
    keybindDefaults: fallbackDefaults,
    missingGlbs: new Set(),
    preview: null,
    cameraSpeed: 1,
    focusRequest: 0,
    frameAllRequest: 0,

    loadMap: (map, sourceName) =>
      set((s) => ({
        doc: docOf(map),
        past: [],
        future: [],
        dirty: false,
        sourceName,
        selectedId: null,
        frameAllRequest: s.frameAllRequest + 1
      })),

    replaceMapSilently: (map) => set((s) => ({ doc: { ...s.doc, map } })),

    placePiece: (piece, transform) => {
      const item = validateItem(itemFromPiece(piece, transform))
      if (Option.isNone(item)) {
        get().notify("error", `Catalog entry ${piece.className} doesn't produce a valid item.`)
        return
      }
      const { doc } = get()
      const id = freshId()
      commit({ map: addItem(doc.map, item.value), ids: [...doc.ids, id] }, { selectedId: id })
    },

    moveItem: (id, translation) => {
      const { doc } = get()
      const index = indexOf(id)
      const next = setTranslation(doc.map, index, translation)
      if (Option.isSome(next) && !sameItemTransform(doc.map, next.value, index)) {
        commit({ map: next.value, ids: doc.ids })
      }
    },

    transformItem: (id, transform) => {
      const { doc } = get()
      const index = indexOf(id)
      const next = setTransform(doc.map, index, transform)
      if (Option.isSome(next)) {
        // a drag that ends where it started leaves no step
        if (!sameItemTransform(doc.map, next.value, index)) commit({ map: next.value, ids: doc.ids })
        return true
      }
      get().notify("error", "That transform isn't valid for the game (non-finite or zero rotation).")
      return false
    },

    deleteSelection: () => {
      const { doc, selectedId } = get()
      const index = indexOf(selectedId)
      if (index < 0) return
      commit(
        { map: removeItems(doc.map, [index]), ids: doc.ids.filter((_, i) => i !== index) },
        { selectedId: null }
      )
    },

    renameLevel: (displayName, creatorName) => {
      const { doc } = get()
      const { levelDisplayName, creatorName: currentCreator } = doc.map.worldSettings.levelData
      if (displayName === levelDisplayName && creatorName === currentCreator) return
      commit({ map: setLevelNames(doc.map, displayName, creatorName), ids: doc.ids })
    },

    undo: () =>
      set((s) => {
        const prev = s.past.at(-1)
        if (prev === undefined || s.preview !== null) return s
        const { current, ...next } = restore(s, prev)
        return { ...next, past: s.past.slice(0, -1), future: [current, ...s.future] }
      }),

    redo: () =>
      set((s) => {
        const following = s.future[0]
        if (following === undefined || s.preview !== null) return s
        const { current, ...next } = restore(s, following)
        return { ...next, past: [...s.past, current].slice(-HISTORY_LIMIT), future: s.future.slice(1) }
      }),

    select: (selectedId) =>
      set((s) => {
        if (selectedId === s.selectedId) return s
        if (!s.settings.general.undoSelection) return { selectedId }
        const step: Snapshot = {
          doc: s.doc,
          selectedId: s.selectedId,
          otherSelectedId: selectedId,
          selectionOnly: true
        }
        return { selectedId, past: [...s.past, step].slice(-HISTORY_LIMIT), future: [] }
      }),
    setTool: (tool) => set({ tool }),
    toggleGizmoSpace: () => set((s) => ({ gizmoSpace: s.gizmoSpace === "world" ? "local" : "world" })),
    openDialog: (dialog, category) => set((s) => ({ dialog, settingsCategory: category ?? s.settingsCategory })),
    closeDialog: () => set({ dialog: null }),
    setSettingsCategory: (settingsCategory) => set({ settingsCategory }),
    setPreview: (preview) => set({ preview }),
    setCatalog: (catalog) => set({ catalog, catalogIndex: indexCatalog(catalog.catalog) }),
    finishBoot: () => set({ booting: false }),
    setMaterialTable: (materialTable) => set({ materialTable }),
    setSettings: (settings) => set({ settings }),
    setKeybinds: (keybinds, defaults) => set((s) => ({ keybinds, keybindDefaults: defaults ?? s.keybindDefaults })),
    reportMissingGlb: (url) =>
      set((s) => (s.missingGlbs.has(url) ? s : { missingGlbs: new Set([...s.missingGlbs, url]) })),
    notify: (kind, text) => {
      if (kind === "error") toast.error(text)
      else toast(text)
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

const sameVec = (a: Vec3, b: Vec3) => a.x === b.x && a.y === b.y && a.z === b.z

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

export const selectedIndex = (s: EditorState): number => (s.selectedId === null ? -1 : s.doc.ids.indexOf(s.selectedId))
