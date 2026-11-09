/**
 * Box and lasso select, as far as it needs no renderer (docs/DESKTOP.md § Box and lasso select): the region on screen and
 * what it touches or holds, which of the two a drag asks for, the units the caught items make up, and the selection a
 * release leaves. The editor projects the pieces (editor/areaPick.ts); everything here is in a pane's pixels, y down.
 */
import { enteredScopeOf } from "./groupSelection"
import type { TreeNode } from "./MapSidecar"
import { idOf, treeKeys } from "./structure"

export interface Point2 {
  readonly x: number
  readonly y: number
}

/** The regions a drag draws, each a view of its own (`components/viewIds.ts`). */
export const areaShapes = ["box", "lasso"] as const

/** What the drag draws: a box from the press to the pointer, or the lasso's path from the press. */
export type AreaShape =
  | { readonly kind: "box"; readonly from: Point2; readonly to: Point2 }
  | { readonly kind: "lasso"; readonly points: ReadonlyArray<Point2> }

/** Whether a piece has to be wholly inside the region, or only touch it. */
export type AreaMode = "inside" | "touching"

/** Settings › Editor › Box selects: by the drag's direction, as the CAD apps do, or always one mode. */
export const areaRules = ["direction", "touching", "inside"] as const
export type AreaRule = (typeof areaRules)[number]

/** The rules as Settings names them. */
export const AREA_RULE_NAMES: Readonly<Record<AreaRule, string>> = {
  direction: "By direction",
  touching: "Touching",
  inside: "Wholly inside"
}

/** How a drag changes the selection: what its press chord asks, as a click's does. */
export type AreaOp = "replace" | "add" | "toggle" | "remove"

/**
 * The mode a drag from `from` heading for `towards` asks for: left to right is inside, right to left touching. A box goes
 * by where the pointer is now; a lasso by where it first headed.
 */
export const areaModeOf = (rule: AreaRule, from: Point2, towards: Point2): AreaMode =>
  rule !== "direction" ? rule : towards.x >= from.x ? "inside" : "touching"

/** How far apart (px) a lasso's points are kept: closer ones add nothing a pointer can mean. */
export const LASSO_STEP_PX = 3

/** Adds `point` to a lasso's path unless it is within `LASSO_STEP_PX` of the last one kept. */
export const extendPath = (points: ReadonlyArray<Point2>, point: Point2): ReadonlyArray<Point2> => {
  const last = points.at(-1)
  return last !== undefined && Math.hypot(point.x - last.x, point.y - last.y) < LASSO_STEP_PX
    ? points
    : [...points, point]
}

/** The rows a lasso's edges are filed under, so a point or a triangle only looks at the edges near it. */
const BAND_PX = 16

/** Which side of the line a→b point p is on: positive to the left, in screen pixels. */
const side = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
  (bx - ax) * (py - ay) - (by - ay) * (px - ax)

