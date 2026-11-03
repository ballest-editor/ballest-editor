/**
 * Editor document + UI state. The document is a MapFile (schema-typed) plus a parallel
 * array of stable ids for React keys and selection. All edits go through domain/edits.
 */
import { NOTIFICATION_LIMIT, type UpdateState } from "@ballest/contracts"
import { type Effect, Option } from "effect"
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
import { itemFromPiece, mapLabelOf, newMapFile } from "../domain/factory"
import { type DerivedKeybinds, deriveKeybinds } from "../domain/GameKeybinds"
import type { GameLinkResult } from "../domain/gameLink"
import type { PropertyChange } from "../domain/itemProperties"
import type { Keybinds } from "../domain/Keybinds"
import { floorHeightOf } from "../domain/level"
import { LIMITS } from "../domain/limits"
import { type LinkState, linkStateOf } from "../domain/linkState"
import { isPlayerStart, type ItemTransform, type LevelData, type MapFile } from "../domain/MapFile"
import type { MaterialTable } from "../domain/Materials"
import { MIRROR_X, MIRROR_Y, withMirrorMesh } from "../domain/mirror"
import { addNotice, clearNotices, dropNotices, markRead, mergeNotices, resolveNotices } from "../domain/notifications"
import type { PaintPicker } from "../domain/Paint"
import { type Pivot, pivotAt } from "../domain/pivot"
import { defaultSettings, type Settings } from "../domain/Settings"
import { type Lighting, lightingOf } from "../domain/sunlight"
import type { Surfaces } from "../domain/surface"
import type { LoadedCatalog } from "../services/CatalogLoader"
import type {
  GamePathKind,
  GamePaths,
  NotificationAction,
  NotificationRecord,
  PlatformCapabilities,
  PluginStatus,
  ProjectMap,
  ProjectState
} from "../services/Platform"

import type { GizmoSpace } from "./gizmo/handles"

/** The game folder types, for components (which reach services only through editor/). */
export type {
  GamePathKind,
  GamePaths,
  NotificationAction,
  NotificationRecord,
  PluginStatus,
  ProjectMap
} from "../services/Platform"
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
export type LeftTab = "pieces" | "project"
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

/**
 * A file in the game's maps folder that is the draft of a published map (`levelPublishedFileId` > 0), found by Export
 * or by Play's export (`from`): replacing it goes on with the one that found it.
 */
export interface PublishedDraft {
  readonly name: string
  readonly publishedFileId: number
  readonly from: "export" | "play"
}

/**
 * An export the game changed since the last export (the in-game editor saved it), found by Export or by Play's export
 * (`from`): the overwriteChanged dialog asks to back it up and overwrite it, or to re-import it first. `replacePublished`
 * is what the export that found it was already allowed to replace.
 */
