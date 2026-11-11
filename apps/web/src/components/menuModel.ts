/**
 * The menu bar as data: what each row says, does and why it's off. `MenuBar` draws this, and Help's search lists it, so
 * the two can't drift apart (docs/DESKTOP.md § Menus).
 */
import { type GameMap, type RecentProject, RELEASES_URL } from "@ballest/contracts"
import { useShallow } from "zustand/react/shallow"
import { mapLabelOf } from "../domain/factory"
import { counted, selectedNodes } from "../domain/groupSelection"
import type { KeybindAction } from "../domain/Keybinds"
import { PROJECTION_ACTIONS } from "../domain/Keybinds"
import { termsOf } from "../domain/outline"
import type { SnapConfig } from "../domain/snapConfig"
import { WORLD_PLANES } from "../domain/snapTools"
import { annotationsOf } from "../domain/structure"
import { formatDateTime } from "../domain/time"
import { updateCheckBlockedBy } from "../domain/updates"
import {
  isOrthoView,
  type ViewLayout,
  viewLayoutKinds,
  viewLayoutLabelsOf,
  type ViewProjection,
  viewProjectionLabels,
  viewProjections
} from "../domain/viewLayout"
import { flagStateOf, keysWith } from "../domain/visibility"
import {
  alignSelection,
  checkForUpdates,
  chooseProject,
  clearMeasurements,
  distributeSelection,
  exportToGame,
  gridOriginToSelection,
  gridYawToSelection,
  importGameMap,
  launchGame,
  mirrorAcrossWorld,
  openExternalLink,
  openInGame,
  openRecentInNewWindow,
  quitApp,
  reimportMap,
  selectConnected,
  selectionPrefabProblem,
  startFlush,
  startGridOriginPick,
  startMeasure,
  startMirror,
  startSavePrefab,
  switchProject,
  toggleSnapping
} from "../editor/actions"
import { actionCommands, type CommandAction, lookAlong } from "../editor/commands"
import {
  type EditorState,
  exportProblemOf,
  NO_TAB_OPEN,
  noTabOpen,
  saveProblemOf,
  snapConfigOf,
  useCanGroup,
  useEditor,
  useOpenProjectMap,
  useUpdateState
} from "../editor/store"
import { resetDockLayout, togglePanel, useOpenPanels, useViewMenuPanels } from "./dock/dockControl"

const NOTHING_SELECTED = "Select something first."
const SAVE_PROJECT_FIRST = "Save first: Untitled Project has no folder to import into."
const EXPORT_FIRST = "Export this map first: the game has no copy of it yet."
const NO_RECENT_PROJECTS = "No recent projects yet."

export const MENU_TITLES = ["File", "Edit", "View", "Tools", "Project", "Help"] as const
export type MenuTitle = (typeof MENU_TITLES)[number]

/** What a row is told about how it was picked: Shift opens a recent project in a new window. */
interface Pick {
  readonly shiftKey: boolean
}

/** A row that runs something. */
export interface MenuItem {
  readonly kind: "item"
  readonly label: string
  readonly run: (pick: Pick) => void
  /** Why the row is off; null when it's on. */
  readonly reason: string | null
  /** The action whose primary binding the row shows. */
  readonly shortcut?: KeybindAction
  /** What hovering the row says. */
  readonly title?: string
  /** A quiet word after the label. */
  readonly note?: string
}

/** A row that turns something on or off. */
export interface MenuCheck {
  readonly kind: "check"
  readonly label: string
  readonly checked: boolean
  readonly run: () => void
  /** The action whose primary binding the row shows. */
  readonly shortcut?: KeybindAction
}

/** A named part of a menu whose rows are too different to read as one list. */
export interface MenuSection {
  readonly kind: "section"
  readonly title: string
  readonly children: ReadonlyArray<MenuNode>
}

