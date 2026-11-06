/** Spreads palette placements out, so pieces placed from one view don't pile up on one spot. */
import type { Vec3 } from "../../domain/coords"
import { type Box, itemsBoxOf } from "../../domain/itemBounds"
import {
  clearOfBoxes,
  nextInRun,
  type PlacementRun,
  type PlacementView,
  runPoint,
  startPlacementRun,
  wouldLandOn
} from "../../domain/placement"
import { type EditorState, useEditor } from "../store"

/** The run in progress and what the next placement checks it against. */
interface Placing {
  readonly run: PlacementRun
  readonly view: PlacementView
  /** How many items the map held before the latest placement. */
  readonly itemCount: number
  /** The run's first piece; unknown until the placement after it, which is when it is in the map. */
  readonly first: Box | undefined
  /** How far the run's first piece stands from where the view put it, past what was in the way. */
  readonly stepped: Vec3
}

let placing: Placing | undefined

const sameVec = (a: Vec3, b: Vec3) => a.x === b.x && a.y === b.y && a.z === b.z

const sameView = (a: PlacementView, b: PlacementView) =>
  sameVec(a.position, b.position) && sameVec(a.right, b.right) && sameVec(a.up, b.up)

const plus = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const minus = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

/** The box of the piece `last` placed, while that piece is what the map ends on and all that is selected. */
const lastPlacedBox = (s: EditorState, last: Placing): Box | undefined => {
  const item = s.doc.map.items.at(-1)
  const placed = s.doc.ids.length === last.itemCount + 1 && s.selectedIds.length === 1 &&
    s.selectedIds[0] === s.doc.ids.at(-1)
  return placed && item !== undefined ? itemsBoxOf([item], s.catalogIndex) : undefined
}

/** `last` with one more piece at `point`, or undefined when that piece starts a run of its own. */
const continued = (s: EditorState, last: Placing, point: Vec3, width: number, view: PlacementView) => {
  const box = sameView(last.view, view) ? lastPlacedBox(s, last) : undefined
  if (box === undefined) return undefined
  const first = last.first ?? box
  if (!wouldLandOn(plus(point, last.stepped), width, first, view)) return undefined
  return { run: nextInRun(last.run, box, width, view, s.settings.snapping.gridSize), first, stepped: last.stepped }
}

/** Every item's box, as the map has it now. */
const itemBoxes = ({ catalogIndex, doc }: EditorState): ReadonlyArray<Box> =>
  doc.map.items.flatMap((item) => itemsBoxOf([item], catalogIndex) ?? [])

/**
 * Where a palette placement `width` across goes, given the `point` the view would put it at. The first of a run goes at
 * `point`. While the camera stays put and the last piece placed stays the selection, each piece that would land on the
 * run's first steps on from the last (`nextInRun`). Anything else starts a new run. Either way a slot that an item
 * already stands in is passed over for the next free one (`clearOfBoxes`).
 */
export const spreadPlacement = (point: Vec3, width: number, view: PlacementView): Vec3 => {
  const s = useEditor.getState()
  const next = placing === undefined ? undefined : continued(s, placing, point, width, view)
  const run = clearOfBoxes(
    next?.run ?? startPlacementRun(point),
    itemBoxes(s),
    width,
    view,
    s.settings.snapping.gridSize
  )
  const at = runPoint(run, view)
  placing = { run, view, itemCount: s.doc.ids.length, first: next?.first, stepped: next?.stepped ?? minus(at, point) }
  return at
}
