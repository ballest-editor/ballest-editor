import type { DockviewApi, DockviewGroupPanel, IDockviewPanel, SerializedDockview } from "dockview-react"
import { useSyncExternalStore } from "react"
import {
  axisBesideCentre,
  collapseAxis,
  type CollapsedGroup,
  DOCK_STORAGE_KEY,
  dockedPopouts,
  type DockLayout,
  type DockLocation,
  DOCUMENTS_PANEL,
  fitToWindow,
  onlyPanels,
  parseSavedDock,
  unfoldedLayout
} from "../../domain/dockLayout"
import { useEditor } from "../../editor/store"
import type { DockPanel } from "./panels"
import { type PanelSlot, parseSavedSlots, reopenIndex, slotAt } from "./panelSlots"
import { adoptPopoutWindow } from "./popoutWindow"

/** A column by the viewport folds to the rail dock.css draws, a group in a stack to its strip (dock.css). */
const FOLDED_SIZE = { width: 28, height: 28 }
const SIDE_SIZES: Record<DockLocation, number> = { left: 260, right: 300, bottom: 240 }
const MIN_VIEWPORT = { width: 320, height: 200 }
const MIN_GROUP = { width: 180, height: 120 }
const MIN_POPOUT = { width: 320, height: 360 }
const SAVE_DELAY_MS = 250

type Axis = CollapsedGroup["axis"]

let dock: DockviewApi | null = null
/** The panel registry, handed over by `Dock`: this module is in the page's first chunk, and the panels aren't. */
let dockPanels: ReadonlyArray<DockPanel> = []
let stopFollowing = () => {}
/** Folded groups by id. Saved with the layout: dockview keeps their size and header position, not what they were. */
const collapsed = new Map<string, CollapsedGroup>()
/** Closed panels' places by panel id, saved with the layout. A group that goes takes its slots with it. */
const slots = new Map<string, PanelSlot>()
let saveTimer: ReturnType<typeof setTimeout> | undefined

let openPanels: ReadonlySet<string> = new Set()
/** What renders from the dock: the View menus' checks, and whatever shows a group folded. */
const dockListeners = new Set<() => void>()
const notifyDock = () => {
  for (const listener of dockListeners) listener()
}

const centreGroupOf = (api: DockviewApi): DockviewGroupPanel | undefined => api.getPanel(DOCUMENTS_PANEL)?.group

export const isCentreGroup = (group: DockviewGroupPanel): boolean =>
  group.panels.some((panel) => panel.id === DOCUMENTS_PANEL)

const panelOptions = (panel: DockPanel) => ({
  id: panel.id,
  component: panel.id,
  title: panel.title,
  renderer: panel.renderer ?? "onlyWhenVisible" as const,
  minimumWidth: panel.minimumWidth ?? MIN_GROUP.width,
  minimumHeight: MIN_GROUP.height
})

/** A panel docked at `panel`'s location, which it would join. */
const siblingOf = (api: DockviewApi, panel: DockPanel): IDockviewPanel | undefined =>
  dockPanels
    .filter((other) => other.location === panel.location && other.id !== panel.id)
    .map((other) => api.getPanel(other.id))
    .find((other) => other?.api.location.type === "grid")

/** Adds `panel` where it belongs: with the panels of its location if any are docked, else beside the centre. */
const addPanel = (api: DockviewApi, panel: DockPanel, inactive = false): IDockviewPanel | null => {
  const centre = centreGroupOf(api)
  if (centre === undefined) return null
  const { location } = panel
  const sibling = siblingOf(api, panel)
  if (sibling !== undefined) {
    const index = reopenIndex(slots, panel.id, sibling.group.id, sibling.group.panels.length)
    return api.addPanel({ ...panelOptions(panel), inactive, position: { referencePanel: sibling, index } })
  }
  const size = location === "bottom" ? { initialHeight: SIDE_SIZES.bottom } : { initialWidth: SIDE_SIZES[location] }
  return api.addPanel({ ...panelOptions(panel), ...size, position: { referenceGroup: centre, direction: location } })
}

/** Each location's panels in registry order, the first in front: the rest join its group behind it. */
const addDefaultPanels = (api: DockviewApi) => {
  for (const panel of dockPanels) addPanel(api, panel, true)
  const documents = api.getPanel(DOCUMENTS_PANEL)
  if (documents !== undefined) documents.group.api.setActive()
}

const defaultLayout = (api: DockviewApi) => {
  api.clear()
  collapsed.clear()
  slots.clear()
  const documents = api.addPanel({
    id: DOCUMENTS_PANEL,
    component: DOCUMENTS_PANEL,
    tabComponent: "hidden",
    title: "Maps",
    renderer: "onlyWhenVisible",
    minimumWidth: MIN_VIEWPORT.width,
    minimumHeight: MIN_VIEWPORT.height
  })
  giveResizesToCentre(documents.group)
  addDefaultPanels(api)
}

