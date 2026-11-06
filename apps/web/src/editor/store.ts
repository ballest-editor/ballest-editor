/**
 * Editor document + UI state. The document is a MapFile (schema-typed), a parallel array of each item's stable key (the
 * item's one identity: React keys, selection, the sidecar) and the map's structure (domain/structure). All edits go
 * through domain/edits and domain/structure.
 */
import {
  type DesktopVersions,
  NOTIFICATION_LIMIT,
  type PrefabInfos,
  type PrefabRef,
  type UpdateState
} from "@ballest/contracts"
import { type Effect, Option } from "effect"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
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
import { editTransform, fitEditTransform } from "../domain/editTransform"
import { itemFromPiece, mapLabelOf, newMapFile } from "../domain/factory"
import { withGameGroups } from "../domain/gameGroups"
import { type DerivedKeybinds, deriveKeybinds } from "../domain/GameKeybinds"
import type { GameLinkResult } from "../domain/gameLink"
import {
  canGroupSelection,
  clickLevelOf,
  enteredLevelOf,
  groupPathOf,
  nodeKeys,
  selectedGroupIds,
  selectionNodeIds
} from "../domain/groupSelection"
import { placedBoxOf } from "../domain/itemBounds"
import { type PropertyChange, withFlip } from "../domain/itemProperties"
import type { Keybinds } from "../domain/Keybinds"
import { floorHeightOf } from "../domain/level"
import { LIMITS } from "../domain/limits"
import { type GameWrite, type LinkState, linkStateOf } from "../domain/linkState"
import { isPlayerStart, type Item, type ItemTransform, type LevelData, type MapFile } from "../domain/MapFile"
import type { PrefabLink } from "../domain/MapSidecar"
import type { MaterialTable } from "../domain/Materials"
import { type FlipAxis, withMirrorMesh } from "../domain/mirror"
import {
  addNotice,
  belongsInInbox,
  clearNotices,
  dropNotices,
  markRead,
  mergeNotices,
  resolveNotices
} from "../domain/notifications"
import type { PaintPicker } from "../domain/Paint"
import { type Pivot, pivotAt } from "../domain/pivot"
import { isSamePrefab, type PrefabSource } from "../domain/prefab"
import type { PrefabFile } from "../domain/PrefabFile"
import { type PrefabDefinition, withUpdatedInstance } from "../domain/prefabInstance"
import { defaultSettings, type Settings } from "../domain/Settings"
import { type LoadedStructure, structureOfMap } from "../domain/sidecar"
import {
  copyStructure,
  type Doc,
  findGroup,
  freshKey,
  freshKeys,
  groupNames,
  itemNames,
  type NumberedName,
  sameStrings,
  type Structure,
  withGroup,
  withGroupName,
  withItemName,
  withMovedNodes,
  withNewItems,
  withoutGroups,
  withoutKeys,
  withPasted,
  withPrefabLink,
  withTags
} from "../domain/structure"
import { type Lighting, lightingOf } from "../domain/sunlight"
import type { Surfaces } from "../domain/surface"
import {
  clampSplit,
  defaultViewLayout,
  type PaneChange,
  paneCountOf,
  type ViewLayout,
  type ViewLayoutKind,
  type ViewProjection,
  withPaneChange
} from "../domain/viewLayout"
import type { LoadedCatalog } from "../services/CatalogLoader"
import type {
  GamePathKind,
  GamePaths,
  NotificationAction,
  NotificationRecord,
  PlatformCapabilities,
  PluginStatus,
  ProjectMap,
  ProjectState,
  ProjectTarget
} from "../services/Platform"

import type { GizmoSpace } from "./gizmo/handles"

/** The game folder types, for components (which reach services only through editor/). */
export type { Doc } from "../domain/structure"
export type {
  GamePathKind,
  GamePaths,
  NotificationAction,
  NotificationRecord,
  PluginStatus,
  ProjectMap
} from "../services/Platform"

/** What a sidecar gives a document on top of its map. */
type DocStructure = Pick<LoadedStructure, "ids" | "structure">

/** Copied items, and what the document held of them beyond the map: their keys (one per item) and structure. */
export interface DocClip extends Clip {
  readonly keys: ReadonlyArray<string>
  readonly structure: Structure
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
export type SettingsCategory = "general" | "editor" | "camera" | "keybinds" | "appearance" | "game"

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
 * A definition open in a tab (docs/DESKTOP.md § Prefabs): which prefab, and the file as it was last read or saved, which
 * Save writes the tab's items back into.
 */
export interface PrefabDocument extends PrefabRef {
  readonly kind: "prefab"
  readonly file: PrefabFile
  readonly hash: string
  /** What each item, by stable key, was in that file. */
  readonly sources: ReadonlyMap<string, PrefabSource>
}

/** What a tab holds: a map, or a prefab's definition in a map-like document. Save, Export and Play ask this first. */
export type TabDocument = { readonly kind: "map" } | PrefabDocument

/** Why a definition's tab can't Export or Play. */
export const PREFAB_TAB_STAYS_HERE = "A prefab isn't a map: place it in one to export or play it."

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
 * - `rename`, `duplicate` and `recover` are the Project panel's per-map items (desktop); `gameLink` opens by itself
 *   when a folder Export needs is missing.
 * - `keybinds` and `about` are the Help menu's: the cheat sheet, staying open, and the version.
 * - `settings` opens on `category`, or on the page it last showed (`settingsCategory`).
 * - `projectSettings` opens Project settings on the project's page, `mapSettings` on the open map's entry in it.
 * - `replacePublished`, `overwriteChanged` and `importClash` ask about what Export, Play or Import found.
 * - `whereToOpen` asks whether `target` (shown as `name`) takes over this window or opens in a new one.
 * - `savePrefab` names a prefab made from the selection; `renamePrefab` and `deletePrefab` are the Prefabs panel's.
 */
export type DialogState =
  | {
    readonly id:
      | "rename"
      | "duplicate"
      | "projectSettings"
      | "mapSettings"
      | "gameLink"
      | "keybinds"
      | "about"
      | "newProject"
      | "newDraft"
      | "recover"
  }
  | { readonly id: "saveAs"; readonly afterSave?: Effect.Effect<void, unknown> }
  | { readonly id: "settings"; readonly category?: SettingsCategory }
  | { readonly id: "replacePublished" } & PublishedDraft
  | { readonly id: "overwriteChanged" } & ChangedExport
  | { readonly id: "importClash" } & ImportClash
  | { readonly id: "whereToOpen"; readonly target: ProjectTarget; readonly name: string }
  | { readonly id: "savePrefab" }
  | { readonly id: "renamePrefab" | "deletePrefab"; readonly prefab: PrefabRef }
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
  /** Its buttons: the first on a toast, all of them in the notification centre (after a restart too). */
  readonly actions?: ReadonlyArray<NotificationAction>
}

