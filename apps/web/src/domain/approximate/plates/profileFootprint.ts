/**
 * A part's footprint for the flat profiles (profile.ts): the part rastered along a sweep axis, with the nearest and
 * farthest surface at every pixel, and the footprint's layers, the sets of columns of like depth. A ring's towers
 * stand taller than the bars between them; a disk's slot is shallower than the disk.
 */
import type { Vec3 } from "../../coords"
import { vecCross, vecDot, vecNormalize, vecScale, vecSub } from "../../ueMath"
import { at } from "../grid/voxelize"
import { depthIn } from "./extrusion"

/** Pixels across the footprint's longer side, with `BORDER` more round it so a shape that leaves it still shows. */
const PIXELS = 128
const BORDER = 4

/** Two columns are one layer when their near and far surfaces are both within this share of the part's depth. */
const LAYER_TOLERANCE = 0.15
/** A layer holds at least this share of the footprint; columns in no layer join the nearest. */
const LAYER_LEAST = 0.06
const LAYERS_MOST = 4
/**
 * A layer must have a body: at least this share of its columns `LAYER_BODY` pixels or more from its edge. A band
 * round the outline only (the thin rim of a chamfered edge) joins the layer it borders instead.
 */
const LAYER_BODY_SHARE = 0.3
const LAYER_BODY = 2

/** A part's footprint along its sweep axis `w`: pixel (x, y) spans [x, x + 1) × [y, y + 1) of the u, v plane. */
export interface Footprint {
  readonly u: Vec3
  readonly v: Vec3
  readonly w: Vec3
  /** Where pixel (0, 0)'s corner lies along u and v, cm. */
  readonly origin: readonly [number, number]
  /** A pixel's side, cm. */
  readonly pixel: number
  readonly width: number
  readonly height: number
  /** 1 at each pixel the part covers: a column. */
  readonly mask: Uint8Array
  /** The nearest and farthest surface along `w` at each pixel's centre, cm. */
  readonly near: Float32Array
  readonly far: Float32Array
}

/** One depth of a part: the pixels it owns, and those a piece of it may cover unseen (columns holding its depth). */
export interface Layer {
  readonly near: number
  readonly far: number
  readonly own: Uint8Array
  readonly allowed: Uint8Array
}

export type Point = readonly [number, number]

/** The value `share` of the way up `values` in order. */
const quantile = (values: Float64Array, share: number): number => {
  const sorted = values.slice().sort()
  return at(sorted, Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * share))))
}

/**
 * Calls `each` on every pixel of a `width` × `height` picture whose centre lies in the triangle a, b, c, or within
 * `slack` of it in barycentric weights, with the pixel's index and its weights on a and b. A triangle with no area,
 * such as a face seen edge-on, covers nothing.
 */
export const forEachPixelIn = (
  [ax, ay]: Point,
  [bx, by]: Point,
  [cx, cy]: Point,
  width: number,
  height: number,
  slack: number,
  each: (i: number, s: number, t: number) => void
): void => {
  const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
  if (Math.abs(den) < 1e-9) return
  const xFrom = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
    xTo = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
  const yFrom = Math.max(0, Math.floor(Math.min(ay, by, cy))),
    yTo = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
  for (let y = yFrom; y <= yTo; y++) {
    for (let x = xFrom; x <= xTo; x++) {
      const X = x + 0.5, Y = y + 0.5
      const s = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / den
      const t = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / den
      if (s < -slack || t < -slack || s + t > 1 + slack) continue
      each(x + y * width, s, t)
    }
  }
}