/** A submenu of items. */
export interface MenuSubmenu {
  readonly kind: "submenu"
  readonly title: string
  /** The line heading the submenu. */
  readonly description: string
  /** Why the submenu is off; null when it's on. */
  readonly reason: string | null
  readonly children: ReadonlyArray<MenuItem | MenuSeparator>
}

export interface MenuOption {
  readonly label: string
  readonly checked: boolean
  readonly run: () => void
  readonly shortcut?: KeybindAction
}

/** A submenu picking one of `options`, under a line saying what it picks when it needs one. */
export interface MenuChoice {
  readonly kind: "choice"
  readonly title: string
  readonly description?: string
  readonly options: ReadonlyArray<MenuOption>
}

export interface MenuSeparator {
  readonly kind: "separator"
}

export type MenuNode = MenuItem | MenuCheck | MenuSection | MenuSubmenu | MenuChoice | MenuSeparator

export type Menus = Readonly<Record<MenuTitle, ReadonlyArray<MenuNode>>>

/** All the model needs to know. */
export interface MenuState {
  readonly capabilities: EditorState["capabilities"]
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly hasSelection: boolean
  readonly canGroup: boolean
  readonly canChain: boolean
  readonly canUngroup: boolean
  readonly canPaste: boolean
  readonly canSelectAll: boolean
  /** Why the selection can't be a prefab, whatever its name. */
  readonly prefabProblem: string | undefined
  /** Why nothing can be saved, else null: no tab open, a definition with too few items (`saveProblemOf`). */
  readonly saveOff: string | null
  /** Why nothing can be exported or played, else null: no tab open, a definition's tab (`exportProblemOf`). */
  readonly exportOff: string | null
  /** The reason every map command is off while no tab is open, else null. */
  readonly noTabOff: string | null
  /** Whether this is Untitled Project, which has no folder to import into yet. */
  readonly untitled: boolean
  /** The maps in the game's maps folder that the project doesn't have yet, newest first. */
  readonly gameMaps: ReadonlyArray<GameMap>
  /** The open map's file when there's an export to take it from. */
  readonly reimportable: string | null
  /** Whether the open map is the one Open in game put in the in-game editor, so the item is Update in game. */
  readonly openedInGame: boolean
  readonly recent: ReadonlyArray<RecentProject>
  readonly openElsewhere: ReadonlyArray<string>
  readonly panels: ReadonlyArray<{ readonly id: string; readonly title: string; readonly open: boolean }>
  /** The active tab's snap settings. */
  readonly snapping: SnapConfig
  /** What the next undo and redo did, when they say. */
  readonly undoDescription: string | undefined
  readonly redoDescription: string | undefined
  /** How many units the selection makes up (a whole group is one), for what needs a few. */
  readonly selectionCount: number
  /** How many measurements the map keeps. */
  readonly measurements: number
  readonly units: "cm" | "m"
  readonly layout: ViewLayout
  /** What the active pane looks along. */
  readonly projection: ViewProjection
  /** The updater's state; null in a browser, which has no updater. */
  readonly update: EditorState["update"]
  /** What hiding, isolating and locking would act on (docs/DESKTOP.md § Hide, isolate and lock). */
  readonly visibility: VisibilityState
}

export interface VisibilityState {
  /** Every selected item is hidden, so hiding the selection shows it. */
  readonly selectionHidden: boolean
  readonly selectionLocked: boolean
  /** How many items are hidden and locked in the map. */
  readonly hidden: number
  readonly locked: number
  readonly isolated: boolean
}

const SEPARATOR: MenuSeparator = { kind: "separator" }

const item = (label: string, run: MenuItem["run"], reason: string | null = null): MenuItem => ({
  kind: "item",
  label,
  run,
  reason
})

/** A row that runs the same command as the action's keybind, and shows that keybind. */
const command = (action: CommandAction, label: string, reason: string | null = null): MenuItem => ({
  ...item(label, () => actionCommands[action](), reason),
  shortcut: action
})