const docOf = (map: MapFile, loaded: DocStructure = structureOfMap(map)): Doc => ({
  map,
  ids: loaded.ids,
  structure: loaded.structure
})

let nextTabId = 0
const freshTabId = () => `tab-${++nextTabId}`

export const initialMap = () => newMapFile({ displayName: "Untitled", creatorName: "", createdAt: "" })

/**
 * What each document tab keeps of its own (docs/PROJECTS.md § Shell): its map, history, file and selection. The active
 * tab's is the top of `EditorState`, where every edit works; the others wait in `parkedTabs` as they were left.
 */
export interface TabState {
  readonly doc: Doc
  /** What `doc` is the document of. */
  readonly document: TabDocument
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
  /** `doc` isn't what the file holds, or the file has none of it: undoing or redoing back to `savedDoc` clears this. */
  readonly dirty: boolean
  /** The step of the history the file holds. Null when none does: a recovered map, or one that has lost its file. */
  readonly savedDoc: Doc | null
  /** Null for a map that was never opened or saved. */
  readonly file: OpenFile | null
  /** The map's "Export on save" (desktop, off by default; kept with the map's prefs). */
  readonly exportOnSave: boolean
  readonly selectedIds: Selection
  /** Opened as a fresh map: the one the app starts on, New map's, the one closing the last tab leaves. See `isBlankTab`. */
  readonly fresh: boolean
  /** The group a double-click entered: viewport clicks reach its children (docs/DESKTOP.md § Groups and selection). */
  readonly enteredGroupId: string | null
  /** The groups the Outline shows closed. Outside the document and its history, so undo doesn't touch them. */
  readonly collapsedGroups: ReadonlySet<string>
  /** How the tab divides its view into panes; kept per map in MapPrefsStore. */
  readonly viewLayout: ViewLayout
  /** The slot of the active pane: what the fly keys, Focus selection and Frame all act on. */
  readonly activePane: number
}

/**
 * Where `loadMap` puts a map: over the active tab's, over another tab's (`tabId`), or in a new tab after the active
 * one (`newTab`), which takes the active tab's place instead while that is blank (`isBlankTab`).
 */
export type TabTarget = "active" | "newTab" | "addedTab" | { readonly tabId: string }