/** `triangles`' corners along u, v and w, and their extent along u and v. */
const projected = (triangles: Float32Array, u: Vec3, v: Vec3, w: Vec3) => {
  const corners = triangles.length / 3
  const pu = new Float64Array(corners), pv = new Float64Array(corners), pw = new Float64Array(corners)
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (let i = 0; i < corners; i++) {
    const p = { x: at(triangles, 3 * i), y: at(triangles, 3 * i + 1), z: at(triangles, 3 * i + 2) }
    pu[i] = vecDot(p, u)
    pv[i] = vecDot(p, v)
    pw[i] = vecDot(p, w)
    u0 = Math.min(u0, at(pu, i))
    u1 = Math.max(u1, at(pu, i))
    v0 = Math.min(v0, at(pv, i))
    v1 = Math.max(v1, at(pv, i))
  }
  return { corners, pu, pv, pw, u0, u1, v0, v1 }
}

/** `triangles` rastered along `w`, u lying along `toward` as nearly as it can; undefined when it has no extent. */
export const footprintOf = (triangles: Float32Array, w: Vec3, toward: Vec3): Footprint | undefined => {
  const u = vecNormalize(vecSub(toward, vecScale(w, vecDot(toward, w)))), v = vecCross(w, u)
  const { corners, pu, pv, pw, u0, u1, v0, v1 } = projected(triangles, u, v, w)
  const pixel = Math.max(u1 - u0, v1 - v0) / PIXELS
  if (!(pixel > 0)) return undefined
  const width = Math.ceil((u1 - u0) / pixel) + 2 * BORDER, height = Math.ceil((v1 - v0) / pixel) + 2 * BORDER
  const origin = [u0 - BORDER * pixel, v0 - BORDER * pixel] as const
  const near = new Float32Array(width * height).fill(Infinity), far = new Float32Array(width * height).fill(-Infinity)
  const onPicture = (i: number): Point => [(at(pu, i) - origin[0]) / pixel, (at(pv, i) - origin[1]) / pixel]
  for (let a = 0; a + 2 < corners; a += 3) {
    const b = a + 1, c = a + 2
    forEachPixelIn(onPicture(a), onPicture(b), onPicture(c), width, height, 1e-9, (i, s, t) => {
      const depth = s * at(pw, a) + t * at(pw, b) + (1 - s - t) * at(pw, c)
      near[i] = Math.min(at(near, i), depth)
      far[i] = Math.max(at(far, i), depth)
    })
  }
  const mask = Uint8Array.from(near, (depth) => depth === Infinity ? 0 : 1)
  return mask.includes(1) ? { u, v, w, origin, pixel, width, height, mask, near, far } : undefined
}

/** The footprint's columns in order, with the least near and the greatest far depth among them. */
const columnsOf = (f: Footprint) => {
  const ids: Array<number> = []
  let low = Infinity, high = -Infinity
  for (let i = 0; i < f.mask.length; i++) {
    if (at(f.mask, i) === 0) continue
    ids.push(i)
    low = Math.min(low, at(f.near, i))
    high = Math.max(high, at(f.far, i))
  }
  return { ids, low, high }
}

/**
 * How full the footprint is: `solid`, the mean depth of its columns over the part's whole depth, and `drift`, how far
 * the columns' middles spread (the 5th to the 95th of a hundred) over a typical column's depth (the 80th).
 */
export const fullnessOf = (f: Footprint): { readonly solid: number; readonly drift: number } => {
  const { high, ids, low } = columnsOf(f)
  const depths = Float64Array.from(ids, (i) => at(f.far, i) - at(f.near, i))
  const middles = Float64Array.from(ids, (i) => (at(f.far, i) + at(f.near, i)) / 2)
  let sum = 0
  for (const depth of depths) sum += depth
  const typical = Math.max(quantile(depths, 0.8), 1e-9)
  return {
    solid: sum / (Math.max(high - low, 1e-9) * depths.length),
    drift: (quantile(middles, 0.95) - quantile(middles, 0.05)) / typical
  }
}

interface Depth {
  readonly near: number
  readonly far: number
}

/** The median near and far surface of `columns`. */
const medianDepth = (f: Footprint, columns: ReadonlyArray<number>): Depth => ({
  near: quantile(Float64Array.from(columns, (i) => at(f.near, i)), 0.5),
  far: quantile(Float64Array.from(columns, (i) => at(f.far, i)), 0.5)
})