export interface ChangedExport {
  readonly name: string
  readonly from: "export" | "play"
  readonly replacePublished: boolean
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

/**
 * A modal dialog: which one (`id`) and what it is about.
 *
 * - `saveAs` names a map that has no file yet before it goes into the project (desktop), or before it is downloaded
 *   (browser: Export). `afterSave` is what the unsaved-changes prompt's Save (or Export, Play) goes on to do once the
 *   map is saved: the dialog takes it before it closes itself to save, its Cancel drops it, and so does any other
 *   dialog opening in its place.
 * - `rename`, `duplicate` and `recover` are the Project panel's per-map items (desktop); `gameLink` is File › Game
 *   link….
 * - `settings` opens on `category`, or on the page it last showed (`settingsCategory`).
 * - `projectSettings` opens Project settings on the project's page, `mapSettings` on the open map's entry in it.
 * - `replacePublished`, `overwriteChanged` and `importClash` ask about what Export, Play or Import found.
 */
export type DialogState =
  | {
    readonly id:
      | "new"
      | "rename"
      | "duplicate"
      | "projectSettings"
      | "mapSettings"
      | "gameLink"
      | "newProject"
      | "newDraft"
      | "recover"
  }
  | { readonly id: "saveAs"; readonly afterSave?: Effect.Effect<void, unknown> }
  | { readonly id: "settings"; readonly category?: SettingsCategory }
  | { readonly id: "replacePublished" } & PublishedDraft
  | { readonly id: "overwriteChanged" } & ChangedExport
  | { readonly id: "importClash" } & ImportClash
export type Dialog = DialogState["id"]

/** What `notify` records besides the level and title (docs/PROJECTS.md § Shell). */
export interface NotifyOptions {
  /** What it is about (`mapSaved`, `gameNotFound`, ...); the level (`info`, `error`) when not given. */
  readonly kind?: string
  /** A second line under the title. */
  readonly body?: string
  /**
   * Pinned to the top of the notification centre until `resolveNotifications(kind)` says its cause has gone away; a
   * later one of the same kind replaces it.
   */
  readonly persistent?: boolean
  /** Its buttons, in the toast (the first) and in the notification centre (all, after a restart too). */
  readonly actions?: ReadonlyArray<NotificationAction>
}

let nextId = 0
const freshId = () => `item-${++nextId}`
const freshIds = (n: number) => Array.from({ length: n }, freshId)
const docOf = (map: MapFile): Doc => ({ map, ids: freshIds(map.items.length) })

let nextTabId = 0
const freshTabId = () => `tab-${++nextTabId}`

export const initialMap = () => newMapFile({ displayName: "Untitled", creatorName: "", createdAt: "" })

/**
 * What each document tab keeps of its own (docs/PROJECTS.md § Shell): its map, history, file and selection. The active
 * tab's is the top of `EditorState`, where every edit works; the others wait in `parkedTabs` as they were left.
 */
export interface TabState {
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
  /** The map's "Export on save" (desktop, off by default; kept with the map's prefs). */
  readonly exportOnSave: boolean
  readonly selectedIds: Selection
  /** Opened as the fresh map the app starts on (or closing the last tab leaves): see `isBlankTab`. */
  readonly fresh: boolean
}

/**
 * Where `loadMap` puts a map: over the active tab's, over another tab's (`tabId`), or in a new tab after the active
 * one (`newTab`), which takes the active tab's place instead while that is blank (`isBlankTab`).
 */
export type TabTarget = "active" | "newTab" | { readonly tabId: string }

export interface EditorState extends TabState {
  /** The document tabs, in order. */
  readonly tabIds: ReadonlyArray<string>
  /** The active tab, whose state is the `TabState` fields here. */
  readonly tabId: string
  /** Every other tab's state, as it was left. */
  readonly parkedTabs: ReadonlyMap<string, TabState>
  /** The project in use and the recent ones (desktop; null until the startup load, and in a browser). */
  readonly project: ProjectState | null
  /** The project's maps, most recently changed first (desktop). */
  readonly projectMaps: ReadonlyArray<ProjectMap>
  /** What the platform (browser or desktop app) offers; the browser's until the startup load says otherwise. */
  readonly capabilities: PlatformCapabilities
  /** The game's folders as last looked up (desktop; null until the startup check or the Game link asks). */
  readonly gamePaths: GamePaths | null
  /** The creator name found on this machine (desktop: the Steam persona name), as last looked up; none until then. */
  readonly foundCreator: Option.Option<FoundCreator>
  /** The editor-link plugin, as last looked up (desktop; null until the startup check, and in a browser). */
  readonly pluginStatus: PluginStatus | null
  /**
   * The Game link checklist's memory (desktop): whether this is the first launch that looked (the checklist then
   * opens as a dialog), and what was last found and kept for the next launch.
   */
  readonly gameLink: { readonly firstRun: boolean; readonly last: GameLinkResult | null }
  /** Why the folder last chosen for `which` in the Game link was refused (it isn't the game's); null once one is used. */
  readonly gamePathProblem: { readonly which: GamePathKind; readonly message: string } | null
  /** The desktop updater's state, once main has sent it; null in a browser. */
  readonly update: UpdateState | null
  /** Every notification (each toast is one), newest first, at most `NOTIFICATION_LIMIT`. */
  readonly notifications: ReadonlyArray<NotificationRecord>
  /** The kinds "Don't show again" muted: `notify` drops them. */
  readonly mutedNotificationKinds: ReadonlySet<string>
  readonly tool: Tool
  /** Whether the gizmo follows the selected item's axes or the world's. */
  readonly gizmoSpace: GizmoSpace
  /** The left dock's tab: the piece palette, or the project's maps (docs/PROJECTS.md § Shell). */
  readonly leftTab: LeftTab
  /** The open modal dialog; editor keybinds are suspended while one is open. */
  readonly dialog: DialogState | null
  /** The Settings dialog's page, kept between openings. */
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
  /** The item surfaces (0.4.1), by saved value, with the material each draws with; empty until loaded. */
  readonly surfaces: Surfaces
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