/** How a tab opens: what it holds beside its map, and what it starts on other than the defaults. */
interface TabOptions {
  readonly exportOnSave?: boolean
  readonly dirty?: boolean
  readonly fresh?: boolean
  readonly loaded?: DocStructure | undefined
  readonly viewLayout?: ViewLayout | undefined
  readonly document?: TabDocument
}

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
  /** Every prefab of both tiers, as last listed. */
  readonly prefabs: PrefabInfos
  /** What the platform (browser or desktop app) offers; the browser's until the startup load says otherwise. */
  readonly capabilities: PlatformCapabilities
  /** The desktop app's runtime, for Help › About; null in a browser. */
  readonly runtimeVersions: DesktopVersions | null
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
  /** A check the user asked for has finished: what the app says "up to date" on. */
  readonly updateChecked: boolean
  /** Every notification, newest first, at most `NOTIFICATION_LIMIT`. */
  readonly notifications: ReadonlyArray<NotificationRecord>
  /** Immediate feedback waiting for `showToasts`, newest first, at most `NOTIFICATION_LIMIT`. Never kept. */
  readonly toasts: ReadonlyArray<NotificationRecord>
  /** The kinds "Don't show again" muted: `notify` drops them. */
  readonly mutedNotificationKinds: ReadonlySet<string>
  readonly tool: Tool
  /** Whether the gizmo follows the selected item's axes or the world's. */
  readonly gizmoSpace: GizmoSpace
  /** The open modal dialog; editor keybinds are suspended while one is open. */
  readonly dialog: DialogState | null
  /** The Export or Play under way, for the status bar's chip; null when there is none. */
  readonly gameWrite: GameWrite | null
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
  readonly clipboard: DocClip | null
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
  /** Bumped to frame the selection in the active pane. */
  readonly focusRequest: number
  /** Bumped to frame the whole map in the active pane. */
  readonly frameAllRequest: number
  /** Bumped when a map is put into the active tab: every pane of the tab frames it. */
  readonly mapShownRequest: number

  /**
   * Shows `map` in a tab (`into`, the active one by default) with a fresh history; a new tab becomes the active one.
   * `floorHeight` defaults to the map's player start height. `dirty` opens it as unsaved edits of `file` (a recovered
   * version), so the next Save writes it there. `loaded` is what its sidecar gave; without one the map stands alone.
   */
  readonly loadMap: (
    map: MapFile,
    file: OpenFile | null,
    floorHeight?: number,
    options?: TabOptions & { readonly into?: TabTarget | undefined }
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
  /** Edits tab `tabId`'s document as one undo step of that tab; nothing when `edit` answers undefined. */
  readonly editTabDoc: (tabId: string, edit: (doc: Doc) => Doc | undefined) => void
  /** Changes what tab `tabId` keeps of its own without touching its history: its floor, Export on save, document, file. */
  readonly patchTab: (tabId: string, patch: Partial<TabState>) => void
  /**
   * Closes `tabId` without asking (editor/actions asks about its unsaved edits first); the tab after it, else the one
   * before, becomes active in its place. The last tab stays: there is always a map.
   */
  readonly closeTab: (tabId: string) => void
  /**
   * Tab `tabId`'s map was saved as `map` (the export-time level fields applied to `from`) into `file`. When its
   * document is still `from`, `map` replaces it without an undo step and the tab is clean; when it was edited
   * meanwhile, the tab stays dirty until the history is back at `from`.
   */
  readonly markSaved: (tabId: string, from: Doc, map: MapFile, file: OpenFile) => void
  /** Tab `tabId`'s definition was saved from `from`, as `document`: the tab is clean while its document is still `from`. */
  readonly markPrefabSaved: (tabId: string, from: Doc, document: PrefabDocument, file: OpenFile) => void
  readonly setPrefabs: (prefabs: PrefabInfos) => void
  readonly setProject: (project: ProjectState, maps: ReadonlyArray<ProjectMap>) => void
  /**
   * The open maps no longer have files: they stay open with their edits as unsaved, and the next Save names each into
   * the project in use (after switching to another project).
   */
  readonly detachFiles: () => void
  readonly setCapabilities: (capabilities: PlatformCapabilities) => void
  readonly setRuntimeVersions: (runtimeVersions: DesktopVersions | null) => void
  readonly setGamePaths: (gamePaths: GamePaths) => void
  readonly setFoundCreator: (foundCreator: Option.Option<FoundCreator>) => void
  readonly setPluginStatus: (pluginStatus: PluginStatus) => void
  readonly setGameLink: (gameLink: Partial<EditorState["gameLink"]>) => void
  readonly setGamePathProblem: (problem: EditorState["gamePathProblem"]) => void
  readonly setUpdate: (update: UpdateState) => void
  readonly setUpdateChecked: (updateChecked: boolean) => void
  readonly placePiece: (piece: CatalogPiece, transform: ItemTransform) => void
  /**
   * Adds `items` as one new group called `name`, selected, as one undo step: a prefab placed, as an instance when `link`
   * says of what. Answers the group's id; undefined (with a notice) when the map has no room for them.
   */
  readonly placeGroup: (items: ReadonlyArray<Item>, name: string, link?: PrefabLink) => string | undefined
  /** Replaces the instances `groupIds` of tab `tabId` with `definition`, where they stand, as one undo step. */
  readonly updateInstances: (tabId: string, groupIds: ReadonlyArray<string>, definition: PrefabDefinition) => void
  /** Gives groups of tab `tabId` the links paired with them, as one undo step; undefined makes a plain group. */
  readonly relinkInstances: (
    tabId: string,
    links: ReadonlyArray<readonly [groupId: string, link: PrefabLink | undefined]>
  ) => void
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
  /** Flips each selected item that can flip on the axis, from its own state: one undo step. */
  readonly flipSelection: (axis: FlipAxis) => void
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
  readonly renameItem: (key: string, name: string | null) => void
  readonly renameGroup: (id: string, name: string) => void
  readonly setTags: (target: string, tags: ReadonlyArray<string>) => void
  /** `withGroup` as one undo step; answers the group's id, or undefined when none of `keys` is in the tree. */
  readonly groupItems: (keys: ReadonlyArray<string>, name?: string) => string | undefined
  /** Groups what's selected as one undo step, whole groups staying whole inside the new one. */
  readonly groupSelection: () => void
  /** Dissolves every group whole in the selection as one undo step; the items stay selected. */
  readonly ungroupSelection: () => void
  /** `withMovedNodes` as one undo step. */
  readonly moveNodes: (nodeIds: ReadonlyArray<string>, parentGroupId: string | null, index: number) => void
  /** Restores the previous snapshot, including its selection. */
  readonly undo: () => void
  readonly redo: () => void
  /** Changes the selection; its own undo step when settings.editor.undoSelection is on. */
  readonly select: (ids: Selection) => void
  /**
   * A viewport click on item `key` (null: empty space): selects what it reaches at the click level (`clickLevelOf`). A
   * plain click outside the entered group leaves it.
   */
  readonly clickItem: (key: string | null, mode: SelectMode) => void
  /** A viewport double-click on item `key`: enters the group a click reaches, and selects the next level down. */
  readonly doubleClickItem: (key: string) => void
  /** Sets the entered group (null: none), keeping the selection. */
  readonly enterGroup: (groupId: string | null) => void
  /** Steps out of the entered group, selecting it; with none entered, clears the selection. */
  readonly deselect: () => void
  readonly setGroupCollapsed: (groupId: string, collapsed: boolean) => void
  readonly expandGroups: (groupIds: ReadonlyArray<string>) => void
  readonly setTool: (tool: Tool) => void
  readonly toggleGizmoSpace: () => void
  /** Opens `dialog` in place of the open one (and its payload). */
  readonly openDialog: (dialog: DialogState) => void
  readonly closeDialog: () => void
  readonly setGameWrite: (gameWrite: GameWrite | null) => void
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
  /** Divides the active tab's view; the active pane stays when the new layout still shows it. */
  readonly setViewLayoutKind: (kind: ViewLayoutKind) => void
  /** Moves the dividers, as shares of the viewport; each is held off the edges (`clampSplit`). */
  readonly setPaneSplit: (split: { readonly x?: number; readonly y?: number }) => void
  /** Splits or closes panes. Their cameras move with them: use `changePanes` (editor/paneCameras). */
  readonly applyPaneChange: (change: PaneChange) => void
  /** What the pane in `slot` looks along. */
  readonly setPaneProjection: (slot: number, projection: ViewProjection) => void
  readonly setActivePane: (slot: number) => void
}

/** A tab's state for `map`, opened with no history and nothing selected. */
const freshTabState = (
  map: MapFile,
  file: OpenFile | null,
  floorHeight?: number,
  options?: TabOptions
): TabState => {
  const doc = docOf(map, options?.loaded)
  const dirty = options?.dirty ?? false
  return {
    doc,
    document: options?.document ?? { kind: "map" },
    floorHeight: floorHeight ?? floorHeightOf(map),
    past: [],
    future: [],
    dirty,
    savedDoc: dirty ? null : doc,
    file,
    exportOnSave: options?.exportOnSave ?? false,
    selectedIds: [],
    fresh: options?.fresh ?? false,
    enteredGroupId: null,
    collapsedGroups: new Set(),
    viewLayout: options?.viewLayout ?? defaultViewLayout,
    activePane: 0
  }
}