const readSaved = (): string | null => {
  try {
    return localStorage.getItem(DOCK_STORAGE_KEY)
  } catch {
    return null
  }
}

/** The saved layout onto `api`. False when there is none, or it doesn't hold together: `api` then needs the default. */
const restoreSaved = (api: DockviewApi): boolean => {
  const text = readSaved()
  const saved = parseSavedDock(text)
  if (saved === null) return false
  const { layout, loose } = dockedPopouts(unfoldedLayout(saved.layout, saved.collapsed))
  const current = onlyPanels(layout, [DOCUMENTS_PANEL, ...dockPanels.map((panel) => panel.id)])
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- it's dockview's own JSON, and fromJSON judges it
    api.fromJSON(fitToWindow(current, api.width, api.height) as unknown as SerializedDockview)
  } catch (error) {
    console.warn("The saved panel layout doesn't load, so the default one is used.", error)
    return false
  }
  const centre = centreGroupOf(api)
  if (centre === undefined) return false
  giveResizesToCentre(centre)
  collapsed.clear()
  for (const [id, { axis }] of Object.entries(saved.collapsed)) {
    const group = api.groups.find((candidate) => candidate.id === id)
    if (group !== undefined) fold(group, axis)
  }
  slots.clear()
  for (const [id, slot] of parseSavedSlots(text)) {
    if (api.getPanel(id) === undefined && api.groups.some((group) => group.id === slot.group)) slots.set(id, slot)
  }
  const lost = dockPanels.filter((panel) => loose.includes(panel.id))
  const added = dockPanels.filter((panel) => !saved.known.includes(panel.id))
  for (const panel of [...lost, ...added]) addPanel(api, panel, true)
  return true
}

/** The space around the centre group, for the skeleton (`--dock-*`, see index.html). */
const hintOf = (centre: DockviewGroupPanel) => {
  const outer = centre.element.closest(".dockview-theme-ballest")?.getBoundingClientRect()
  const inner = centre.element.getBoundingClientRect()
  if (outer === undefined) return { left: 0, right: 0, bottom: 0 }
  return {
    left: Math.round(inner.left - outer.left),
    right: Math.round(outer.right - inner.right),
    bottom: Math.round(outer.bottom - inner.bottom)
  }
}

const save = (api: DockviewApi) => {
  const centre = centreGroupOf(api)
  if (centre === undefined || api.width === 0) return
  try {
    localStorage.setItem(
      DOCK_STORAGE_KEY,
      JSON.stringify({
        layout: api.toJSON(),
        known: dockPanels.map((panel) => panel.id),
        hint: hintOf(centre),
        collapsed: Object.fromEntries(collapsed),
        slots: Object.fromEntries(slots)
      })
    )
  } catch (error) {
    console.warn("The panel layout couldn't be saved.", error)
  }
}

const notifyOpenPanels = (api: DockviewApi) => {
  openPanels = new Set(api.panels.map((panel) => panel.id))
  notifyDock()
}

const sizeAlong = (group: DockviewGroupPanel, axis: Axis, size: number, min: number, max: number) => {
  group.api.setConstraints(
    axis === "width" ? { minimumWidth: min, maximumWidth: max } : { minimumHeight: min, maximumHeight: max }
  )
  group.api.setSize({ [axis]: size })
}

const fold = (group: DockviewGroupPanel, axis: Axis) => {
  collapsed.set(group.id, { axis, size: group[axis] })
  if (axis === "width") {
    group.element.dataset["dockRail"] = ""
    group.api.setHeaderPosition("left")
  }
  sizeAlong(group, axis, FOLDED_SIZE[axis], FOLDED_SIZE[axis], FOLDED_SIZE[axis])
  notifyDock()
}

/**
 * The window grows and shrinks the viewport, not the panels: the splitview gives a resize to its view of high priority.
 * Dockview has no option for a group's priority, but reads `priority` from the group each time, so it's set there.
 */
const giveResizesToCentre = (centre: DockviewGroupPanel) =>
  Object.defineProperty(centre, "priority", { value: "high", configurable: true })

interface GridviewInternals {
  readonly gridview: { remove: (view: unknown, sizing?: { readonly type: string }) => unknown }
}

/**
 * Closing a group's last panel evens out everything beside it, the viewport and every panel the user sized, and without
 * that dockview hands the room to whichever view is last. Neither has an option. This is the one call both come from,
 * so around it the panels get their sizes back and the room goes where a resize does: to the viewport. It reaches into
 * `api`, so a dockview that moves this keeps its own behaviour, which is only worse sizes.
 */
