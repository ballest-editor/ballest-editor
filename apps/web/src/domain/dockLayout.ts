import { Schema } from "effect"

/**
 * The dock's saved layout and the rules for reading it back (docs/DESKTOP.md § Dock). No dockview here: a layout is the
 * JSON `toJSON` gave, read only as far as these rules need.
 */

/** index.html reads this key's `hint` before first paint; keep the two in step. */
export const DOCK_STORAGE_KEY = "ballest-editor.dock.v1"

/** The centre group's own panel: the map tabs and the viewport. It has no dockview tab and can't be closed or moved. */
export const DOCUMENTS_PANEL = "documents"

/** The one side of the centre a panel starts on, or `centre`: a tab beside the maps. */
export type DockLocation = "left" | "right" | "bottom" | "centre"

/** What the layout rules need to know of a panel; `components/dock/panels.tsx` adds its component. */
export interface DockPanelSpec {
  readonly id: string
  readonly title: string
  readonly location: DockLocation
  /** Closed until asked for (Settings). Otherwise a panel starts open, in a default layout or a saved one from before it existed. */
  readonly startsClosed?: boolean
}

/** A group folded down to its tab strip along `axis`; `size` is what expanding it gives back. */
export interface CollapsedGroup {
  readonly axis: "width" | "height"
  readonly size: number
}

const SavedDockSchema = Schema.Struct({
  /** What dockview's `toJSON` gave, kept whole for `fromJSON`, which is the judge of it past `isLayout`. */
  layout: Schema.Record(Schema.String, Schema.Unknown),
  /** The panels that existed when this was saved: one in the registry but not here is new, not closed by the user. */
  known: Schema.Array(Schema.String),
  /** Pixels around the centre group, so the skeleton's first paint matches the layout. */
  hint: Schema.Struct({ left: Schema.Finite, right: Schema.Finite, bottom: Schema.Finite }),
  collapsed: Schema.Record(
    Schema.String,
    Schema.Struct({ axis: Schema.Literals(["width", "height"]), size: Schema.Finite })
  )
})

/** The parts of dockview's serialized layout these rules read. */
export interface DockLayout {
  readonly grid: {
    readonly root: GridBranch
    readonly orientation: Orientation
    readonly width: number
    readonly height: number
  }
  readonly panels: Readonly<Record<string, unknown>>
  readonly popoutGroups?: ReadonlyArray<PopoutEntry>
}

export type SavedDock = Omit<typeof SavedDockSchema.Type, "layout"> & { readonly layout: DockLayout }

const decodeSavedDock = Schema.decodeUnknownOption(Schema.fromJsonString(SavedDockSchema))

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

/** A NaN size saves as null, and dockview would lay such a grid out on top of itself without complaint. */
const isGridNode = (value: unknown): value is GridNode => {
  if (!isObject(value) || typeof value["size"] !== "number") return false
  const { type, data } = value
  if (type === "branch") return Array.isArray(data) && data.every(isGridNode)
  return type === "leaf" && isObject(data) && typeof data["id"] === "string" && Array.isArray(data["views"])
}

const isLayout = (
  layout: Readonly<Record<string, unknown>>
): layout is Readonly<Record<string, unknown>> & DockLayout => {
  const { grid, panels } = layout
  return isObject(panels) && isObject(grid) && isObject(grid["root"]) && grid["root"]["type"] === "branch" &&
    isGridNode(grid["root"])
}

/** The saved dock, or null when there is none or it can't be read: the caller falls back to the default layout. */
export const parseSavedDock = (text: string | null): SavedDock | null => {
  if (text === null) return null
  const decoded = decodeSavedDock(text)
  if (decoded._tag === "None") return null
  const { layout } = decoded.value
  return isLayout(layout) ? { ...decoded.value, layout } : null
}

/** Panels to add to a saved layout on load: new since it was saved, and open by default. */
export const newPanels = <P extends DockPanelSpec>(panels: ReadonlyArray<P>, known: ReadonlyArray<string>): Array<P> =>
  panels.filter((panel) => panel.startsClosed !== true && !known.includes(panel.id))

type Orientation = "HORIZONTAL" | "VERTICAL"
interface GridLeaf {
  readonly type: "leaf"
  readonly data: {
    readonly id: string
    readonly views: ReadonlyArray<string>
    readonly activeView?: string
    readonly headerPosition?: string
  }
  readonly size: number
  readonly visible?: boolean
}
interface GridBranch {
  readonly type: "branch"
  readonly data: ReadonlyArray<GridNode>
  readonly size: number
}
type GridNode = GridLeaf | GridBranch

const crosswise = (orientation: Orientation): Orientation => orientation === "HORIZONTAL" ? "VERTICAL" : "HORIZONTAL"

const parentOf = (
  branch: GridBranch,
  orientation: Orientation,
  groupId: string
): { readonly branch: GridBranch; readonly orientation: Orientation } | null => {
  for (const node of branch.data) {
    if (node.type === "leaf") {
      if (node.data.id === groupId) return { branch, orientation }
    } else {
      const found = parentOf(node, crosswise(orientation), groupId)
      if (found !== null) return found
    }
  }
  return null
}

/**
 * Which way group `groupId` folds: along its parent's axis, the way its neighbours can take up its room. Null when they
 * can't, because it's alone in its branch or they're folded already (`collapsedIds`).
 */
export const collapseAxis = (
  grid: DockLayout["grid"],
  groupId: string,
  collapsedIds: ReadonlySet<string>
): CollapsedGroup["axis"] | null => {
  const found = parentOf(grid.root, grid.orientation, groupId)
  if (found === null) return null
  const roomLeft = found.branch.data.some((node) =>
    node.type === "branch" || (node.data.id !== groupId && !collapsedIds.has(node.data.id))
  )
  if (!roomLeft) return null
  return found.orientation === "HORIZONTAL" ? "width" : "height"
}