/** The commonest depth among `columns`: the median of the fullest bin of (near, far), each binned at `tolerance`. */
const commonestDepth = (f: Footprint, columns: ReadonlyArray<number>, low: number, tolerance: number): Depth => {
  const bins = new Map<number, Array<number>>()
  for (const i of columns) {
    const key = Math.floor((at(f.near, i) - low) / tolerance) * 4096 + Math.floor((at(f.far, i) - low) / tolerance)
    const bin = bins.get(key) ?? []
    bin.push(i)
    bins.set(key, bin)
  }
  let fullest: Array<number> = []
  for (const bin of bins.values()) if (bin.length > fullest.length) fullest = bin
  return medianDepth(f, fullest)
}

/** Whether enough of `members` lie `LAYER_BODY` pixels or more inside their own outline. */
const hasBody = (f: Footprint, members: ReadonlyArray<number>): boolean => {
  const marks = new Uint8Array(f.mask.length)
  for (const i of members) marks[i] = 1
  const inward = depthIn(marks, f.width, f.height)
  const body = members.filter((i) => at(inward, i) >= LAYER_BODY).length
  return !(body < LAYER_BODY_SHARE * members.length)
}

/**
 * The layers' depths, commonest first, and each column's layer in `label` (-1 for none yet). A layer takes the columns
 * left whose near and far surfaces both lie within `tolerance` of its depth, while those are `LAYER_LEAST` of the
 * footprint; after the first, a layer without a body is passed over, its columns left without one.
 */
const depthsOf = (
  f: Footprint,
  ids: ReadonlyArray<number>,
  low: number,
  tolerance: number,
  label: Int32Array
): Array<Depth> => {
  const depths: Array<Depth> = []
  let left = ids
  while (depths.length < LAYERS_MOST && left.length >= LAYER_LEAST * ids.length) {
    const depth = commonestDepth(f, left, low, tolerance)
    const within = (i: number) =>
      Math.abs(at(f.near, i) - depth.near) <= tolerance && Math.abs(at(f.far, i) - depth.far) <= tolerance
    const members = left.filter(within)
    if (members.length < LAYER_LEAST * ids.length) break
    left = left.filter((i) => !within(i))
    if (depths.length > 0 && !hasBody(f, members)) continue
    for (const i of members) label[i] = depths.length
    depths.push(depth)
  }
  return depths.length > 0 ? depths : [medianDepth(f, ids)]
}

/** The layer whose near and far surfaces are nearest column `i`'s, the earlier of two as near. */
const nearestDepth = (f: Footprint, depths: ReadonlyArray<Depth>, i: number): number => {
  let best = 0, distance = Infinity
  depths.forEach(({ far, near }, k) => {
    const d = Math.max(Math.abs(at(f.near, i) - near), Math.abs(at(f.far, i) - far))
    if (d < distance) {
      best = k
      distance = d
    }
  })
  return best
}

/**
 * The footprint's layers, commonest depth first. Every column is owned by one layer: the one that took it, or the
 * nearest in depth. A layer's pieces may also cover the columns that hold its depth (a bar runs on into a taller
 * tower).
 */
export const layersOf = (f: Footprint): Array<Layer> => {
  const { high, ids, low } = columnsOf(f)
  const tolerance = Math.max(LAYER_TOLERANCE * (high - low), 1e-6)
  const label = new Int32Array(f.mask.length).fill(-1)
  const depths = depthsOf(f, ids, low, tolerance, label)
  for (const i of ids) if (at(label, i) < 0) label[i] = nearestDepth(f, depths, i)
  return depths.map(({ far, near }, k) => {
    const own = new Uint8Array(f.mask.length), allowed = new Uint8Array(f.mask.length)
    for (const i of ids) {
      if (at(label, i) === k) own[i] = 1
      const holds = at(f.near, i) <= near + tolerance && at(f.far, i) >= far - tolerance
      if (holds || at(label, i) === k) allowed[i] = 1
    }
    return { near, far, own, allowed }
  })
}