const openDialog: EditorState["openDialog"] = (dialog) => useEditor.getState().openDialog(dialog)

const settingsItem = item("Settings…", () => openDialog({ id: "settings" }))

/**
 * Desktop only: the projects used before, by name (the folder is the hover text). A pick opens here (`switchProject`),
 * Shift+click in a new window. One open in another window says so, and picking it still gets main's refusal, which says
 * what to do.
 */
const recentProjects = ({ recent, openElsewhere }: MenuState): MenuSubmenu => ({
  kind: "submenu",
  title: "Recent projects",
  description: "Shift+click opens in a new window",
  reason: recent.length === 0 ? NO_RECENT_PROJECTS : null,
  children: recent.map((project) => ({
    ...item(
      project.name,
      ({ shiftKey }) => void (shiftKey ? openRecentInNewWindow(project) : switchProject(project.path))
    ),
    title: project.path,
    ...(openElsewhere.includes(project.path) && { note: "Open in another window" })
  }))
})

/**
 * Desktop only: the game's maps the project doesn't have yet, such as ones started in the in-game editor, by name, each
 * copied in linked to the game's file and opened (`importGameMap`), then any file through the open dialog.
 */
const importMapMenu = ({ gameMaps, untitled }: MenuState): MenuSubmenu => ({
  kind: "submenu",
  title: "Import map",
  description: gameMaps.length > 0
    ? "From the game's maps folder, linked to the game's file"
    : "The project has every map in the game's maps folder",
  reason: untitled ? SAVE_PROJECT_FIRST : null,
  children: [
    ...gameMaps.map((map): MenuItem => ({
      ...item(
        map.displayName ?? mapLabelOf(map.fileName),
        () => void importGameMap(map.fileName),
        map.itemCount === null ? "Can't be read as a map." : null
      ),
      title: `${map.fileName}, saved ${formatDateTime(map.modifiedAt)}`,
      ...(map.itemCount !== null && { note: counted(map.itemCount, "item") })
    })),
    ...(gameMaps.length > 0 ? [SEPARATOR] : []),
    command("openMap", "From a file…")
  ]
})

const fileMenu = (state: MenuState): ReadonlyArray<MenuNode> =>
  state.capabilities.projects
    ? [
      command("newMap", "New map"),
      item("New project…", () => openDialog({ id: "newProject" })),
      item("Open project…", () => void chooseProject()),
      recentProjects(state),
      SEPARATOR,
      importMapMenu(state),
      SEPARATOR,
      command("saveMap", "Save", state.saveOff),
      command("closeTab", "Close tab", state.noTabOff),
      SEPARATOR,
      settingsItem,
      SEPARATOR,
      item("Quit", () => void quitApp())
    ]
    : [
      command("newMap", "New map"),
      command("openMap", "Open…"),
      SEPARATOR,
      command("saveMap", "Save", state.saveOff),
      command("saveMapAs", "Export…"),
      command("closeTab", "Close tab"),
      SEPARATOR,
      settingsItem
    ]

/** Undo or Redo, with what the step did when it says. */
const stepLabel = (verb: string, description: string | undefined) =>
  description === undefined ? verb : `${verb} ${description}`

const editMenu = (state: MenuState): ReadonlyArray<MenuNode> => {
  const selectionOff = state.hasSelection ? null : NOTHING_SELECTED
  return [
    command("undo", stepLabel("Undo", state.undoDescription), state.canUndo ? null : "Nothing to undo."),
    command("redo", stepLabel("Redo", state.redoDescription), state.canRedo ? null : "Nothing to redo."),
    SEPARATOR,
    command("cutSelection", "Cut", selectionOff),
    command("copySelection", "Copy", selectionOff),
    command("paste", "Paste", state.noTabOff ?? (state.canPaste ? null : "Copy something first.")),
    command("duplicateSelection", "Duplicate", selectionOff),
    command("deleteSelection", "Delete", selectionOff),
    command("selectAll", "Select all", state.canSelectAll ? null : "Nothing to select."),
    command("deselect", "Deselect", selectionOff),
    SEPARATOR,
    command("groupSelection", "Group", state.canGroup ? null : "Select what to group first."),
    command("chainSelection", "Make chain", state.canChain ? null : "Select what to chain first."),
    command("ungroupSelection", "Ungroup", state.canUngroup ? null : "Select a group first."),
    SEPARATOR,
    item("Save selection as prefab…", startSavePrefab, state.prefabProblem ?? null)
  ]
}