/** Which way group `groupId` lies against the centre group, if it's directly beside it. */
export const axisBesideCentre = (grid: DockLayout["grid"], groupId: string): CollapsedGroup["axis"] | null => {
  const found = parentOf(grid.root, grid.orientation, groupId)
  const beside = found?.branch.data.some((node) => node.type === "leaf" && node.data.views.includes(DOCUMENTS_PANEL))
  if (found === null || beside !== true) return null
  return found.orientation === "HORIZONTAL" ? "width" : "height"
}

const holdsDocuments = (node: GridNode): boolean =>
  node.type === "leaf" ? node.data.views.includes(DOCUMENTS_PANEL) : node.data.some(holdsDocuments)

/** `branch` with the centre's path through it `width` or `height` bigger, starting with a branch of `orientation`. */
const growCentre = (branch: GridBranch, orientation: Orientation, width: number, height: number): GridBranch => ({
  ...branch,
  data: branch.data.map((node) => {
    if (!holdsDocuments(node)) return node
    const grown = { ...node, size: node.size + (orientation === "HORIZONTAL" ? width : height) }
    return grown.type === "leaf" ? grown : growCentre(grown, crosswise(orientation), width, height)
  })
})

/**
 * `layout` for a window of a different size: the viewport makes up the difference and the panels keep theirs, as when
 * the window is resized. `fromJSON` would give it to whichever view comes last.
 */
export const fitToWindow = (layout: DockLayout, width: number, height: number): DockLayout => {
  const { grid } = layout
  if (width <= 0 || height <= 0) return layout
  const root = growCentre(grid.root, grid.orientation, width - grid.width, height - grid.height)
  return { ...layout, grid: { ...grid, root, width, height } }
}

/** `nodes` with `room` taken from the largest of them that isn't at `index`, to make room for the one that is. */
const takeRoom = (nodes: ReadonlyArray<GridNode>, index: number, room: number): ReadonlyArray<GridNode> => {
  const sizes = nodes.map((node, at) => at === index ? -Infinity : node.size)
  const largest = sizes.indexOf(Math.max(...sizes))
  return nodes.map((node, at) => at === largest ? { ...node, size: node.size - room } : node)
}

interface PopoutEntry {
  /** The group the popped-out panel left, which stays hidden in the grid when it left it empty. */
  readonly gridReferenceGroup?: string
  readonly data: { readonly views: ReadonlyArray<string>; readonly activeView?: string }
}

/** `branch` with `popout`'s panels back in the group they left; null when that group is gone. */
const redock = (branch: GridBranch, popout: PopoutEntry): GridBranch | null => {
  const index = branch.data.findIndex((node) => node.type === "leaf" && node.data.id === popout.gridReferenceGroup)
  if (index === -1) {
    for (const [at, node] of branch.data.entries()) {
      const redocked = node.type === "branch" ? redock(node, popout) : null
      if (redocked !== null) return { ...branch, data: branch.data.with(at, redocked) }
    }
    return null
  }
  const leaf = branch.data[index]
  if (leaf?.type !== "leaf") return null
  const { visible: _hidden, ...shown } = leaf
  const docked: GridLeaf = {
    ...shown,
    data: {
      ...leaf.data,
      views: [...leaf.data.views, ...popout.data.views],
      ...(popout.data.activeView !== undefined && { activeView: popout.data.activeView })
    }
  }
  const data = branch.data.with(index, docked)
  // A group that went hidden gave its room to its neighbours.
  return { ...branch, data: leaf.visible === false ? takeRoom(data, index, leaf.size) : data }
}

const unfolded = (branch: GridBranch, collapsed: SavedDock["collapsed"]): GridBranch => {
  let nodes = branch.data
  for (const [index, node] of branch.data.entries()) {
    if (node.type === "branch") {
      nodes = nodes.with(index, unfolded(node, collapsed))
      continue
    }
    const fold = collapsed[node.data.id]
    if (fold === undefined) continue
    const { headerPosition: _rotated, ...data } = node.data
    nodes = takeRoom(nodes.with(index, { ...node, data, size: fold.size }), index, fold.size - node.size)
  }
  return { ...branch, data: nodes }
}

/**
 * `layout` with its collapsed groups at their full size. Dockview doesn't save a group's constraints, so a folded one
 * would load at its panels' minimum and squeeze its neighbours: it loads whole, and is folded again once it's in.
 */
export const unfoldedLayout = (layout: DockLayout, collapsed: SavedDock["collapsed"]): DockLayout => ({
  ...layout,
  grid: { ...layout.grid, root: unfolded(layout.grid.root, collapsed) }
})

/** A saved layout with its panels' windows gone: `layout` has what went back in the grid, `loose` the rest. */
export interface DockedLayout {
  readonly layout: DockLayout
  readonly loose: ReadonlyArray<string>
}

/**
 * A saved layout with no popouts in it. The windows don't come back on launch: a browser blocks a window nobody clicked
 * for, and dockview then loses the panels. A normal close docks them first, but a crash or a closed tab saves them
 * popped out. Each goes back to the group it left, and a panel whose group is gone is `loose`, for the caller to place.
 */
export const dockedPopouts = ({ popoutGroups, ...layout }: DockLayout): DockedLayout => {
  let { root } = layout.grid
  const loose: Array<string> = []
  for (const popout of popoutGroups ?? []) {
    const redocked = redock(root, popout)
    if (redocked === null) loose.push(...popout.data.views)
    else root = redocked
  }
  const panels = Object.fromEntries(Object.entries(layout.panels).filter(([id]) => !loose.includes(id)))
  return { layout: { ...layout, grid: { ...layout.grid, root }, panels }, loose }
}