  /**
   * Shows `map` in a tab (`into`, the active one by default) with a fresh history; a new tab becomes the active one.
   * `floorHeight` defaults to the map's player start height. `dirty` opens it as unsaved edits of `file` (a recovered
   * version), so the next Save writes it there.
   */
  readonly loadMap: (
    map: MapFile,
    file: OpenFile | null,
    floorHeight?: number,
    options?: {
      readonly exportOnSave?: boolean
      readonly dirty?: boolean
      readonly fresh?: boolean
      readonly into?: TabTarget
    }
  ) => void
  /** Makes `tabId` the active tab; nothing while a drag or scrub is under way. */
  readonly activateTab: (tabId: string) => void
  /** Moves tab `tabId` to position `index` in the strip (clamped). */
  readonly moveTab: (tabId: string, index: number) => void
  /**
   * Edits tab `tabId`'s map as one undo step of that tab (Project settings changing a map open in another tab);
   * nothing when `patch` returns the same map.
   */
  readonly editTabMap: (tabId: string, patch: (map: MapFile) => MapFile) => void
  readonly setTabFloorHeight: (tabId: string, floorHeight: number) => void
  readonly setTabExportOnSave: (tabId: string, exportOnSave: boolean) => void
  /**
   * Closes `tabId` without asking (editor/actions asks about its unsaved edits first); the tab after it, else the one
   * before, becomes active in its place. The last tab stays: there is always a map.
   */
  readonly closeTab: (tabId: string) => void
  /**
   * Tab `tabId`'s map was saved as `map` (the export-time level fields applied to `from`) into `file`. When its
   * document is still `from`, `map` replaces it without an undo step and the tab is clean; when it was edited
   * meanwhile, only the file is remembered.
   */
  readonly markSaved: (tabId: string, from: Doc, map: MapFile, file: OpenFile) => void
  readonly setProject: (project: ProjectState, maps: ReadonlyArray<ProjectMap>) => void
  /**
   * The open maps no longer have files: they stay open with their edits as unsaved, and the next Save names each into
   * the project in use (after switching to another project).
   */
  readonly detachFiles: () => void
  readonly setExportOnSave: (exportOnSave: boolean) => void
  readonly setCapabilities: (capabilities: PlatformCapabilities) => void
  readonly setGamePaths: (gamePaths: GamePaths) => void
  readonly setFoundCreator: (foundCreator: Option.Option<FoundCreator>) => void
  readonly setPluginStatus: (pluginStatus: PluginStatus) => void
  readonly setGameLink: (gameLink: Partial<EditorState["gameLink"]>) => void
  readonly setGamePathProblem: (problem: EditorState["gamePathProblem"]) => void
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
  readonly setLeftTab: (tab: LeftTab) => void
  /** Opens `dialog` in place of the open one (and its payload). */
  readonly openDialog: (dialog: DialogState) => void
  readonly closeDialog: () => void
  readonly setCheatSheet: (cheatSheet: boolean) => void
  readonly setSettingsCategory: (category: SettingsCategory) => void
  readonly setPreview: (preview: EditorState["preview"]) => void
  readonly setLightingPreview: (lighting: Lighting | null) => void
  readonly setCatalog: (catalog: LoadedCatalog) => void
  readonly finishBoot: () => void
  readonly setMaterials: (table: MaterialTable, paint: PaintPicker, surfaces: Surfaces) => void
  readonly setKeybinds: (keybinds: Keybinds, defaults?: DerivedKeybinds) => void
  readonly setSettings: (settings: Settings) => void
  readonly reportMissingGlb: (url: string) => void
  /** Records a notification; editor/actions toasts each new one and keeps the list (desktop: across restarts). */
  readonly notify: (level: "info" | "error", title: string, options?: NotifyOptions) => void
  /** Unpins the persistent notifications of `kind`: what they were about has gone away. */
  readonly resolveNotifications: (kind: string) => void
  /** "Don't show again": drops the notifications of each muted kind, and `notify` ignores them from now on. */
  readonly muteNotifications: (kinds: ReadonlyArray<string>) => void
  /** Marks `ids` read, or every notification. */
  readonly markNotificationsRead: (ids?: ReadonlyArray<string>) => void
  /** Removes every notification but the pinned ones. */
  readonly clearNotifications: () => void
  /** Adds the notifications kept from earlier runs under this session's. */
  readonly restoreNotifications: (kept: ReadonlyArray<NotificationRecord>) => void
  readonly changeSpeed: (direction: 1 | -1) => void
  readonly requestFocus: () => void
  readonly requestFrameAll: () => void
}

/** A tab's state for `map`, opened with no history and nothing selected. */
const freshTabState = (
  map: MapFile,
  file: OpenFile | null,
  floorHeight?: number,
  options?: { readonly exportOnSave?: boolean; readonly dirty?: boolean; readonly fresh?: boolean }
): TabState => ({
  doc: docOf(map),
  floorHeight: floorHeight ?? floorHeightOf(map),
  past: [],
  future: [],
  dirty: options?.dirty ?? false,
  file,
  exportOnSave: options?.exportOnSave ?? false,
  selectedIds: [],
  fresh: options?.fresh ?? false
})

/** The active tab's state, out of the store. */
const activeTabOf = (s: EditorState): TabState => ({
  doc: s.doc,
  floorHeight: s.floorHeight,
  past: s.past,
  future: s.future,
  dirty: s.dirty,
  file: s.file,
  exportOnSave: s.exportOnSave,
  selectedIds: s.selectedIds,
  fresh: s.fresh
})

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

