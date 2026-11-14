/**
 * The shapes a flat profile's cover chooses from (profile.ts). For each layer of the footprint: the largest rectangles
 * inside it along its outline's own directions, ellipses round the squarish ones, discs at its deepest places, bars
 * between opposite sides of its outline, and isosceles triangles at the outline's sharp corners.
 */
import { at } from "../grid/voxelize"
import { depthIn, type Shape, spansOf, withinGrid } from "./extrusion"
import { type Footprint, forEachPixelIn, type Layer, type Point } from "./profileFootprint"

/** Directions tried for rectangles: the outline's own commonest ones, and every 15° besides. */
const OWN_ANGLES = 8
const EVEN_ANGLES = 6
/** Two directions under this many degrees apart are one. */
const ANGLES_APART = 3
/** Largest maximal rectangles kept per direction and layer, each of more than `RECTANGLE_LEAST` pixels. */
const RECTANGLES = 40
const RECTANGLE_LEAST = 8
/** A rectangle under twice as long as wide is squarish: a round lobe may hold it, so ellipses this much larger join. */
const LOBE_GROWS = [1.2, Math.SQRT2] as const
/** A disc is offered where the layer is at least this deep, in pixels, its radius the depth and these more. */
const DISC_LEAST = 2
const DISC_GROWS = [0.5, 1] as const
/** Outline simplification, pixels: a pixel staircase along a straight edge is one segment. */
const SIMPLIFY = 1.2
/** A boundary segment this long, in pixels, or longer proposes bars and corners. */
const SEGMENT_LEAST = 3
/** A bar's two sides run within about 11° of opposite ways (this cosine), each at least `BAR_GAP` pixels inside the other. */
const BAR_OPPOSED = -0.98
const BAR_GAP = 1.5
/** The sides overlap along the bar by half the shorter, and the bar is this many times as long as wide. */
const BAR_OVERLAP = 0.5
const BAR_LONG = 1.6
/** A bar is offered at these shares of the gap between its sides. */
const BAR_WIDTHS = [0.8, 1] as const
/** A convex corner sharper than this is a tapered tip, offered isosceles triangles... */
const SHARP = 80 * Math.PI / 180
/** A tip blunted by at most this many sides, together at most `BLUNT` pixels (a twelfth of the footprint), is a tip. */
const BLUNT_SIDES = 2
const BLUNT = 10
/** ...with legs of these shares of its shorter side. */
const TIP_LEGS = [0.25, 0.5, 0.75, 1] as const
/** A shape may reach past what it may cover by at most this share of its pixels. */
const SPILL = 0.05
/** A shape must cover at least this many pixels. */
export const GAIN_PIXELS = 4

/** An isosceles triangle: its apex and its base's two ends, in pixels. */
interface Triangle {
  readonly kind: "triangle"
  readonly apex: Point
  readonly left: Point
  readonly right: Point
}

/** A shape offered to the cover: its layer, the pixels under it that it may cover, and how many it spills. */
export interface Proposal {
  readonly layer: number
  readonly shape: Shape | Triangle
  readonly pixels: Int32Array
  readonly spill: number
}

/** One side of an outline, walked from `from` to `to`. */
interface Side {
  readonly from: Point
  readonly to: Point
  readonly length: number
}

const distance = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1])

/** Douglas-Peucker on a closed loop, split at its first point and the point farthest from it. */
const simplified = (loop: ReadonlyArray<Point>): Array<Point> => {
  const first = loop[0]
  if (first === undefined) return []
  const point = (k: number): Point => loop[k % loop.length] ?? first
  let far = 0, farthest = -1
  loop.forEach((p, i) => {
    const d = Math.hypot(p[0] - first[0], p[1] - first[1])
    if (d > farthest) {
      farthest = d
      far = i
    }
  })
  const keep = new Uint8Array(loop.length)
  keep[0] = 1
  keep[far] = 1
  /** Keeps the point between `from` and `to` farthest from their line, and so on each side of it, while one is far. */
  const chain = (from: number, to: number) => {
    if (to - from < 2) return
    const a = point(from), b = point(to)
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy)
    let worst = 0, split = -1
    for (let k = from + 1; k < to; k++) {
      const p = point(k)
      const d = length > 0
        ? Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / length
        : Math.hypot(p[0] - a[0], p[1] - a[1])
      if (d > worst) {
        worst = d
        split = k
      }
    }
    if (worst <= SIMPLIFY || split < 0) return
    keep[split % loop.length] = 1
    chain(from, split)
    chain(split, to)
  }
  chain(0, far)
  chain(far, loop.length)
  return loop.filter((_, i) => at(keep, i) === 1)
}

/**
 * The boundary loops of `marks`, each walked with the inside on its left (x right, y up) and simplified to within
 * `SIMPLIFY` pixels, so a pixel staircase along a straight edge becomes one segment.
 */
