/** Spreads palette placements out, so pieces placed from one view don't pile up on one spot. */
import type { Vec3 } from "../../domain/coords"
import { type Box, itemsBoxOf } from "../../domain/itemBounds"
import {
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
}

let placing: Placing | undefined

const sameVec = (a: Vec3, b: Vec3) => a.x === b.x && a.y === b.y && a.z === b.z

const sameView = (a: PlacementView, b: PlacementView) =>
  sameVec(a.position, b.position) && sameVec(a.right, b.right) && sameVec(a.up, b.up)

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
  if (!wouldLandOn(point, width, first, view)) return undefined
  return { run: nextInRun(last.run, box, width, view, s.settings.snapping.gridSize), first }
}

/**
 * Where a palette placement `width` across goes, given the `point` the view would put it at. The first of a run goes at
 * `point`. While the camera stays put and the last piece placed stays the selection, each piece that would land on the
 * run's first steps on from the last (`nextInRun`). Anything else starts a new run.
 */
export const spreadPlacement = (point: Vec3, width: number, view: PlacementView): Vec3 => {
  const s = useEditor.getState()
  const next = placing === undefined ? undefined : continued(s, placing, point, width, view)
  const run = next?.run ?? startPlacementRun(point)
  placing = { run, view, itemCount: s.doc.ids.length, first: next?.first }
  return runPoint(run, view)
}