/** How the view divides into panes, and what the active pane looks along (docs/DESKTOP.md § View panes). */
const paneMenus = ({ layout, projection }: MenuState): ReadonlyArray<MenuChoice> => {
  const labels = viewLayoutLabelsOf(layout)
  return [
    {
      kind: "choice",
      title: "Layout",
      description: "Split the viewport, one camera per pane.",
      options: viewLayoutKinds.map((kind) => ({
        label: labels[kind],
        checked: kind === layout.kind,
        run: () => useEditor.getState().setViewLayoutKind(kind)
      }))
    },
    {
      kind: "choice",
      title: "Active pane",
      description: "The view in the pane you last used.",
      options: viewProjections.map((view) => ({
        label: viewProjectionLabels[view],
        checked: view === projection,
        run: () => lookAlong(view),
        shortcut: PROJECTION_ACTIONS[view]
      }))
    }
  ]
}

/** Rolling the active pane's orthographic view (docs/DESKTOP.md § View panes). */
const rollItems = ({ projection }: MenuState): ReadonlyArray<MenuNode> => {
  const off = isOrthoView(projection) ? null : "Only an orthographic view rolls."
  return [
    command("rollViewCounterClockwise", "Roll view counter-clockwise", off),
    command("rollViewClockwise", "Roll view clockwise", off)
  ]
}

/** Hide, isolate and lock, each acting on the selection or the whole map (docs/DESKTOP.md § Hide, isolate and lock). */
const visibilityItems = ({ hasSelection, noTabOff, visibility }: MenuState): ReadonlyArray<MenuNode> => {
  const selected = hasSelection ? null : NOTHING_SELECTED
  return [
    command("hideSelection", visibility.selectionHidden ? "Show selection" : "Hide selection", selected),
    command("showAll", "Show all", noTabOff ?? (visibility.hidden > 0 ? null : "Nothing is hidden.")),
    visibility.isolated
      ? command("isolateSelection", "End isolation")
      : command("isolateSelection", "Isolate selection", noTabOff ?? selected),
    command("lockSelection", visibility.selectionLocked ? "Unlock selection" : "Lock selection", selected),
    command("unlockAll", "Unlock all", noTabOff ?? (visibility.locked > 0 ? null : "Nothing is locked."))
  ]
}

const viewMenu = (state: MenuState): ReadonlyArray<MenuNode> => [
  {
    kind: "section",
    title: "Camera",
    children: [
      command("focusSelection", "Focus selection", state.hasSelection ? null : NOTHING_SELECTED),
      command("frameAll", "Frame all", state.noTabOff)
    ]
  },
  SEPARATOR,
  { kind: "section", title: "Hide and lock", children: visibilityItems(state) },
  SEPARATOR,
  {
    kind: "section",
    title: "Panels",
    children: [
      ...state.panels.map(({ id, title, open }): MenuCheck => ({
        kind: "check",
        label: title,
        checked: open,
        run: () => togglePanel(id)
      })),
      item("Reset layout", resetDockLayout)
    ]
  },
  SEPARATOR,
  { kind: "section", title: "Panes", children: [...paneMenus(state), ...rollItems(state)] },
  SEPARATOR,
  {
    kind: "section",
    title: "Snap",
    children: [
      {
        kind: "check",
        label: "Snapping",
        checked: state.snapping.enabled,
        run: toggleSnapping,
        shortcut: "snapToggle"
      }
    ]
  }
]