/** Do segments a–b and c–d cross or touch? */
const segmentsMeet = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number
): boolean => {
  const d1 = side(cx, cy, dx, dy, ax, ay)
  const d2 = side(cx, cy, dx, dy, bx, by)
  const d3 = side(ax, ay, bx, by, cx, cy)
  const d4 = side(ax, ay, bx, by, dx, dy)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  const on = (d: number, px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    d === 0 && Math.min(px, qx) <= rx && rx <= Math.max(px, qx) && Math.min(py, qy) <= ry && ry <= Math.max(py, qy)
  return on(d1, cx, cy, dx, dy, ax, ay) || on(d2, cx, cy, dx, dy, bx, by) || on(d3, ax, ay, bx, by, cx, cy) ||
    on(d4, ax, ay, bx, by, dx, dy)
}

/** Is p inside or on triangle abc, whichever way it winds? */
const inTriangle = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number
): boolean => {
  const d1 = side(ax, ay, bx, by, px, py)
  const d2 = side(bx, by, cx, cy, px, py)
  const d3 = side(cx, cy, ax, ay, px, py)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

/**
 * A region on screen, built once per drag update and asked about every piece's points and triangles. A box is exact; a
 * lasso is the closed polygon of its path, its edges filed by row so each question reads only the edges near it.
 */
export class AreaRegion {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  /** The lasso's corners as x, y pairs; undefined for a box. */
  private readonly polygon: Float64Array | undefined
  /** For each band of `BAND_PX` rows from `minY`, the edges (by their first corner's index) that reach into it. */
  private readonly bands: ReadonlyArray<ReadonlyArray<number>>

  private constructor(minX: number, minY: number, maxX: number, maxY: number, polygon: Float64Array | undefined) {
    this.minX = minX
    this.minY = minY
    this.maxX = maxX
    this.maxY = maxY
    this.polygon = polygon
    const bands: Array<Array<number>> = []
    if (polygon !== undefined) {
      const n = polygon.length / 2
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        const top = Math.min(polygon[2 * i + 1] ?? 0, polygon[2 * j + 1] ?? 0)
        const bottom = Math.max(polygon[2 * i + 1] ?? 0, polygon[2 * j + 1] ?? 0)
        for (let band = this.bandOf(top); band <= this.bandOf(bottom); band++) (bands[band] ??= []).push(i)
      }
    }
    this.bands = bands
  }

  /** The region `shape` draws; undefined while a lasso has too few points to hold anything. */
  static of(shape: AreaShape): AreaRegion | undefined {
    if (shape.kind === "box") {
      const { from, to } = shape
      return new AreaRegion(
        Math.min(from.x, to.x),
        Math.min(from.y, to.y),
        Math.max(from.x, to.x),
        Math.max(from.y, to.y),
        undefined
      )
    }
    if (shape.points.length < 3) return undefined
    const polygon = new Float64Array(shape.points.flatMap(({ x, y }) => [x, y]))
    const xs = shape.points.map(({ x }) => x)
    const ys = shape.points.map(({ y }) => y)
    return new AreaRegion(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), polygon)
  }

  private bandOf(y: number): number {
    return Math.max(0, Math.floor((y - this.minY) / BAND_PX))
  }

  private corner(i: number): readonly [number, number] {
    const polygon = this.polygon ?? new Float64Array()
    const n = polygon.length / 2
    const k = ((i % n) + n) % n
    return [polygon[2 * k] ?? 0, polygon[2 * k + 1] ?? 0]
  }

  /** Is the point inside the region (or on its edge, for a box)? */
  contains(x: number, y: number): boolean {
    if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY) return false
    if (this.polygon === undefined) return true
    let inside = false
    for (const i of this.bands[this.bandOf(y)] ?? []) {
      const [ax, ay] = this.corner(i)
      const [bx, by] = this.corner(i + 1)
      if ((ay > y) !== (by > y) && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inside = !inside
    }
    return inside
  }

  /** Does the screen box overlap the region's bounds? A box that doesn't can't touch the region. */
  overlapsBounds(minX: number, minY: number, maxX: number, maxY: number): boolean {
    return maxX >= this.minX && minX <= this.maxX && maxY >= this.minY && minY <= this.maxY
  }

  /** Does triangle abc, on screen, touch the region? */
  touchesTriangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
    const tMinX = Math.min(ax, bx, cx)
    const tMaxX = Math.max(ax, bx, cx)
    const tMinY = Math.min(ay, by, cy)
    const tMaxY = Math.max(ay, by, cy)
    if (!this.overlapsBounds(tMinX, tMinY, tMaxX, tMaxY)) return false
    if (this.contains(ax, ay) || this.contains(bx, by) || this.contains(cx, cy)) return true
    if (this.polygon === undefined) {
      // a box and a triangle with no corner of the triangle inside: they meet when no triangle edge separates them
      const corners = [this.minX, this.minY, this.maxX, this.minY, this.maxX, this.maxY, this.minX, this.maxY]
      const separates = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => {
        const third = side(px, py, qx, qy, rx, ry)
        for (let k = 0; k < 8; k += 2) {
          const s = side(px, py, qx, qy, corners[k] ?? 0, corners[k + 1] ?? 0)
          if (s === 0 || (s > 0) === (third > 0)) return false
        }
        return true
      }
      return !separates(ax, ay, bx, by, cx, cy) && !separates(bx, by, cx, cy, ax, ay) &&
        !separates(cx, cy, ax, ay, bx, by)
    }
    // a lasso: one of its corners inside the triangle, or an edge of each crossing
    const from = this.bandOf(Math.max(tMinY, this.minY))
    const to = this.bandOf(Math.min(tMaxY, this.maxY))
    const seen = new Set<number>()
    for (let band = from; band <= to; band++) {
      for (const i of this.bands[band] ?? []) {
        if (seen.has(i)) continue
        seen.add(i)
        const [px, py] = this.corner(i)
        const [qx, qy] = this.corner(i + 1)
        if (Math.max(px, qx) < tMinX || Math.min(px, qx) > tMaxX) continue
        if (inTriangle(ax, ay, bx, by, cx, cy, px, py)) return true
        if (
          segmentsMeet(px, py, qx, qy, ax, ay, bx, by) || segmentsMeet(px, py, qx, qy, bx, by, cx, cy) ||
          segmentsMeet(px, py, qx, qy, cx, cy, ax, ay)
        ) return true
      }
    }
    return false
  }
}