const loopsOf = (marks: Uint8Array, width: number, height: number): Array<Array<Point>> => {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && at(marks, x + y * width) === 1
  const corner = (x: number, y: number) => x + y * (width + 1)
  // The pixel edges on the boundary, by the corner each starts from.
  const leaving = new Map<number, Array<number>>()
  const edge = (from: number, to: number) => {
    const ends = leaving.get(from) ?? []
    ends.push(to)
    leaving.set(from, ends)
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x, y)) continue
      if (!inside(x, y - 1)) edge(corner(x, y), corner(x + 1, y))
      if (!inside(x + 1, y)) edge(corner(x + 1, y), corner(x + 1, y + 1))
      if (!inside(x, y + 1)) edge(corner(x + 1, y + 1), corner(x, y + 1))
      if (!inside(x - 1, y)) edge(corner(x, y + 1), corner(x, y))
    }
  }
  const loops: Array<Array<Point>> = []
  for (const start of leaving.keys()) {
    // Edges are followed from corner to corner until one has none left: the loop has closed.
    const loop: Array<Point> = []
    let here = start, next = leaving.get(here)?.pop()
    while (next !== undefined) {
      loop.push([here % (width + 1), Math.floor(here / (width + 1))])
      here = next
      next = leaving.get(here)?.pop()
    }
    if (loop.length >= 4) loops.push(simplified(loop))
  }
  return loops
}

const sidesOf = (loops: ReadonlyArray<ReadonlyArray<Point>>): Array<Side> =>
  loops.flatMap((loop) =>
    loop.map((from, i): Side => {
      const to = loop[(i + 1) % loop.length] ?? from
      return { from, to, length: distance(from, to) }
    })
  )

/**
 * The directions rectangles are tried along, in degrees: the outline's commonest by length first (a quarter turn apart
 * being the same for a rectangle), then every 15°, leaving out any within `ANGLES_APART` of one already there.
 */
const anglesOf = (sides: ReadonlyArray<Side>): Array<number> => {
  const lengths = new Map<number, number>()
  for (const { from, length, to } of sides) {
    const degrees = Math.round(((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI) % 90 + 90) % 90) % 90
    lengths.set(degrees, (lengths.get(degrees) ?? 0) + length)
  }
  const own = [...lengths].sort((a, b) => b[1] - a[1]).map(([degrees]) => degrees)
  const angles: Array<number> = []
  for (const degrees of [...own, ...Array.from({ length: EVEN_ANGLES }, (_, i) => i * 90 / EVEN_ANGLES)]) {
    if (angles.length >= OWN_ANGLES + EVEN_ANGLES) break
    const apart = (other: number) => Math.abs(((degrees - other + 45) % 90 + 90) % 90 - 45) >= ANGLES_APART
    if (angles.every(apart)) angles.push(degrees)
  }
  return angles
}

/** A rectangle on a grid: its corner, width and height. */
type GridRectangle = readonly [x: number, y: number, width: number, height: number]

/**
 * Adds to `found` the largest rectangle under each bar of a row's histogram, by the usual stack: `heights` is how many
 * rows up to row `y` each of the `n` columns has been marked without a break.
 */
const rectanglesUnder = (heights: Int32Array, n: number, y: number, found: Array<GridRectangle>): void => {
  const stack: Array<readonly [from: number, tall: number]> = []
  for (let x = 0; x <= n; x++) {
    const h = x < n ? at(heights, x) : 0
    let start = x
    while (stack.length > 0 && (stack.at(-1)?.[1] ?? 0) > h) {
      const [from, tall] = stack.pop() ?? [0, 0]
      start = from
      if ((x - from) * tall > RECTANGLE_LEAST) found.push([from, y - tall + 1, x - from, tall])
    }
    if (h > 0 && (stack.at(-1)?.[1] ?? 0) < h) stack.push([start, h])
  }
}

