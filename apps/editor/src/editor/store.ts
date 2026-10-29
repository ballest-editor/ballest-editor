/**
 * Editor document + UI state. The document is a MapFile (schema-typed) plus a parallel
 * array of stable ids for React keys and selection. All edits go through domain/edits.
 */
import { Option } from "effect"
import { toast } from "sonner"
import { create } from "zustand"
import { type CatalogIndex, type CatalogPiece, indexCatalog } from "../domain/Catalog"
import type { UeTransform, Vec3 } from "../domain/coords"
import {
  addItem,
  type Clip,
  copyItems,
  pasteItems,
  removeItems,
  setLevelNames,
  setTransforms,
  validateItem
} from "../domain/edits"
import { itemFromPiece, newMapFile } from "../domain/factory"
import { type DerivedKeybinds, deriveKeybinds } from "../domain/GameKeybinds"
import type { Keybinds } from "../domain/Keybinds"
import { LIMITS } from "../domain/limits"
import { isPlayerStart, type ItemTransform, type MapFile } from "../domain/MapFile"
import type { MaterialTable } from "../domain/Materials"
import { defaultSettings, type Settings } from "../domain/Settings"
import type { LoadedCatalog } from "../services/CatalogLoader"

import type { GizmoSpace } from "./gizmo/handles"
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
  readonly selectedIds: Selection
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
   * The last copied items (Ctrl+C), as they were when copied. Not part of the document or
   * its history, so it survives undo and loading another map.
   */
  readonly clipboard: Clip | null
  /**
   * Live transforms of the items under a continuous interaction (gizmo drag, number-field
   * scrub), by id. Not in the document until the interaction commits, as one undo step;
   * undo and redo wait while it is set.
   */
  readonly preview: ReadonlyMap<string, UeTransform> | null
  /** Multiplier on the fly speed, changed by speedFaster/speedSlower. */
  readonly cameraSpeed: number
  /** Bumped to ask the camera to frame the selection / the whole map. */
  readonly focusRequest: number
  readonly frameAllRequest: number

  readonly loadMap: (map: MapFile, sourceName: string | null) => void
  readonly replaceMapSilently: (map: MapFile) => void
  readonly placePiece: (piece: CatalogPiece, transform: ItemTransform) => void
  /**
   * Replaces the transforms of several items as one undo step; false (with a notice, and
   * nothing changed) when the game would reject any of them.
   */
  readonly transformItems: (transforms: ReadonlyMap<string, UeTransform>) => boolean
  readonly deleteSelection: () => void
  /** Copies the selected items in place (one undo step) and selects the copies. */
  readonly duplicateSelection: () => void
  /** Puts the selected items on the clipboard; the document is unchanged. */
  readonly copySelection: () => void
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
  /** Restores the previous snapshot, including its selection. */
  readonly undo: () => void
  readonly redo: () => void
  /** Changes the selection; its own undo step when settings.general.undoSelection is on. */
  readonly select: (ids: Selection) => void
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

  return {
    doc: docOf(initialMap()),
    past: [],
    future: [],
    dirty: false,
    sourceName: null,
    selectedIds: [],
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
    clipboard: null,
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
        selectedIds: [],
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

    deleteSelection: () => {
      const s = get()
      const indices = selectedIndices(s)
      if (indices.length === 0) return
      const removed = new Set(indices)
      commit(
        { map: removeItems(s.doc.map, indices), ids: s.doc.ids.filter((_, i) => !removed.has(i)) },
        { selectedIds: [] }
      )
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

    select: (ids) =>
      set((s) => {
        const selectedIds = [...new Set(ids)]
        if (sameSelection(selectedIds, s.selectedIds)) return s
        if (!s.settings.general.undoSelection) return { selectedIds }
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

/** A document and the selection that goes with it. */
interface DocState {
  readonly doc: Doc
  readonly selectedIds: Selection
}

const INVALID_TRANSFORM = "That transform isn't valid for the game (non-finite or zero rotation)."

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

/** An item's transform as shown: the live preview, else the document. */
export const shownTransform = (s: EditorState, id: string): UeTransform | undefined =>
  s.preview?.get(id) ?? s.doc.map.items[s.doc.ids.indexOf(id)]?.itemTransform