/** Which unit each item is part of at the click level, and each unit's items: worked out once per tree and level. */
export interface AreaUnits {
  readonly unitOf: ReadonlyMap<string, string>
  readonly keysOf: ReadonlyMap<string, ReadonlyArray<string>>
}

/**
 * The units a box reaches, as a click would (`clickLevelOf`): each item's outermost group, or inside the entered group,
 * that group's children. One walk of the tree, where asking `clickLevelOf` item by item would walk it per item.
 */
export const areaUnitsOf = (tree: ReadonlyArray<TreeNode>, enteredGroupId: string | null): AreaUnits => {
  const scope = new Set(enteredScopeOf(tree, enteredGroupId))
  const unitOf = new Map<string, string>()
  const keysOf = new Map<string, ReadonlyArray<string>>()
  const walk = (nodes: ReadonlyArray<TreeNode>) => {
    for (const node of nodes) {
      if (node.kind === "group" && scope.has(node.id)) {
        walk(node.children)
        continue
      }
      const id = idOf(node)
      const keys = treeKeys([node])
      keysOf.set(id, keys)
      for (const key of keys) unitOf.set(key, id)
    }
  }
  walk(tree)
  return { unitOf, keysOf }
}

/**
 * The units the region caught, each as its items, in the order the candidates come (the Outline's). `caught` says
 * whether an item is caught in `mode`: touched, or wholly inside. A unit is caught when any of its candidate items is
 * touched, or when every one is inside. Items that aren't candidates (outside the entered group; hidden or locked, #81)
 * neither catch a unit nor keep one out.
 */
export const caughtUnitsOf = (
  units: AreaUnits,
  candidates: ReadonlyArray<string>,
  mode: AreaMode,
  caught: (key: string) => boolean
): ReadonlyArray<ReadonlyArray<string>> => {
  const verdict = new Map<string, boolean>()
  const order: Array<string> = []
  for (const key of candidates) {
    const unit = units.unitOf.get(key)
    if (unit === undefined) continue
    const before = verdict.get(unit)
    if (before === undefined) order.push(unit)
    if (mode === "touching" ? before === true : before === false) continue
    verdict.set(unit, caught(key))
  }
  return order.flatMap((unit) => verdict.get(unit) === true ? [units.keysOf.get(unit) ?? []] : [])
}

/** `keys` with the one nearest the press (least `distance`) moved to the end, where the active item goes. */
const nearestLast = (keys: ReadonlyArray<string>, distance: (key: string) => number): ReadonlyArray<string> => {
  let nearest: string | undefined
  let best = Infinity
  for (const key of keys) {
    const d = distance(key)
    if (nearest === undefined || d < best) {
      nearest = key
      best = d
    }
  }
  return nearest === undefined ? keys : [...keys.filter((key) => key !== nearest), nearest]
}

/**
 * The selection a release leaves (docs/DESKTOP.md § Box and lasso select). A plain drag selects what it caught; add puts
 * what wasn't selected after the selection; toggle takes away each unit wholly selected and adds the others; remove takes
 * them away. Of what a drag adds, the item nearest the press (`distance`, on screen) is the active one, the last; with
 * nothing added the active item stays.
 */
export const areaSelectionOf = (
  current: ReadonlyArray<string>,
  units: ReadonlyArray<ReadonlyArray<string>>,
  op: AreaOp,
  distance: (key: string) => number
): ReadonlyArray<string> => {
  if (op === "replace") return nearestLast(units.flat(), distance)
  const selected = new Set(current)
  const removed = new Set<string>()
  const added: Array<string> = []
  for (const keys of units) {
    const whole = keys.every((key) => selected.has(key))
    if (op === "remove" || (op === "toggle" && whole)) {
      for (const key of keys) removed.add(key)
    } else {
      for (const key of keys) if (!selected.has(key)) added.push(key)
    }
  }
  if (removed.size === 0 && added.length === 0) return current
  return [...current.filter((key) => !removed.has(key)), ...nearestLast(added, distance)]
}