/** The rectangles no larger rectangle of `marks` holds, turned by `angle`, largest first, at most `RECTANGLES`. */
const maximalRectangles = (marks: Uint8Array, width: number, height: number, angle: number): Array<Shape> => {
  // A square grid turned by the angle about the footprint's middle, large enough to hold all of it.
  const n = Math.ceil(Math.hypot(width, height)), c = Math.cos(angle), s = Math.sin(angle)
  const heights = new Int32Array(n)
  const found: Array<GridRectangle> = []
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const X = (x + 0.5 - n / 2) * c - (y + 0.5 - n / 2) * s + width / 2
      const Y = (x + 0.5 - n / 2) * s + (y + 0.5 - n / 2) * c + height / 2
      const on = X >= 0 && Y >= 0 && X < width && Y < height && at(marks, Math.floor(X) + Math.floor(Y) * width) === 1
      heights[x] = on ? at(heights, x) + 1 : 0
    }
    rectanglesUnder(heights, n, y, found)
  }
  found.sort((a, b) => b[2] * b[3] - a[2] * a[3])
  // Rectangles whose middle and size agree to within a pixel or two are one.
  const seen = new Set<string>(), shapes: Array<Shape> = []
  for (const [x, y, w, h] of found) {
    const key = [x + w / 2, y + h / 2, w, h].map((value) => Math.round(value / 2)).join()
    if (seen.has(key)) continue
    seen.add(key)
    const X = x + w / 2 - n / 2, Y = y + h / 2 - n / 2
    shapes.push({
      kind: "rectangle",
      cu: X * c - Y * s + width / 2,
      cv: X * s + Y * c + height / 2,
      ru: w / 2,
      rv: h / 2,
      angle
    })
    if (shapes.length >= RECTANGLES) break
  }
  return shapes
}

/** The largest rectangles of `marks` along each of `angles`, each squarish one followed by the ellipses round it. */
const rectanglesAndLobes = (
  marks: Uint8Array,
  width: number,
  height: number,
  angles: ReadonlyArray<number>
): Array<Shape> =>
  angles.flatMap((degrees) =>
    maximalRectangles(marks, width, height, degrees * Math.PI / 180).flatMap((rectangle): Array<Shape> => {
      const { ru, rv } = rectangle
      if (!(Math.max(ru, rv) < 2 * Math.min(ru, rv))) return [rectangle]
      return [
        rectangle,
        ...LOBE_GROWS.map((grow): Shape => ({ ...rectangle, kind: "ellipse", ru: ru * grow, rv: rv * grow }))
      ]
    })
  )

/** Discs at the deepest places of `marks`, where no pixel beside is deeper: a tower's round top. */
const discsOf = (marks: Uint8Array, width: number, height: number): Array<Shape> => {
  const depth = depthIn(marks, width, height)
  const discs: Array<Shape> = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = x + y * width, r = at(depth, i)
      if (r < DISC_LEAST) continue
      let peak = true
      for (let dy = -1; dy <= 1 && peak; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (at(depth, i + dx + dy * width) > r) peak = false
      }
      if (!peak) continue
      for (const grow of DISC_GROWS) {
        discs.push({ kind: "ellipse", cu: x + 0.5, cv: y + 0.5, ru: r + grow, rv: r + grow, angle: 0 })
      }
    }
  }
  return discs
}

/**
 * The bars between two sides of the outline that run opposite ways with the inside between them, as long as both
 * together; none unless the sides face each other, overlap enough and make a bar longer than wide.
 */
const barsBetween = ({ from: a, length, to: b }: Side, { from: c, length: other, to: d }: Side): Array<Shape> => {
  const ex = b[0] - a[0], ey = b[1] - a[1], gx = d[0] - c[0], gy = d[1] - c[1]
  if ((ex * gx + ey * gy) / (length * other) > BAR_OPPOSED) return []
  const ux = ex / length, uy = ey / length
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, nx = (c[0] + d[0]) / 2, ny = (c[1] + d[1]) / 2
  // Each side's inside is on its left: the other side's middle must be there, and this one's on the other's.
  const gap = (nx - mx) * -uy + (ny - my) * ux
  const back = (mx - nx) * (gy / other) + (my - ny) * (-gx / other)
  if (gap < BAR_GAP || back < BAR_GAP) return []
  const along = (p: Point) => p[0] * ux + p[1] * uy
  const a0 = Math.min(along(a), along(b)), a1 = Math.max(along(a), along(b))
  const c0 = Math.min(along(c), along(d)), c1 = Math.max(along(c), along(d))
  if (Math.min(a1, c1) - Math.max(a0, c0) < BAR_OVERLAP * Math.min(length, other)) return []
  const from = Math.min(a0, c0), to = Math.max(a1, c1)
  if (to - from < BAR_LONG * gap) return []
  const across = mx * -uy + my * ux + gap / 2, middle = (from + to) / 2
  return BAR_WIDTHS.map((share): Shape => ({
    kind: "rectangle",
    cu: middle * ux - across * uy,
    cv: middle * uy + across * ux,
    ru: (to - from) / 2,
    rv: gap * share / 2,
    angle: Math.atan2(uy, ux)
  }))
}

const barsOf = (sides: ReadonlyArray<Side>): Array<Shape> =>
  sides.flatMap((first, i) => sides.slice(i + 1).flatMap((second) => barsBetween(first, second)))

/** A sharp corner: its apex, the unit directions of the sides into and out of it, and the shorter side's length. */
interface Tip {
  readonly apex: Point
  readonly into: Point
  readonly out: Point
  readonly reach: number
}