/** The tools built on the targets (docs/SNAPPING.md): each takes its points and faces from the one target picker. */
const toolsMenu = (state: MenuState): ReadonlyArray<MenuNode> => {
  const selectionOff = state.hasSelection ? null : NOTHING_SELECTED
  const off = state.noTabOff
  const alignOff = selectionOff ?? (state.selectionCount < 2 ? "Select two or more items first." : null)
  const distributeOff = selectionOff ?? (state.selectionCount < 3 ? "Select three or more items first." : null)
  const axes = ["x", "y", "z"] as const
  const sides = [["min", "Min"], ["centre", "Center"], ["max", "Max"]] as const
  return [
    item("Flush and tangent…", startFlush, off),
    item("Measure…", startMeasure, off),
    item("Clear measurements", clearMeasurements, off ?? (state.measurements === 0 ? "Nothing measured yet." : null)),
    SEPARATOR,
    {
      kind: "submenu",
      title: "Align to active",
      description: "Line the selection up on the active item, the one the gizmo sits on.",
      reason: alignOff,
      children: axes.flatMap((axis) =>
        sides.map(([side, word]) => item(`${axis.toUpperCase()} ${word}`, () => alignSelection(axis, side, "active")))
      )
    },
    {
      kind: "submenu",
      title: "Align to selection bounds",
      description: "Line the selection up on the box around it.",
      reason: alignOff,
      children: axes.flatMap((axis) =>
        sides.map(([side, word]) => item(`${axis.toUpperCase()} ${word}`, () => alignSelection(axis, side, "bounds")))
      )
    },
    {
      kind: "submenu",
      title: "Distribute",
      description: "Spread the selection evenly: the outer two stay, or with a fixed Spacing out from the active item.",
      reason: distributeOff,
      children: axes.flatMap((axis) => [
        item(`${axis.toUpperCase()}: equal gaps`, () => distributeSelection(axis, "gaps")),
        item(`${axis.toUpperCase()}: equal centres`, () => distributeSelection(axis, "centres"))
      ])
    },
    SEPARATOR,
    item("Mirror across a face or plane…", startMirror, selectionOff),
    {
      kind: "submenu",
      title: "Mirror across a world plane",
      description: "A plane through the grid's origin.",
      reason: selectionOff,
      children: WORLD_PLANES.map((plane) => item(plane.toUpperCase(), () => mirrorAcrossWorld(plane)))
    },
    SEPARATOR,
    item("Pick grid origin…", startGridOriginPick, off),
    item("Grid origin to selection", gridOriginToSelection, selectionOff),
    item("Grid rotation to selection", gridYawToSelection, selectionOff),
    SEPARATOR,
    item("Select connected", selectConnected, selectionOff)
  ]
}

const projectMenu = (state: MenuState): ReadonlyArray<MenuNode> => {
  const { exportToGame: canExport, launchGame: canLaunchGame, play: canPlay, projects } = state.capabilities
  const { exportOff } = state
  if (!projects) return [item("Project settings…", () => openDialog({ id: "mapSettings" }), exportOff)]
  const { reimportable } = state
  return [
    command("newMap", "New map"),
    command("saveMapAs", "Duplicate map…", exportOff),
    ...(canExport
      ? [
        item("Export to game", () => void exportToGame(), exportOff),
        item(
          "Re-import from game",
          () => reimportable !== null && void reimportMap(reimportable),
          exportOff ?? (reimportable === null ? EXPORT_FIRST : null)
        ),
        ...(canPlay || canLaunchGame ? [SEPARATOR] : []),
        ...(canPlay
          ? [
            command("playMap", "Play", exportOff),
            item(state.openedInGame ? "Update in game" : "Open in game", () => void openInGame(), exportOff)
          ]
          : []),
        ...(canLaunchGame ? [item("Open game (Steam)", () => void launchGame())] : [])
      ]
      : []),
    SEPARATOR,
    item("Project settings…", () => openDialog({ id: "projectSettings" }))
  ]
}