  /**
   * Applies `update` to tab `tabId`'s state, wherever it is (the top of the store for the active tab); nothing when no
   * tab has that id.
   */
  const updateTab = (tabId: string, update: (tab: TabState) => Partial<TabState>) =>
    set((s) => {
      if (tabId === s.tabId) return update(s)
      const parked = s.parkedTabs.get(tabId)
      if (parked === undefined) return s
      return { parkedTabs: new Map(s.parkedTabs).set(tabId, { ...parked, ...update(parked) }) }
    })

  /** Interaction state that belongs to the active tab and doesn't survive leaving it. */
  const leftBehind = { preview: null, lightingPreview: null } as const

  const firstTabId = freshTabId()

  return {
    ...freshTabState(initialMap(), null, undefined, { fresh: true }),
    tabIds: [firstTabId],
    tabId: firstTabId,
    parkedTabs: new Map(),
    project: null,
    projectMaps: [],
    capabilities: { projects: false, exportToGame: false, launchGame: false, play: false, updates: false },
    gamePaths: null,
    foundCreator: Option.none(),
    pluginStatus: null,
    gameLink: { firstRun: true, last: null },
    gamePathProblem: null,
    update: null,
    notifications: [],
    mutedNotificationKinds: new Set(),
    tool: "translate",
    gizmoSpace: "world",
    leftTab: "pieces",
    dialog: null,
    settingsCategory: "general",
    cheatSheet: false,
    catalog: null,
    catalogIndex: null,
    booting: true,
    materialTable: null,
    paint: [],
    surfaces: [],
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

    loadMap: (map, file, floorHeight, options) => {
      const tab = freshTabState(map, file, floorHeight, options)
      const into = options?.into ?? "active"
      if (typeof into === "object" && into.tabId !== get().tabId) {
        updateTab(into.tabId, () => tab)
        return
      }
      set((s) => {
        const replace = into !== "newTab" || isBlankTab(s)
        if (replace) return { ...tab, ...leftBehind, frameAllRequest: s.frameAllRequest + 1 }
        const tabId = freshTabId()
        const at = s.tabIds.indexOf(s.tabId) + 1
        return {
          ...tab,
          ...leftBehind,
          tabId,
          tabIds: [...s.tabIds.slice(0, at), tabId, ...s.tabIds.slice(at)],
          parkedTabs: new Map(s.parkedTabs).set(s.tabId, activeTabOf(s)),
          frameAllRequest: s.frameAllRequest + 1
        }
      })
    },

    activateTab: (tabId) =>
      set((s) => {
        const next = s.parkedTabs.get(tabId)
        if (next === undefined || interacting(s) || duplicateDragBase !== null) return s
        const parkedTabs = new Map(s.parkedTabs).set(s.tabId, activeTabOf(s))
        parkedTabs.delete(tabId)
        return { ...next, ...leftBehind, tabId, parkedTabs }
      }),

    moveTab: (tabId, index) =>
      set((s) => {
        const from = s.tabIds.indexOf(tabId)
        if (from < 0) return s
        const rest = s.tabIds.filter((id) => id !== tabId)
        const at = Math.max(0, Math.min(index, rest.length))
        return { tabIds: [...rest.slice(0, at), tabId, ...rest.slice(at)] }
      }),

    editTabMap: (tabId, patch) =>
      updateTab(tabId, (tab) => {
        const map = patch(tab.doc.map)
        if (map === tab.doc.map) return {}
        return {
          doc: { map, ids: tab.doc.ids },
          past: [...tab.past, {
            doc: tab.doc,
            selectedIds: tab.selectedIds,
            otherSelectedIds: tab.selectedIds,
            selectionOnly: false
          }].slice(-HISTORY_LIMIT),
          future: [],
          dirty: true
        }
      }),
    setTabFloorHeight: (tabId, floorHeight) => updateTab(tabId, () => ({ floorHeight })),
    setTabExportOnSave: (tabId, exportOnSave) => updateTab(tabId, () => ({ exportOnSave })),

    closeTab: (tabId) => {
      const { tabIds, tabId: active } = get()
      const index = tabIds.indexOf(tabId)
      if (index < 0 || tabIds.length === 1) return
      if (tabId === active) get().activateTab(tabIds[index + 1] ?? tabIds[index - 1] ?? tabId)
      set((s) => {
        // a drag kept the closing tab active
        if (s.tabId === tabId) return s
        const parkedTabs = new Map(s.parkedTabs)
        parkedTabs.delete(tabId)
        return { tabIds: s.tabIds.filter((id) => id !== tabId), parkedTabs }
      })
    },

    markSaved: (tabId, from, map, file) =>
      updateTab(tabId, (tab) => tab.doc === from ? { doc: { ...tab.doc, map }, dirty: false, file } : { file }),
    setProject: (project, projectMaps) => set({ project, projectMaps }),
    detachFiles: () =>
      set((s) => {
        const detach = (tab: TabState): TabState => tab.file === null ? tab : { ...tab, file: null, dirty: true }
        return {
          ...detach(activeTabOf(s)),
          parkedTabs: new Map([...s.parkedTabs].map(([id, tab]) => [id, detach(tab)]))
        }
      }),
    setExportOnSave: (exportOnSave) => set({ exportOnSave }),
    setCapabilities: (capabilities) => set({ capabilities }),
    setGamePaths: (gamePaths) => set({ gamePaths }),
    setFoundCreator: (foundCreator) => set({ foundCreator }),
    setPluginStatus: (pluginStatus) => set({ pluginStatus }),
    setGameLink: (gameLink) => set((s) => ({ gameLink: { ...s.gameLink, ...gameLink } })),
    setGamePathProblem: (gamePathProblem) => set({ gamePathProblem }),
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
      const written = setProperties(s.doc.map, indices, changes)
      // A mirror flag also swaps the mesh (and some materials) for the game's baked mirror, in the same step.
      const mirrors = changes.some(({ property }) => property.name === MIRROR_X || property.name === MIRROR_Y)
      const next = mirrors
        ? Option.map(written, (map) => ({
          ...map,
          items: map.items.map((item, i) => (indices.includes(i) ? withMirrorMesh(item, s.catalogIndex) : item))
        }))
        : written
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
    setLeftTab: (leftTab) => set({ leftTab }),
    openDialog: (dialog) =>
      set((s) => ({
        dialog,
        settingsCategory: dialog.id === "settings" ? dialog.category ?? s.settingsCategory : s.settingsCategory
      })),
    // Drops the payload with the dialog: the saveAs dialog takes its `afterSave` before it closes itself to save.
    closeDialog: () => set({ dialog: null }),
    setCheatSheet: (cheatSheet) => set({ cheatSheet }),
    setSettingsCategory: (settingsCategory) => set({ settingsCategory }),
    setPreview: (preview) => set({ preview }),
    setLightingPreview: (lightingPreview) => set({ lightingPreview }),
    setCatalog: (catalog) => set({ catalog, catalogIndex: indexCatalog(catalog.catalog) }),
    finishBoot: () => set({ booting: false }),
    setMaterials: (materialTable, paint, surfaces) => set({ materialTable, paint, surfaces }),
    setSettings: (settings) => set({ settings }),
    setKeybinds: (keybinds, defaults) => set((s) => ({ keybinds, keybindDefaults: defaults ?? s.keybindDefaults })),
    reportMissingGlb: (url) =>
      set((s) => (s.missingGlbs.has(url) ? s : { missingGlbs: new Set([...s.missingGlbs, url]) })),
    notify: (level, title, options = {}) => {
      if (get().mutedNotificationKinds.has(options.kind ?? level)) return
      const record: NotificationRecord = {
        id: crypto.randomUUID(),
        kind: options.kind ?? level,
        level,
        title,
        body: options.body ?? null,
        at: new Date().toISOString(),
        read: false,
        persistent: options.persistent ?? false,
        resolvedAt: null,
        actions: options.actions ?? []
      }
      set((s) => ({ notifications: addNotice(s.notifications, record, NOTIFICATION_LIMIT) }))
    },
    resolveNotifications: (kind) =>
      set((s) => ({ notifications: resolveNotices(s.notifications, kind, new Date().toISOString()) })),
    muteNotifications: (kinds) =>
      set((s) => {
        const muted = new Set([...s.mutedNotificationKinds, ...kinds])
        return { mutedNotificationKinds: muted, notifications: dropNotices(s.notifications, muted) }
      }),
    markNotificationsRead: (ids) =>
      set((s) => ({ notifications: markRead(s.notifications, ids === undefined ? undefined : new Set(ids)) })),
    clearNotifications: () => set((s) => ({ notifications: clearNotices(s.notifications) })),
    restoreNotifications: (kept) =>
      set((s) => ({
        notifications: dropNotices(mergeNotices(s.notifications, kept, NOTIFICATION_LIMIT), s.mutedNotificationKinds)
      })),
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

/** Tab `tabId`'s state, wherever it is; undefined when no tab has that id. */
export const tabStateOf = (s: EditorState, tabId: string): TabState | undefined =>
  tabId === s.tabId ? activeTabOf(s) : s.parkedTabs.get(tabId)

/** The tab that has the project map `fileName` open, if one does. */
export const tabWithFile = (s: EditorState, fileName: string): string | undefined =>
  s.tabIds.find((id) => tabStateOf(s, id)?.file?.name === fileName)

/** The tabs with unsaved edits, in tab order. */
export const dirtyTabs = (s: EditorState): ReadonlyArray<string> => s.tabIds.filter((id) => tabStateOf(s, id)?.dirty)

/**
 * A tab nobody has used: the fresh map the app starts on (or closing the last tab leaves), never saved, with no edits
 * and no history. A map opened into a new tab takes its place.
 */
export const isBlankTab = (tab: TabState): boolean =>
  tab.fresh && tab.file === null && !tab.dirty && tab.past.length === 0

/** A map's name as its tab and the title bar show it: its file's, else the name inside it. */
export const tabLabelOf = (tab: TabState): string =>
  tab.file === null
    ? tab.doc.map.worldSettings.levelData.levelDisplayName.trim() || "Untitled"
    : mapLabelOf(tab.file.name)

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

/**
 * The open map's entry in the project (desktop) and its link state; unsaved edits count as edits since the export.
 * Null in a browser, and for a map that isn't in the project yet.
 */
export const useOpenProjectMap = (): { readonly map: ProjectMap; readonly state: LinkState } | null => {
  const fileName = useEditor((s) => s.file?.name ?? null)
  const maps = useEditor((s) => s.projectMaps)
  const dirty = useEditor((s) => s.dirty)
  const map = fileName === null ? undefined : maps.find((m) => m.fileName === fileName)
  return map === undefined ? null : { map, state: linkStateOf(map, { unsaved: dirty }) }
}

/** The open map's name as its tab and the title bar show it. */
export const useOpenMapLabel = (): string => useEditor((s) => tabLabelOf(s))

/** Tab `tabId`'s name, whether it has unsaved edits (or was never saved) and its file (name and path), for its tab. */
export const useTabSummary = (tabId: string) => {
  const label = useEditor((s) => {
    const tab = tabStateOf(s, tabId)
    return tab === undefined ? "" : tabLabelOf(tab)
  })
  const unsaved = useEditor((s) => {
    const tab = tabStateOf(s, tabId)
    return tab !== undefined && (tab.dirty || tab.file === null)
  })
  const path = useEditor((s) => tabStateOf(s, tabId)?.file?.path ?? null)
  const fileName = useEditor((s) => tabStateOf(s, tabId)?.file?.name ?? null)
  return { label, unsaved, path, fileName }
}

/** Whether the project map `fileName` is open in a tab with unsaved edits. */
export const useHasUnsavedEdits = (fileName: string): boolean =>
  useEditor((s) => {
    const tabId = tabWithFile(s, fileName)
    return tabId !== undefined && tabStateOf(s, tabId)?.dirty === true
  })