/**
 * The sharp convex corners of a loop. Up to `BLUNT_SIDES` sides between two sides, together under `BLUNT` pixels and
 * under half as long as either, are passed over and the corner taken where the two sides' lines meet: a tip blunted by
 * a pixel or two is still a tip.
 */
const tipsOf = (loop: ReadonlyArray<Point>): Array<Tip> => {
  const n = loop.length
  const point = (i: number): Point => loop[((i % n) + n) % n] ?? [0, 0]
  const length = (i: number) => Math.hypot(point(i + 1)[0] - point(i)[0], point(i + 1)[1] - point(i)[1])
  const tips: Array<Tip> = []
  for (let i = 0; i < n; i++) {
    let between = 0
    for (let skip = 0; skip <= BLUNT_SIDES && skip < n - 2; skip++) {
      if (skip > 0) between += length(i + skip)
      const j = i + skip + 1, la = length(i), lb = length(j)
      if (between > BLUNT || Math.min(la, lb) < Math.max(SEGMENT_LEAST, 2 * between)) continue
      const a = point(i), b = point(i + 1), c = point(j), d = point(j + 1)
      const ex = b[0] - a[0], ey = b[1] - a[1], gx = d[0] - c[0], gy = d[1] - c[1]
      const turn = ex * gy - ey * gx
      // Convex: the walk turns left, the inside being on its left. Sharp: the sides meet under `SHARP`.
      if (turn <= 0 || Math.acos(Math.max(-1, Math.min(1, -(ex * gx + ey * gy) / (la * lb)))) >= SHARP) continue
      // Where the two sides' lines meet and, for a blunted tip, the middle of its blunt end, which spills nothing.
      const t = ((c[0] - a[0]) * gy - (c[1] - a[1]) * gx) / turn
      const meet: Point = [a[0] + ex * t, a[1] + ey * t], end: Point = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2]
      for (const apex of skip > 0 ? [meet, end] : [meet]) {
        const reach = Math.min(distance(a, apex), distance(apex, d))
        tips.push({ apex, into: [ex / la, ey / la], out: [gx / lb, gy / lb], reach })
      }
    }
  }
  return tips
}

/** Isosceles triangles at each tip, legs along the corner's two sides: a tapered tip. */
const trianglesOf = (loop: ReadonlyArray<Point>): Array<Triangle> =>
  tipsOf(loop).flatMap(({ apex, into, out, reach }) =>
    TIP_LEGS.map((share): Triangle => {
      const leg = share * reach
      return {
        kind: "triangle",
        apex,
        left: [apex[0] - into[0] * leg, apex[1] - into[1] * leg],
        right: [apex[0] + out[0] * leg, apex[1] + out[1] * leg]
      }
    })
  )

/** Calls `each` on the pixels under `shape`; false when a rectangle or ellipse is too thin or leaves the picture. */
const forEachPixelUnder = (
  shape: Shape | Triangle,
  width: number,
  height: number,
  each: (i: number) => void
): boolean => {
  if (shape.kind === "triangle") {
    forEachPixelIn(shape.apex, shape.left, shape.right, width, height, 0, each)
    return true
  }
  if (shape.ru < 0.5 || shape.rv < 0.5 || !withinGrid(shape, width, height)) return false
  spansOf(shape, width, height, (y, from, to) => {
    for (let x = from; x <= to; x++) each(x + y * width)
  })
  return true
}

/** `shape` as a proposal for `layer`, if it covers enough of what the layer allows and spills little past it. */
const proposalOf = (
  shape: Shape | Triangle,
  layer: number,
  allowed: Uint8Array,
  width: number,
  height: number
): Proposal | undefined => {
  const pixels: Array<number> = []
  let spill = 0
  const drawn = forEachPixelUnder(shape, width, height, (i) => {
    if (at(allowed, i) === 1) pixels.push(i)
    else spill++
  })
  if (!drawn || pixels.length < GAIN_PIXELS || spill > SPILL * (pixels.length + spill)) return undefined
  return { layer, shape, pixels: Int32Array.from(pixels), spill }
}

/** Every shape the cover may choose from, for each layer. */
export const proposalsOf = ({ height, width }: Footprint, layers: ReadonlyArray<Layer>): Array<Proposal> =>
  layers.flatMap((layer, k) => {
    const loops = loopsOf(layer.own, width, height), sides = sidesOf(loops)
    const shapes = [
      ...rectanglesAndLobes(layer.allowed, width, height, anglesOf(sides)),
      ...discsOf(layer.own, width, height),
      ...barsOf(sides.filter((side) => side.length >= SEGMENT_LEAST)),
      ...loops.flatMap(trianglesOf)
    ]
    return shapes.flatMap((shape) => proposalOf(shape, k, layer.allowed, width, height) ?? [])
  })