/** Help, in both builds; a browser has no updater and sends no feedback, so no rows for them. */
const helpMenu = ({ update, capabilities }: MenuState): ReadonlyArray<MenuNode> => [
  // not the keybind's command: that one shows the sheet only while the key is held
  { ...item("Keyboard shortcuts", () => openDialog({ id: "keybinds" })), shortcut: "showKeybinds" },
  SEPARATOR,
  ...(update === null ? [] : [
    item("Check for updates", () => void checkForUpdates(), updateCheckBlockedBy(update)),
    item("Release notes", () => void openExternalLink(RELEASES_URL))
  ]),
  ...(capabilities.feedback ? [item("Send feedback…", () => openDialog({ id: "feedback" }))] : []),
  item("About Ballest Editor", () => openDialog({ id: "about" }))
]

/** File, Edit, View, Project and Help. Every item calls the entry point its keybind or button uses. */
export const menusOf = (state: MenuState): Menus => ({
  File: fileMenu(state),
  Edit: editMenu(state),
  View: viewMenu(state),
  Tools: toolsMenu(state),
  Project: projectMenu(state),
  Help: helpMenu(state)
})

/**
 * The menus as they stand. Call it only from what's mounted while a menu is open: it looks through the selection on
 * every change to it (`selectionPrefabProblem`).
 */
export const useMenus = (): Menus => {
  const canUndo = useEditor((s) => s.past.length > 0 && s.preview === null)
  const canRedo = useEditor((s) => s.future.length > 0 && s.preview === null)
  const hasSelection = useEditor((s) => s.selectedIds.length > 0)
  const { canGroup, canChain, canUngroup } = useCanGroup()
  const canPaste = useEditor((s) => s.clipboard !== null)
  const canSelectAll = useEditor((s) => s.doc.ids.length > 0)
  const prefabProblem = useEditor(selectionPrefabProblem)
  const capabilities = useEditor((s) => s.capabilities)
  const saveOff = useEditor(saveProblemOf)
  const exportOff = useEditor(exportProblemOf)
  const noTabOff = useEditor(noTabOpen) ? NO_TAB_OPEN : null
  const project = useEditor((s) => s.project)
  const gameMaps = useEditor((s) => s.gameMaps)
  // Re-import needs an export to take the map from
  const exportedFile = useOpenProjectMap()?.map
  const reimportable = exportedFile?.link?.export != null ? exportedFile.fileName : null
  const openedInGame = useEditor((s) => s.openedInGame !== null && s.openedInGame === s.file?.name)
  const dockPanels = useViewMenuPanels()
  const openPanels = useOpenPanels()
  const { general } = useEditor((s) => s.settings)
  const snapping = useEditor(snapConfigOf)
  const undoDescription = useEditor((s) => s.past.at(-1)?.description)
  const redoDescription = useEditor((s) => s.future[0]?.description)
  const selectionCount = useEditor((s) => selectedNodes(s.doc.structure.tree, s.selectedIds, s.enteredGroupId).length)
  const measurements = useEditor((s) => annotationsOf(s.doc.structure).measurements.length)
  const layout = useEditor((s) => s.viewLayout)
  const projection = useEditor((s) => s.viewLayout.projections[s.activePane] ?? "perspective")
  const update = useUpdateState()
  const visibility = useEditor(useShallow(visibilityStateOf))
  return menusOf({
    canUndo,
    canRedo,
    hasSelection,
    canGroup,
    canChain,
    canUngroup,
    canPaste,
    canSelectAll,
    prefabProblem,
    capabilities,
    saveOff,
    exportOff,
    noTabOff,
    untitled: project?.current === null,
    gameMaps: gameMaps.filter((map) => map.inProject === null),
    reimportable,
    openedInGame,
    recent: project?.recent ?? [],
    openElsewhere: project?.openElsewhere ?? [],
    panels: dockPanels.map(({ id, title }) => ({ id, title, open: openPanels.has(id) })),
    snapping,
    undoDescription,
    redoDescription,
    selectionCount,
    measurements,
    units: general.units,
    layout,
    projection,
    update,
    visibility
  })
}

