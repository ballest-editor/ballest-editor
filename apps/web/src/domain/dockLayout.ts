import { Schema } from "effect"

/**
 * The dock's saved layout and the rules for reading it back (docs/DESKTOP.md § Dock). No dockview here: a layout is the
 * JSON `toJSON` gave, read only as far as these rules need.
 */

/** index.html reads this key's `hint` before first paint; keep the two in step. */
export const DOCK_STORAGE_KEY = "ballest-editor.dock.v1"

/** The centre group's own panel: the map tabs and the viewport. It has no dockview tab and can't be closed or moved. */
export const DOCUMENTS_PANEL = "documents"

/** The one side of the centre a panel starts on. */
export type DockLocation = "left" | "right" | "bottom"

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

const isLayout = (layout: Readonly<Record<string, unknown>>): layout is typeof layout & DockLayout => {
  const { grid, panels } = layout
  return isObject(panels) && isObject(grid) && isGridNode(grid["root"]) && grid["root"].type === "branch"
}

/** The saved dock, or null when there is none or it can't be read: the caller falls back to the default layout. */
export const parseSavedDock = (text: string | null): SavedDock | null => {
  if (text === null) return null
  const decoded = decodeSavedDock(text)
  if (decoded._tag === "None") return null
  const { layout } = decoded.value
  return isLayout(layout) ? { ...decoded.value, layout } : null
}

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
const axisAlong = (orientation: Orientation): CollapsedGroup["axis"] =>
  orientation === "HORIZONTAL" ? "width" : "height"

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
  return roomLeft ? axisAlong(found.orientation) : null
}

/** Which way group `groupId` lies against the centre group, if it's directly beside it. */
export const axisBesideCentre = (grid: DockLayout["grid"], groupId: string): CollapsedGroup["axis"] | null => {
  const found = parentOf(grid.root, grid.orientation, groupId)
  const beside = found?.branch.data.some((node) => node.type === "leaf" && node.data.views.includes(DOCUMENTS_PANEL))
  return found !== null && beside === true ? axisAlong(found.orientation) : null
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

/** `layout` for a window of a different size, the viewport taking the difference. `fromJSON` gives it to the last view. */
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
  for (const [index, node] of branch.data.entries()) {
    if (node.type === "branch") {
      const redocked = redock(node, popout)
      if (redocked !== null) return { ...branch, data: branch.data.with(index, redocked) }
    } else if (node.data.id === popout.gridReferenceGroup) {
      const { visible: _hidden, ...shown } = node
      const docked: GridLeaf = {
        ...shown,
        data: {
          ...node.data,
          views: [...node.data.views, ...popout.data.views],
          ...(popout.data.activeView !== undefined && { activeView: popout.data.activeView })
        }
      }
      const data = branch.data.with(index, docked)
      // A group that went hidden gave its room to its neighbours.
      return { ...branch, data: node.visible === false ? takeRoom(data, index, node.size) : data }
    }
  }
  return null
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

/** `leaf` with only the panels in `keep`, or null when none of its panels are left. */
const keptLeaf = (leaf: GridLeaf, keep: ReadonlySet<string>): GridLeaf | null => {
  const views = leaf.data.views.filter((id) => keep.has(id))
  if (views.length === leaf.data.views.length) return leaf
  if (views.length === 0) return null
  // with its active panel gone, dockview shows the group's last one
  const { activeView, ...data } = leaf.data
  const stillActive = activeView !== undefined && views.includes(activeView)
  return { ...leaf, data: { ...data, views, ...(stillActive && { activeView }) } }
}

const lengthOf = (nodes: ReadonlyArray<GridNode>): number => nodes.reduce((length, node) => length + node.size, 0)

/** `branch` with only the panels in `keep`: the room of a group that goes goes to the viewport, or failing that the largest. */
const keptBranch = (branch: GridBranch, orientation: Orientation, keep: ReadonlySet<string>): GridBranch => {
  const data = branch.data.flatMap((node): ReadonlyArray<GridNode> => {
    if (node.type === "leaf") return [keptLeaf(node, keep)].filter((leaf) => leaf !== null)
    const inner = keptBranch(node, crosswise(orientation), keep).data
    const [only] = inner
    if (only === undefined) return []
    if (inner.length > 1) return [{ ...node, data: inner }]
    // Dockview leaves no branch of one: what's left takes its place, and a branch's children lie along this one.
    return only.type === "branch" ? only.data : [{ ...only, size: node.size }]
  })
  const room = lengthOf(branch.data) - lengthOf(data)
  const kept = { ...branch, data }
  if (room === 0 || data.length === 0) return kept
  if (!data.some(holdsDocuments)) return { ...kept, data: takeRoom(data, -1, -room) }
  return orientation === "HORIZONTAL" ? growCentre(kept, orientation, room, 0) : growCentre(kept, orientation, 0, room)
}

/** `layout` with only the panels in `keep`: one the app no longer has goes without leaving a gap. */
export const onlyPanels = (layout: DockLayout, keep: ReadonlyArray<string>): DockLayout => {
  const kept = new Set(keep)
  const panels = Object.fromEntries(Object.entries(layout.panels).filter(([id]) => kept.has(id)))
  const root = keptBranch(layout.grid.root, layout.grid.orientation, kept)
  return { ...layout, grid: { ...layout.grid, root }, panels }
}

/**
 * A saved layout with no popouts in it, as the windows don't come back on launch (docs/DESKTOP.md § Dock). Each goes back
 * to the group it left, and a panel whose group is gone is `loose`, for the caller to place.
 */
export const dockedPopouts = (
  { popoutGroups, ...layout }: DockLayout
): { readonly layout: DockLayout; readonly loose: ReadonlyArray<string> } => {
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