/** The active tab's state, out of the store. */
const activeTabOf = (s: EditorState): TabState => ({
  doc: s.doc,
  document: s.document,
  floorHeight: s.floorHeight,
  past: s.past,
  future: s.future,
  dirty: s.dirty,
  savedDoc: s.savedDoc,
  file: s.file,
  exportOnSave: s.exportOnSave,
  selectedIds: s.selectedIds,
  fresh: s.fresh,
  enteredGroupId: s.enteredGroupId,
  collapsedGroups: s.collapsedGroups,
  viewLayout: s.viewLayout,
  activePane: s.activePane
})

/** A step of history on top of `past`, away from `doc` and `selectedIds` to `otherSelectedIds`; it clears the redo stack. */
const stepFrom = (
  past: TabState["past"],
  { doc, selectedIds }: DocState,
  otherSelectedIds: Selection,
  selectionOnly = false
) => ({ past: [...past, { doc, selectedIds, otherSelectedIds, selectionOnly }].slice(-HISTORY_LIMIT), future: [] })

export const useEditor = create<EditorState>()((set, get) => {
  /**
   * Push `before` (by default the current doc and selection) onto the undo stack and replace
   * the doc; clears the redo stack.
   */
  const commit = (doc: Doc, extra: Partial<EditorState> = {}, before?: DocState) =>
    set((s) => ({
      ...extra,
      doc,
      enteredGroupId: keptEnteredGroup(doc, s.enteredGroupId),
      ...stepFrom(s.past, before ?? s, extra.selectedIds ?? s.selectedIds),
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

  /** Whether `count` more items fit in the map; says so when they don't. */
  const hasRoomFor = ({ doc, notify }: EditorState, count: number) => {
    const fits = doc.map.items.length + count <= LIMITS.itemsPerLevel
    if (!fits) notify("error", `The game allows at most ${LIMITS.itemsPerLevel.toLocaleString()} items in a map.`)
    return fits
  }

  /** The doc with the clip's items added, their fresh keys and each source key's copy; undefined when there's no room. */
  const withClip = (s: EditorState, clip: DocClip) => {
    if (clip.items.length === 0 || !hasRoomFor(s, clip.items.length)) return undefined
    const added = freshKeys(clip.items.length)
    const keyOf = new Map(clip.keys.flatMap((key, n) => {
      const copy = added[n]
      return copy === undefined ? [] : [[key, copy] as const]
    }))
    const doc: Doc = {
      map: pasteItems(s.doc.map, clip),
      ids: [...s.doc.ids, ...added],
      structure: withPasted(s.doc.structure, clip.structure, keyOf)
    }
    return { doc, added, keyOf }
  }

  /** One undo step for a change to the map's structure; nothing when `structure` says nothing changed. */
  const commitStructure = (structure: Structure | undefined) => {
    if (structure !== undefined) commit({ ...get().doc, structure })
  }

  /** Where an Alt+drag duplicate started, while one is in progress. */
  let duplicateDragBase: DocState | null = null

  /** Swaps in a history snapshot; its selection is restored for the items that still exist. */
  const restore = (s: EditorState, snapshot: Snapshot) => {
    const doc = snapshot.selectionOnly ? s.doc : snapshot.doc
    const existing = new Set(doc.ids)
    return {
      doc,
      dirty: doc !== s.savedDoc,
      selectedIds: snapshot.selectedIds.filter((id) => existing.has(id)),
      enteredGroupId: keptEnteredGroup(doc, s.enteredGroupId),
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
    prefabs: [],
    capabilities: { projects: false, exportToGame: false, launchGame: false, play: false, updates: false },
    runtimeVersions: null,
    gamePaths: null,
    foundCreator: Option.none(),
    pluginStatus: null,
    gameLink: { firstRun: true, last: null },
    gamePathProblem: null,
    update: null,
    updateChecked: false,
    notifications: [],
    toasts: [],
    mutedNotificationKinds: new Set(),
    tool: "translate",
    gizmoSpace: "world",
    dialog: null,
    gameWrite: null,
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
    mapShownRequest: 0,

    loadMap: (map, file, floorHeight, options) => {
      const tab = freshTabState(map, file, floorHeight, options)
      const into = options?.into ?? "active"
      if (typeof into === "object" && into.tabId !== get().tabId) {
        updateTab(into.tabId, () => tab)
        return
      }
      set((s) => {
        if (into === "addedTab" && (interacting(s) || duplicateDragBase !== null)) return s
        const shown = { ...tab, ...leftBehind, mapShownRequest: s.mapShownRequest + 1 }
        if (into === "newTab" ? isBlankTab(s) : into !== "addedTab") return shown
        const tabId = freshTabId()
        const at = s.tabIds.indexOf(s.tabId) + 1
        return {
          ...shown,
          tabId,
          tabIds: [...s.tabIds.slice(0, at), tabId, ...s.tabIds.slice(at)],
          parkedTabs: new Map(s.parkedTabs).set(s.tabId, activeTabOf(s))
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
      get().editTabDoc(tabId, (doc) => {
        const map = patch(doc.map)
        return map === doc.map ? undefined : { ...doc, map }
      }),
    editTabDoc: (tabId, edit) =>
      updateTab(tabId, (tab) => {
        const doc = edit(tab.doc)
        if (doc === undefined) return {}
        const kept = new Set(doc.ids)
        const selectedIds = tab.selectedIds.filter((id) => kept.has(id))
        return {
          doc,
          selectedIds,
          enteredGroupId: keptEnteredGroup(doc, tab.enteredGroupId),
          ...stepFrom(tab.past, tab, selectedIds),
          dirty: true
        }
      }),
    patchTab: (tabId, patch) => updateTab(tabId, () => patch),

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
      updateTab(tabId, (tab) => {
        // edited while it saved: the file holds `from`, a step of the history by now
        if (tab.doc !== from) return { savedDoc: from, file }
        const doc = { ...from, map }
        return { doc, savedDoc: doc, dirty: false, file }
      }),
    markPrefabSaved: (tabId, from, document, file) =>
      updateTab(tabId, (tab) => ({ document, savedDoc: from, dirty: tab.doc !== from, file })),
    setPrefabs: (prefabs) => set({ prefabs }),
    setProject: (project, projectMaps) => set({ project, projectMaps }),
    detachFiles: () =>
      set((s) => {
        // a user prefab belongs to the game, whichever project is in use
        const detach = (tab: TabState): TabState =>
          tab.file === null || (tab.document.kind === "prefab" && tab.document.tier === "user")
            ? tab
            : { ...tab, file: null, dirty: true, savedDoc: null }
        return {
          ...detach(activeTabOf(s)),
          parkedTabs: new Map([...s.parkedTabs].map(([id, tab]) => [id, detach(tab)]))
        }
      }),
    setCapabilities: (capabilities) => set({ capabilities }),
    setRuntimeVersions: (runtimeVersions) => set({ runtimeVersions }),
    setGamePaths: (gamePaths) => set({ gamePaths }),
    setFoundCreator: (foundCreator) => set({ foundCreator }),
    setPluginStatus: (pluginStatus) => set({ pluginStatus }),
    setGameLink: (gameLink) => set((s) => ({ gameLink: { ...s.gameLink, ...gameLink } })),
    setGamePathProblem: (gamePathProblem) => set({ gamePathProblem }),
    setUpdate: (update) => set({ update }),
    setUpdateChecked: (updateChecked) => set({ updateChecked }),

    placePiece: (piece, transform) => {
      const item = validateItem(itemFromPiece(piece, transform))
      if (Option.isNone(item)) {
        get().notify("error", `Catalog entry ${piece.className} doesn't produce a valid item.`)
        return
      }
      const { doc } = get()
      const id = freshKey()
      commit({
        map: addItem(doc.map, item.value),
        ids: [...doc.ids, id],
        structure: withNewItems(doc.structure, [id])
      }, { selectedIds: [id] })
    },

    placeGroup: (items, name, link) => {
      const s = get()
      const { doc } = s
      if (!hasRoomFor(s, items.length)) return undefined
      const keys = freshKeys(items.length)
      const id = freshKey()
      const grouped = withGroup(withNewItems(doc.structure, keys), keys, id, name)
      if (grouped === undefined) return undefined
      commit({
        map: { ...doc.map, items: [...doc.map.items, ...items] },
        ids: [...doc.ids, ...keys],
        structure: withPrefabLink(grouped, id, link) ?? grouped
      }, { selectedIds: keys })
      return id
    },

    updateInstances: (tabId, groupIds, definition) =>
      get().editTabDoc(tabId, (doc) => {
        const next = groupIds.reduce<Doc>((current, id) => withUpdatedInstance(current, id, definition) ?? current, doc)
        return next === doc ? undefined : next
      }),

    relinkInstances: (tabId, links) =>
      get().editTabDoc(tabId, (doc) => {
        const structure = links.reduce<Structure>(
          (current, [id, link]) => withPrefabLink(current, id, link) ?? current,
          doc.structure
        )
        return structure === doc.structure ? undefined : { ...doc, structure }
      }),

    transformItems: (transforms) => {
      const { doc } = get()
      const entries = [...transforms].map(([id, t]) => [indexOfKey(doc.ids, id), t] as const)
      const next = setTransforms(doc.map, entries)
      if (Option.isSome(next)) {
        // a drag that ends where it started leaves no step
        if (!entries.every(([index]) => sameItemTransform(doc.map, next.value, index))) {
          commit({ ...doc, map: next.value })
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
      if (next.value !== doc.map) commit({ ...doc, map: next.value })
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
      if (!unchanged) commit({ ...s.doc, map: next.value })
      return true
    },

    flipSelection: (axis) => {
      const s = get()
      const { map } = s.doc
      const selected = new Set(selectedIndices(s))
      const items = map.items.map((item, i) => {
        if (!selected.has(i)) return item
        const flipped = withFlip({ item, piece: s.catalogIndex?.pieceByClass.get(item.actorToSpawn) }, axis)
        // A flip also swaps the mesh (and some materials) for the game's baked mirror, in the same step.
        return flipped === item ? item : withMirrorMesh(flipped, s.catalogIndex)
      })
      if (items.some((item, i) => item !== map.items[i])) commit({ ...s.doc, map: { ...map, items } })
    },

    setItemPivots: (pivots) => {
      const { doc } = get()
      const entries = [...pivots].flatMap(([id, pivot]) => {
        const index = doc.ids.indexOf(id)
        return index < 0 || samePivot(pivotAt(doc.map, index), pivot) ? [] : [[index, pivot] as const]
      })
      if (entries.length > 0) commit({ ...doc, map: setPivots(doc.map, entries) })
    },

    deleteSelection: () => {
      const s = get()
      const indices = selectedIndices(s)
      if (indices.length === 0) return
      commit(withoutItems(s.doc, indices), { selectedIds: [] })
    },

    duplicateSelection: () => {
      const s = get()
      const next = withClip(s, clipOf(s.doc, copyableIndices(s)))
      if (next !== undefined) commit(next.doc, { selectedIds: next.added })
    },

    copySelection: () => {
      const s = get()
      const clip = clipOf(s.doc, copyableIndices(s))
      if (clip.items.length > 0) set({ clipboard: clip })
    },

    cutSelection: () => {
      const s = get()
      // only what was copied goes: cutting never removes the player start
      const indices = copyableIndices(s)
      if (indices.length === 0) return
      commit(withoutItems(s.doc, indices), { selectedIds: [], clipboard: clipOf(s.doc, indices) })
    },

    paste: () => {
      const s = get()
      const next = s.clipboard === null ? undefined : withClip(s, s.clipboard)
      if (next !== undefined) commit(next.doc, { selectedIds: next.added })
    },

    beginDuplicateDrag: () => {
      const s = get()
      if (duplicateDragBase !== null) return undefined
      const next = withClip(s, clipOf(s.doc, copyableIndices(s)))
      if (next === undefined) return undefined
      duplicateDragBase = { doc: s.doc, selectedIds: s.selectedIds }
      set({ doc: next.doc, selectedIds: next.added })
      return next.keyOf
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
      commit({ ...doc, map: next.value }, {}, before)
      return true
    },

    renameLevel: (displayName, creatorName) => {
      const { doc } = get()
      const { levelDisplayName, creatorName: currentCreator } = doc.map.worldSettings.levelData
      if (displayName === levelDisplayName && creatorName === currentCreator) return
      commit({ ...doc, map: setLevelNames(doc.map, displayName, creatorName) })
    },

    setLighting: (lighting) => {
      const { doc } = get()
      const next = setLighting(doc.map, lighting)
      if (Option.isNone(next) || sameLighting(lightingOf(doc.map.worldSettings), lighting)) return
      commit({ ...doc, map: next.value })
    },

    setLevelData: (levelData) => {
      const { doc } = get()
      if (JSON.stringify(levelData) === JSON.stringify(doc.map.worldSettings.levelData)) return
      commit({ ...doc, map: setLevelData(doc.map, levelData) })
    },

    renameItem: (key, name) => commitStructure(withItemName(get().doc.structure, key, name)),
    renameGroup: (id, name) => commitStructure(withGroupName(get().doc.structure, id, name)),
    setTags: (target, tags) => commitStructure(withTags(get().doc.structure, target, tags)),
    groupItems: (keys, name) => {
      const id = freshKey()
      const next = withGroup(get().doc.structure, keys, id, name)
      commitStructure(next)
      return next === undefined ? undefined : id
    },
    groupSelection: () => {
      const { doc, selectedIds, groupItems } = get()
      if (canGroupSelection(doc.structure.tree, selectedIds)) {
        groupItems(selectionNodeIds(doc.structure.tree, selectedIds))
      }
    },
    ungroupSelection: () => {
      const { doc, selectedIds } = get()
      commitStructure(withoutGroups(doc.structure, selectedGroupIds(doc.structure.tree, selectedIds)))
    },
    moveNodes: (nodeIds, parentGroupId, index) =>
      commitStructure(withMovedNodes(get().doc.structure, nodeIds, parentGroupId, index)),

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
        if (sameStrings(selectedIds, s.selectedIds)) return s
        if (!s.settings.editor.undoSelection) return { selectedIds }
        return { selectedIds, ...stepFrom(s.past, s, selectedIds, true) }
      }),
    clickItem: (key, mode) => {
      const { doc, selectedIds, enteredGroupId, select } = get()
      const { tree } = doc.structure
      const level = key === null ? undefined : clickLevelOf(tree, key, enteredGroupId)
      // the clicked item is the active one, so the gizmo sits where the click was
      const reached = level === undefined ? [] : nodeKeys(tree, level.nodeId).filter((id) => id !== key)
      select(nextSelection(selectedIds, key === null ? [] : [...reached, key], mode))
      if (mode === "replace") set({ enteredGroupId: level?.enteredGroupId ?? null })
    },
    doubleClickItem: (key) => {
      const { doc, enteredGroupId, select } = get()
      const { tree } = doc.structure
      const level = enteredLevelOf(tree, key, enteredGroupId)
      if (level === undefined) return
      select(nodeKeys(tree, level.nodeId))
      set({ enteredGroupId: level.enteredGroupId })
    },
    enterGroup: (enteredGroupId) => set({ enteredGroupId }),
    deselect: () => {
      const { doc, enteredGroupId, select } = get()
      if (enteredGroupId === null) {
        select([])
        return
      }
      const { tree } = doc.structure
      select(nodeKeys(tree, enteredGroupId))
      set({ enteredGroupId: groupPathOf(tree, enteredGroupId).at(-1) ?? null })
    },
    setGroupCollapsed: (groupId, collapsed) =>
      set((s) => {
        if (s.collapsedGroups.has(groupId) === collapsed) return s
        const collapsedGroups = new Set(s.collapsedGroups)
        if (collapsed) collapsedGroups.add(groupId)
        else collapsedGroups.delete(groupId)
        return { collapsedGroups }
      }),
    expandGroups: (groupIds) =>
      set((s) => {
        if (!groupIds.some((id) => s.collapsedGroups.has(id))) return s
        const open = new Set(groupIds)
        return { collapsedGroups: new Set([...s.collapsedGroups].filter((id) => !open.has(id))) }
      }),
    setTool: (tool) => set({ tool }),
    toggleGizmoSpace: () => set((s) => ({ gizmoSpace: s.gizmoSpace === "world" ? "local" : "world" })),
    // The required chooser stays on top of everything: what would open behind it (the Game link's) waits for a launch.
    openDialog: (dialog) =>
      set((s) =>
        isChooserRequired(s) ? s : ({
          dialog,
          settingsCategory: dialog.id === "settings" ? dialog.category ?? s.settingsCategory : s.settingsCategory
        })
      ),
    // Drops the payload with the dialog: the saveAs dialog takes its `afterSave` before it closes itself to save.
    closeDialog: () => set({ dialog: null }),
    setGameWrite: (gameWrite) => set({ gameWrite }),
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
      set((s) =>
        belongsInInbox(record)
          ? { notifications: addNotice(s.notifications, record, NOTIFICATION_LIMIT) }
          : { toasts: [record, ...s.toasts].slice(0, NOTIFICATION_LIMIT) }
      )
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
    requestFrameAll: () => set((s) => ({ frameAllRequest: s.frameAllRequest + 1 })),
    setViewLayoutKind: (kind) =>
      set((s) => ({
        viewLayout: { ...s.viewLayout, kind },
        activePane: Math.min(s.activePane, paneCountOf(kind) - 1)
      })),
    setPaneSplit: ({ x, y }) =>
      set((s) => ({
        viewLayout: {
          ...s.viewLayout,
          splitX: x === undefined ? s.viewLayout.splitX : clampSplit(x),
          splitY: y === undefined ? s.viewLayout.splitY : clampSplit(y)
        }
      })),
    applyPaneChange: (change) =>
      set((s) => {
        const slot = change.order.findIndex((from) => from === s.activePane)
        return {
          viewLayout: withPaneChange(s.viewLayout, change),
          activePane: slot < paneCountOf(change.kind) ? slot : 0
        }
      }),
    setPaneProjection: (slot, projection) =>
      set((s) => {
        const [a, b, c, d] = s.viewLayout.projections
        const at = (i: number, current: ViewProjection) => i === slot ? projection : current
        return { viewLayout: { ...s.viewLayout, projections: [at(0, a), at(1, b), at(2, c), at(3, d)] } }
      }),
    setActivePane: (slot) => set((s) => s.activePane === slot ? s : { activePane: slot })
  }
})

/** Tab `tabId`'s state, wherever it is; undefined when no tab has that id. */
export const tabStateOf = (s: EditorState, tabId: string): TabState | undefined =>
  tabId === s.tabId ? activeTabOf(s) : s.parkedTabs.get(tabId)

/** The tabs `test` picks, in tab order. */
const tabsWhere = (s: EditorState, test: (tab: TabState) => boolean): ReadonlyArray<string> =>
  s.tabIds.filter((id) => {
    const tab = tabStateOf(s, id)
    return tab !== undefined && test(tab)
  })

/** The tab that has the project map `fileName` open, if one does. */
export const tabWithFile = (s: EditorState, fileName: string): string | undefined =>
  tabsWhere(s, (tab) => tab.file?.name === fileName)[0]

export const dirtyTabs = (s: EditorState): ReadonlyArray<string> => tabsWhere(s, (tab) => tab.dirty)

/**
 * The tabs whose map has no file yet, in tab order: the fresh map, every map in Untitled Project, what a switch of
 * projects left open. The project's file list can't show them, so the Project panel gives each a row of its own.
 */
export const tabsWithoutFile = (s: EditorState): ReadonlyArray<string> =>
  tabsWhere(s, (tab) => tab.file === null && tab.document.kind === "map")

/**
 * A tab nobody has edited: a fresh map (the one the app starts on, New map's, the one closing the last tab leaves), never
 * saved, with no edits. Selecting in it isn't an edit. It holds nothing to lose: closing it asks nothing, a map opened
 * into a new tab takes its place, and a switch of projects drops it.
 */
export const isBlankTab = (tab: TabState): boolean => tab.fresh && tab.file === null && !tab.dirty

/** Whether a tab shows as unsaved: it has edits, or a map with no file that isn't blank (what a project switch left). */
export const isUnsavedTab = (tab: TabState): boolean => tab.dirty || (tab.file === null && !isBlankTab(tab))

export const blankTabs = (s: EditorState): ReadonlyArray<string> => tabsWhere(s, isBlankTab)

/** Whether this window must pick a project before anything else (docs/DESKTOP.md § Other windows). */
export const isChooserRequired = (s: Pick<EditorState, "project">): boolean => s.project?.chooserRequired === true

/** Whether a modal is up, so the editor's keys are off. */
export const isModalOpen = (s: Pick<EditorState, "dialog" | "project">): boolean =>
  s.dialog !== null || isChooserRequired(s)

/** The window's title on desktop: the project; null without a project state. */
export const projectTitleOf = (s: Pick<EditorState, "project">): string | null =>
  s.project === null ? null : s.project.current?.name ?? "Untitled Project"

/** Whether the window's title carries the unsaved dot: a tab has edits. */
export const projectUnsavedOf = (s: EditorState): boolean => s.project !== null && dirtyTabs(s).length > 0

/** The OS window's title with nothing open in it: the start screen's, and the page's until it knows better. */
export const APP_TITLE = "Ballest Editor"

/**
 * The OS window's title (docs/DESKTOP.md § Status bar): the project on desktop, so the taskbar and alt-tab tell windows
 * apart, the open map in a browser, which has no project, and marked while there are edits to save. The start screen
 * has neither.
 */
export const windowTitleOf = (s: EditorState): string => {
  if (isChooserRequired(s)) return APP_TITLE
  const unsaved = s.project === null ? s.dirty : projectUnsavedOf(s)
  return `${unsaved ? "• " : ""}${projectTitleOf(s) ?? tabLabelOf(s)} – ${APP_TITLE}`
}

export const tabLabels = (s: EditorState): ReadonlyArray<string> =>
  s.tabIds.flatMap((id) => {
    const tab = tabStateOf(s, id)
    return tab === undefined ? [] : [tabLabelOf(tab)]
  })

/** A map's name as its tab and the title bar show it: its file's, else the name inside it. */
export const tabLabelOf = (tab: TabState): string => {
  if (tab.document.kind === "prefab") return tab.document.name
  return tab.file === null
    ? tab.doc.map.worldSettings.levelData.levelDisplayName.trim() || "Untitled"
    : mapLabelOf(tab.file.name)
}

export const tabWithPrefab = (s: EditorState, ref: PrefabRef): string | undefined =>
  tabsWhere(s, ({ document }) => document.kind === "prefab" && isSamePrefab(document, ref))[0]

/** A document and the selection that goes with it. */
interface DocState {
  readonly doc: Doc
  readonly selectedIds: Selection
}

/** The doc without the items at `indices`. */
const withoutItems = (doc: Doc, indices: ReadonlyArray<number>): Doc => {
  const removed = new Set(indices)
  return {
    map: removeItems(doc.map, indices),
    ids: doc.ids.filter((_, i) => !removed.has(i)),
    structure: withoutKeys(doc.structure, new Set(indices.flatMap((i) => doc.ids[i] ?? [])))
  }
}

/** The items at `indices`, in that order, with what the doc holds of them. */
const clipOf = (doc: Doc, indices: ReadonlyArray<number>): DocClip => {
  const keys = indices.flatMap((i) => doc.ids[i] ?? [])
  return { ...copyItems(doc.map, indices), keys, structure: copyStructure(doc.structure, new Set(keys)) }
}

/** The entered group, while it is still in `doc`'s tree. */
const keptEnteredGroup = (doc: Doc, id: string | null): string | null =>
  id !== null && findGroup(doc.structure.tree, id) !== undefined ? id : null

/** A doc's map as the game gets it: its groups are the projection of the structure (docs/FORMAT.md § Groups). */
export const gameMapOf = (doc: Doc, catalog: CatalogIndex | null): MapFile =>
  withGameGroups(doc.map, doc.ids, doc.structure.tree, catalog)

const INVALID_TRANSFORM = "That transform isn't valid for the game (non-finite or zero rotation)."

const sameVec = (a: Vec3, b: Vec3) => a.x === b.x && a.y === b.y && a.z === b.z

const samePivot = (a: Pivot, b: Pivot) => a.choice === b.choice && sameVec(a.localPosition, b.localPosition)

/** True when item `index` has the same transform in both maps (an edit that changed nothing). */
const sameItemTransform = (before: MapFile, after: MapFile, index: number): boolean => {
  const itemBefore = before.items[index]
  const itemAfter = after.items[index]
  if (itemBefore === undefined || itemAfter === undefined) return false
  const a = editTransform(itemBefore)
  const b = editTransform(itemAfter)
  const qa = a.rotation
  const qb = b.rotation
  return sameVec(a.translation, b.translation) && sameVec(a.scale3D, b.scale3D) &&
    qa.x === qb.x && qa.y === qb.y && qa.z === qb.z && qa.w === qb.w
}

/** A drag or scrub is showing values that aren't committed yet; undo and redo wait for it. */
const interacting = (s: EditorState) => s.preview !== null || s.lightingPreview !== null

const sameLighting = (a: Lighting, b: Lighting) =>
  a.timeOfDay === b.timeOfDay && a.brightness === b.brightness && a.angle === b.angle

/**
 * The selection after clicking the items `ids` (none: empty space). A plain click selects just those, or clears; adding
 * keeps the rest and makes them the active end; toggling removes them when all are selected, else adds them. Clicking
 * empty space with a modifier leaves the selection alone.
 */
export const nextSelection = (current: Selection, ids: ReadonlyArray<string>, mode: SelectMode): Selection => {
  if (mode === "replace") return ids
  if (ids.length === 0) return current
  const clicked = new Set(ids)
  const rest = current.filter((x) => !clicked.has(x))
  return mode === "toggle" && rest.length === current.length - clicked.size ? rest : [...rest, ...ids]
}

/** Each key's place in `ids`, kept per array: a group's selection can be thousands of items. */
const keyIndices = new WeakMap<ReadonlyArray<string>, ReadonlyMap<string, number>>()

const keyIndicesOf = (ids: ReadonlyArray<string>): ReadonlyMap<string, number> => {
  const known = keyIndices.get(ids)
  if (known !== undefined) return known
  const indices = new Map(ids.map((id, i) => [id, i] as const))
  keyIndices.set(ids, indices)
  return indices
}

/** An item's place in `ids`; -1 for a key that isn't there. */
const indexOfKey = (ids: ReadonlyArray<string>, key: string): number => keyIndicesOf(ids).get(key) ?? -1

/** The box around the items at `keys` where they show, which is ahead of the document during a continuous edit. */
export const groupBoxOf = (
  { catalogIndex, doc, preview }: Pick<EditorState, "catalogIndex" | "doc" | "preview">,
  keys: ReadonlyArray<string>
) =>
  placedBoxOf(
    keys.flatMap((key) => {
      const item = doc.map.items[indexOfKey(doc.ids, key)]
      return item === undefined ? [] : [{ item, transform: preview?.get(key) ?? editTransform(item) }]
    }),
    catalogIndex
  )

/** Document indices of the selected items, in selection order. */
export const selectedIndices = (s: EditorState): Array<number> =>
  s.selectedIds.map((id) => indexOfKey(s.doc.ids, id)).filter((i) => i >= 0)

/** The names of the map's items and groups, by key and id, with their ordinals apart so they can be styled. */
export const nodeNamesOf = (s: Pick<EditorState, "doc" | "catalogIndex">): ReadonlyMap<string, NumberedName> =>
  new Map([
    ...itemNames(s.doc.map, s.doc.ids, s.doc.structure.items, s.catalogIndex),
    ...groupNames(s.doc.structure.tree)
  ])

/** The active (last selected) item's id, if any. */
export const activeId = (s: EditorState): string | undefined => s.selectedIds.at(-1)

/** The sun as shown: the live preview, else the document. */
export const shownLighting = (s: EditorState): Lighting => s.lightingPreview ?? lightingOf(s.doc.map.worldSettings)

/** An item's pivot (Default when it has none, or isn't in the document). */
export const pivotOf = (s: EditorState, id: string): Pivot => pivotAt(s.doc.map, indexOfKey(s.doc.ids, id))

/** An item's edit transform (see domain/editTransform.ts) as shown: the live preview, else the document. */
export const shownTransform = (s: EditorState, id: string): UeTransform | undefined => {
  const preview = s.preview?.get(id)
  if (preview !== undefined) return preview
  const item = s.doc.map.items[indexOfKey(s.doc.ids, id)]
  return item === undefined ? undefined : editTransform(item)
}

/** Edit transforms as the game would take them, so a drag stops at a decal's limits as it happens. */
export const fitTransforms = (
  s: EditorState,
  transforms: ReadonlyMap<string, UeTransform>
): ReadonlyMap<string, UeTransform> =>
  new Map([...transforms].map(([id, t]) => {
    const item = s.doc.map.items[indexOfKey(s.doc.ids, id)]
    return [id, item === undefined ? t : fitEditTransform(item, t, pivotOf(s, id).localPosition)] as const
  }))

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

/** Tab `tabId`'s name, whether it shows as unsaved or is blank, and its file (name and path), for its tab. */
export const useTabSummary = (tabId: string) =>
  useEditor(useShallow((s) => {
    const tab = tabStateOf(s, tabId)
    return {
      label: tab === undefined ? "" : tabLabelOf(tab),
      unsaved: tab !== undefined && isUnsavedTab(tab),
      blank: tab !== undefined && isBlankTab(tab),
      path: tab?.file?.path ?? null,
      // the name of a map's file, which the tab's menu acts on; a definition's is the Prefabs panel's
      fileName: tab?.document.kind === "map" ? tab.file?.name ?? null : null,
      prefabTier: tab?.document.kind === "prefab" ? tab.document.tier : null
    }
  }))

/** The definition in the active tab, if that's what it holds: what Export and Play are off for. */
export const useOpenPrefab = (): PrefabDocument | null =>
  useEditor((s) => s.document.kind === "prefab" ? s.document : null)

/** Whether the project map `fileName` is open in a tab with unsaved edits. */
export const useHasUnsavedEdits = (fileName: string): boolean =>
  useEditor((s) => {
    const tabId = tabWithFile(s, fileName)
    return tabId !== undefined && tabStateOf(s, tabId)?.dirty === true
  })