const keepSizesWhenGroupsGo = (api: DockviewApi) => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- private to dockview, and optional in case it moves
  const gridview = (api as unknown as { readonly component?: GridviewInternals }).component?.gridview
  if (gridview === undefined) return
  const remove = gridview.remove.bind(gridview)
  gridview.remove = (view, sizing) => {
    // not a popped-out group's hidden place in the grid: it has no size to keep
    const sides = api.groups.filter((group) => group !== view && !isCentreGroup(group) && group.api.isVisible)
    const sizes = sides.map(({ width, height }) => ({ width, height }))
    const removed = remove(view, sizing?.type === "distribute" ? undefined : sizing)
    sides.forEach((group, i) => {
      const size = sizes[i]
      if (size !== undefined && group.api.location.type === "grid") group.api.setSize(size)
    })
    return removed
  }
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `DockLayout` is the part of this JSON the rules read
const gridOf = (api: DockviewApi) => (api.toJSON() as unknown as DockLayout).grid

/** A panel dropped beside the centre takes its usual room. Dockview would give it half of the viewport. */
const fitBesideCentre = (api: DockviewApi, group: DockviewGroupPanel) => {
  const axis = axisBesideCentre(gridOf(api), group.id)
  if (axis !== null) group.api.setSize({ [axis]: axis === "width" ? SIDE_SIZES.right : SIDE_SIZES.bottom })
}

/** Follows `api`: saves the layout as it changes, keeps the View menu in step, adopts popped-out windows. */
const followDock = (api: DockviewApi): () => void => {
  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => save(api), SAVE_DELAY_MS)
  }
  const popouts = new Map<string, () => void>()
  /** Each strip before a panel closes. Dockview only says a panel went once it has, and by then its place is gone. */
  let strips: ReadonlyArray<{ readonly group: string; readonly panels: ReadonlyArray<string> }> = []
  const flush = () => {
    clearTimeout(saveTimer)
    save(api)
  }
  window.addEventListener("pagehide", flush)
  const stopFollowingStore = useEditor.subscribe((state, previous) => {
    // a dialog shows in the main window, even when a popped-out panel asked for it
    if (state.dialog !== null && previous.dialog === null) window.focus()
  })
  const listeners = [
    api.onDidLayoutChange(() => {
      scheduleSave()
      // a panel moved or popped out can change the strip a closed one shows in
      notifyDock()
    }),
    api.onWillMutateLayout(({ kind }) => {
      strips = kind === "remove"
        ? api.groups.map(({ id, panels }) => ({ group: id, panels: panels.map((panel) => panel.id) }))
        : []
    }),
    api.onDidAddPanel((panel) => {
      slots.delete(panel.id)
      expandGroup(panel.group)
      notifyOpenPanels(api)
    }),
    api.onDidRemovePanel(({ id }) => {
      const strip = strips.find(({ panels }) => panels.includes(id))
      if (strip !== undefined) {
        slots.set(id, { group: strip.group, index: slotAt(slots, strip.group, strip.panels.indexOf(id)) })
      }
      notifyOpenPanels(api)
    }),
    api.onDidMovePanel(({ panel }) => {
      expandGroup(panel.group)
      if (panel.group.size === 1) fitBesideCentre(api, panel.group)
    }),
    api.onDidRemoveGroup((group) => {
      collapsed.delete(group.id)
      for (const [id, slot] of slots) if (slot.group === group.id) slots.delete(id)
    }),
    api.onDidAddPopoutGroup(({ id, group, window: popout }) => {
      popouts.set(id, adoptPopoutWindow(popout, group.activePanel?.title ?? "Ballest Editor"))
    }),
    api.onDidRemovePopoutGroup(({ id }) => {
      popouts.get(id)?.()
      popouts.delete(id)
    }),
    api.onDidOpenPopoutWindowFail(({ reason }) => {
      useEditor.getState().notify(
        "error",
        reason === "blocked"
          ? "The browser blocked the panel's window. Allow pop-ups for this site, then try again."
          : "The panel's window couldn't be opened."
      )
    }),
    // Nothing that's dragged in the centre group but its panels: the group itself stays.
    api.onWillDragGroup((event) => {
      if (isCentreGroup(event.group)) event.nativeEvent.preventDefault()
    }),
    // The centre takes panels on its sides, never as a tab: one would hide the map.
    api.onWillShowOverlay((event) => {
      const { group } = event
      if (group !== undefined && isCentreGroup(group) && event.position === "center") event.preventDefault()
    })
  ]
  return () => {
    for (const listener of listeners) listener.dispose()
    stopFollowingStore()
    window.removeEventListener("pagehide", flush)
    clearTimeout(saveTimer)
    for (const stop of popouts.values()) stop()
  }
}

/** Takes over a newly mounted dock: the saved layout, or the default one when that's missing or broken. */
export const attachDock = (api: DockviewApi, panels: ReadonlyArray<DockPanel>): void => {
  stopFollowing()
  dock = api
  dockPanels = panels
  if (!restoreSaved(api)) defaultLayout(api)
  keepSizesWhenGroupsGo(api)
  stopFollowing = followDock(api)
  notifyOpenPanels(api)
}

