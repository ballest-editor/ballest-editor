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
import { deriveKeybinds, type DerivedKeybinds } from "../domain/GameKeybinds"
import type { Keybinds } from "../domain/Keybinds"
import type { ItemTransform, MapFile } from "../domain/MapFile"
import type { MaterialTable } from "../domain/Materials"
import { defaultSettings, type Settings } from "../domain/Settings"
import type { LoadedCatalog } from "../services/CatalogLoader"

export interface Doc {
  readonly map: MapFile
  readonly ids: ReadonlyArray<string>
}

export type Tool = "select" | "translate" | "rotate" | "scale"
export type Dialog = "new" | "export" | "settings"
export type SettingsCategory = "general" | "camera" | "keybinds" | "appearance"

const HISTORY_LIMIT = 200
const SPEED_STEPS = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16]

let nextId = 0
const freshIds = (n: number) => Array.from({ length: n }, () => `item-${++nextId}`)
const docOf = (map: MapFile): Doc => ({ map, ids: freshIds(map.items.length) })

export const initialMap = () => newMapFile({ displayName: "Untitled", creatorName: "", createdAt: "" })

export interface EditorState {
  readonly doc: Doc
  readonly past: ReadonlyArray<Doc>
  readonly future: ReadonlyArray<Doc>
  readonly dirty: boolean
  readonly sourceName: string | null
  readonly selectedId: string | null
  readonly tool: Tool
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
  /** Live transform of the item being dragged by the gizmo (not in the document until release). */
  readonly preview: { readonly id: string; readonly transform: UeTransform } | null
  /** Multiplier on the fly speed, changed by speedFaster/speedSlower. */
  readonly cameraSpeed: number
  /** Bumped to ask the camera to frame the selection / the whole map. */
  readonly focusRequest: number
  readonly frameAllRequest: number

  loadMap(map: MapFile, sourceName: string | null): void
  replaceMapSilently(map: MapFile): void
  placePiece(piece: CatalogPiece, transform: ItemTransform): void
  moveItem(id: string, translation: Vec3): void
  /** Replaces the item's transform; false (with a notice) when the game would reject it. */
  transformItem(id: string, transform: UeTransform): boolean
  deleteSelection(): void
  renameLevel(displayName: string, creatorName: string): void
  undo(): void
  redo(): void
  select(id: string | null): void
  setTool(tool: Tool): void
  openDialog(dialog: Dialog, category?: SettingsCategory): void
  closeDialog(): void
  setSettingsCategory(category: SettingsCategory): void
  setPreview(preview: EditorState["preview"]): void
  setCatalog(catalog: LoadedCatalog): void
  finishBoot(): void
  setMaterialTable(table: MaterialTable): void
  setKeybinds(keybinds: Keybinds, defaults?: DerivedKeybinds): void
  setSettings(settings: Settings): void
  reportMissingGlb(url: string): void
  notify(kind: "info" | "error", text: string): void
  changeSpeed(direction: 1 | -1): void
  requestFocus(): void
  requestFrameAll(): void
}

export const useEditor = create<EditorState>()((set, get) => {
  /** Push the current doc onto the undo stack and replace it. */
  const commit = (doc: Doc, extra: Partial<EditorState> = {}) =>
    set((s) => ({ ...extra, doc, past: [...s.past, s.doc].slice(-HISTORY_LIMIT), future: [], dirty: true }))

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
      const [id] = freshIds(1)
      commit({ map: addItem(doc.map, item.value), ids: [...doc.ids, id!] }, { selectedId: id! })
    },

    moveItem: (id, translation) => {
      const { doc } = get()
      const next = setTranslation(doc.map, indexOf(id), translation)
      if (Option.isSome(next)) commit({ map: next.value, ids: doc.ids })
    },

    transformItem: (id, transform) => {
      const { doc } = get()
      const next = setTransform(doc.map, indexOf(id), transform)
      if (Option.isSome(next)) {
        commit({ map: next.value, ids: doc.ids })
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
      commit({ map: setLevelNames(doc.map, displayName, creatorName), ids: doc.ids })
    },

    undo: () =>
      set((s) => {
        const prev = s.past.at(-1)
        if (prev === undefined) return s
        return {
          doc: prev,
          past: s.past.slice(0, -1),
          future: [s.doc, ...s.future],
          dirty: true,
          selectedId: s.selectedId !== null && prev.ids.includes(s.selectedId) ? s.selectedId : null
        }
      }),

    redo: () =>
      set((s) => {
        const next = s.future[0]
        if (next === undefined) return s
        return {
          doc: next,
          past: [...s.past, s.doc],
          future: s.future.slice(1),
          dirty: true,
          selectedId: s.selectedId !== null && next.ids.includes(s.selectedId) ? s.selectedId : null
        }
      }),

    select: (selectedId) => set({ selectedId }),
    setTool: (tool) => set({ tool }),
    openDialog: (dialog, category) => set((s) => ({ dialog, settingsCategory: category ?? s.settingsCategory })),
    closeDialog: () => set({ dialog: null }),
    setSettingsCategory: (settingsCategory) => set({ settingsCategory }),
    setPreview: (preview) => set({ preview }),
    setCatalog: (catalog) => set({ catalog, catalogIndex: indexCatalog(catalog.catalog) }),
    finishBoot: () => set({ booting: false }),
    setMaterialTable: (materialTable) => set({ materialTable }),
    setSettings: (settings) => set({ settings }),
    setKeybinds: (keybinds, defaults) =>
      set((s) => ({ keybinds, keybindDefaults: defaults ?? s.keybindDefaults })),
    reportMissingGlb: (url) =>
      set((s) => (s.missingGlbs.has(url) ? s : { missingGlbs: new Set([...s.missingGlbs, url]) })),
    notify: (kind, text) => {
      if (kind === "error") toast.error(text)
      else toast(text)
    },
    changeSpeed: (direction) =>
      set((s) => {
        const i = SPEED_STEPS.indexOf(s.cameraSpeed)
        const next = SPEED_STEPS[Math.min(SPEED_STEPS.length - 1, Math.max(0, (i < 0 ? 3 : i) + direction))]!
        return { cameraSpeed: next }
      }),
    requestFocus: () => set((s) => ({ focusRequest: s.focusRequest + 1 })),
    requestFrameAll: () => set((s) => ({ frameAllRequest: s.frameAllRequest + 1 }))
  }
})

export const selectedIndex = (s: EditorState): number => (s.selectedId === null ? -1 : s.doc.ids.indexOf(s.selectedId))