/** What the menus say of hiding, isolating and locking in the active tab. */
export const visibilityStateOf = (s: EditorState): VisibilityState => {
  const { structure } = s.doc
  return {
    selectionHidden: s.selectedIds.length > 0 && flagStateOf(structure, s.selectedIds, "hidden") === "all",
    selectionLocked: s.selectedIds.length > 0 && flagStateOf(structure, s.selectedIds, "locked") === "all",
    hidden: keysWith(structure, "hidden").length,
    locked: keysWith(structure, "locked").length,
    isolated: s.isolation !== null
  }
}

/** One row a search can find: the menus' leaves, whatever they are in the menu. */
export interface MenuEntry {
  readonly label: string
  /** The menus and sections it's under, the top menu first. */
  readonly path: ReadonlyArray<string>
  readonly run: MenuItem["run"]
  readonly reason: string | null
  readonly shortcut?: KeybindAction
  /** Whether it's on, for what can be. */
  readonly checked?: boolean
}

const entriesOf = (nodes: ReadonlyArray<MenuNode>, path: ReadonlyArray<string>): ReadonlyArray<MenuEntry> =>
  nodes.flatMap((node): ReadonlyArray<MenuEntry> => {
    switch (node.kind) {
      case "separator":
        return []
      case "item":
        return [{
          label: node.label,
          path,
          run: node.run,
          reason: node.reason,
          ...(node.shortcut !== undefined && { shortcut: node.shortcut })
        }]
      case "check":
        return [{
          label: node.label,
          path,
          run: node.run,
          reason: null,
          checked: node.checked,
          ...(node.shortcut !== undefined && { shortcut: node.shortcut })
        }]
      case "section":
        return entriesOf(node.children, [...path, node.title])
      case "submenu":
        // a submenu that's off has no rows to list, so its title stands in, saying why
        return node.reason === null
          ? entriesOf(node.children, [...path, node.title])
          : [{ label: node.title, path, run: () => {}, reason: node.reason }]
      case "choice":
        return node.options.map((option) => ({
          label: option.label,
          path: [...path, node.title],
          run: option.run,
          reason: null,
          checked: option.checked,
          ...(option.shortcut !== undefined && { shortcut: option.shortcut })
        }))
    }
  })

/** Every row of every menu, in menu order. */
export const menuEntries = (menus: Menus): ReadonlyArray<MenuEntry> =>
  MENU_TITLES.flatMap((title) => entriesOf(menus[title], [title]))

/** How well `entry` answers the terms, best first: its label starts with them, holds them, or its path does. */
const matchRank = (entry: MenuEntry, terms: ReadonlyArray<string>): number | null => {
  const label = entry.label.toLowerCase()
  const haystack = `${entry.path.join(" ")} ${label}`.toLowerCase()
  if (!terms.every((term) => haystack.includes(term))) return null
  if (label.startsWith(terms.join(" "))) return 0
  return terms.every((term) => label.includes(term)) ? 1 : 2
}

/**
 * The entries `query` finds, in menu order within each rank, those that can run first: Enter takes the top one, which
 * is why a row that's off doesn't lead the list.
 */
export const searchMenus = (entries: ReadonlyArray<MenuEntry>, query: string): ReadonlyArray<MenuEntry> => {
  const terms = termsOf(query)
  return entries
    .flatMap((entry) => {
      const rank = matchRank(entry, terms)
      return rank === null ? [] : [{ entry, rank: rank * 2 + (entry.reason === null ? 0 : 1) }]
    })
    .sort((a, b) => a.rank - b.rank)
    .map(({ entry }) => entry)
}