/** View › Reset layout. Only the panels around the centre go: the viewport stays mounted, and so does its scene. */
export const resetDockLayout = (): void => {
  if (dock === null) return
  for (const panel of dock.panels.filter(({ id }) => id !== DOCUMENTS_PANEL)) dock.removePanel(panel)
  collapsed.clear()
  slots.clear()
  addDefaultPanels(dock)
}

/** The View menu's check: closes an open panel, reopens a closed one in front, in the slot it left. */
export const togglePanel = (id: string): void => {
  if (dock === null) return
  const open = dock.getPanel(id)
  const spec = dockPanels.find((panel) => panel.id === id)
  if (open !== undefined) open.api.close()
  else if (spec !== undefined) addPanel(dock, spec)
}

export const popOutPanel = (panel: IDockviewPanel): void => {
  expandGroup(panel.group)
  const { left, top, width, height } = panel.group.element.getBoundingClientRect()
  void dock?.addPopoutGroup(panel, {
    popoutUrl: "/popout.html",
    position: {
      left: window.screenX + left,
      top: window.screenY + top,
      width: Math.max(width, MIN_POPOUT.width),
      height: Math.max(height, MIN_POPOUT.height)
    }
  })
}

const collapseAxisOf = (group: DockviewGroupPanel): Axis | null =>
  dock === null || isCentreGroup(group) || collapsed.has(group.id)
    ? null
    : collapseAxis(gridOf(dock), group.id, new Set(collapsed.keys()))

export const canCollapseGroup = (group: DockviewGroupPanel): boolean => collapseAxisOf(group) !== null

/** Folds `group`, when there's somewhere for its space to go. */
export const collapseGroup = (group: DockviewGroupPanel): void => {
  const axis = collapseAxisOf(group)
  if (axis !== null) fold(group, axis)
}

/** Gives a collapsed `group` its size back. Dockview can't drop a constraint, so its usual ones are set in its place. */
export const expandGroup = (group: DockviewGroupPanel): void => {
  const folded = collapsed.get(group.id)
  if (folded === undefined) return
  collapsed.delete(group.id)
  if (folded.axis === "width") {
    delete group.element.dataset["dockRail"]
    group.api.setHeaderPosition("top")
  }
  sizeAlong(group, folded.axis, folded.size, MIN_GROUP[folded.axis], Number.MAX_SAFE_INTEGER)
  notifyDock()
}

const followDockChanges = (listener: () => void) => {
  dockListeners.add(listener)
  return () => dockListeners.delete(listener)
}

/** The way `group` is folded, if it is, following it. */
export const useGroupFold = (group: DockviewGroupPanel): Axis | undefined =>
  useSyncExternalStore(followDockChanges, () => collapsed.get(group.id)?.axis)

/** A checkbox menu item for panel `id`: checked while it's open anywhere in the dock, and toggling it. */
export const usePanelCheck = (id: string) => ({
  closeOnClick: true,
  checked: useSyncExternalStore(followDockChanges, () => openPanels.has(id)),
  onCheckedChange: () => togglePanel(id)
})

export const useViewMenuPanels = (): ReadonlyArray<DockPanel> =>
  useSyncExternalStore(followDockChanges, () => dockPanels)

/** The panels a group's "…" can bring back: every one that's open nowhere in the dock. */
export const useClosedPanels = (): ReadonlyArray<DockPanel> => {
  const open = useSyncExternalStore(followDockChanges, () => openPanels)
  return useViewMenuPanels().filter((panel) => !open.has(panel.id))
}

/** The strip closed `panel` shows in: the group it would come back to, or the centre's when that's gone or a rail. */
const stripOf = (api: DockviewApi, panel: DockPanel): DockviewGroupPanel | undefined => {
  const group = siblingOf(api, panel)?.group
  return group === undefined || collapsed.get(group.id)?.axis === "width" ? centreGroupOf(api) : group
}

/** The closed panels whose icons `group`'s strip shows. Each closed panel is in one strip, and never a popped-out one. */
export const closedPanelsIn = (group: DockviewGroupPanel): ReadonlyArray<DockPanel> =>
  dockPanels.filter((panel) => !openPanels.has(panel.id) && dock !== null && stripOf(dock, panel) === group)

/** `closedPanelsIn`, following it. It's compared by ids, so a layout change that leaves them alone renders nothing. */
export const useClosedPanelsIn = (group: DockviewGroupPanel): ReadonlyArray<DockPanel> => {
  useSyncExternalStore(followDockChanges, () => closedPanelsIn(group).map(({ id }) => id).join())
  return closedPanelsIn(group)
}
