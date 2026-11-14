import { afterEach, assert, describe, it } from "@effect/vitest"
import type { Vec3 } from "../../coords"
import { quatFromAxisAngle, rotateVec, vecLength, vecSub } from "../../ueMath"
import { setClock } from "../clock"
import { trianglesOfPlacement } from "../look/views"
import { meshReady } from "../mesh/mesh"
import { componentsOf, joined } from "../parts/meshParts"
import { IDENTITY_QUAT, type Placement } from "../shapes"
import { narrowed, profileSplit } from "./profile"
import { type Footprint, footprintOf, fullnessOf, type Layer, layersOf } from "./profileFootprint"
import { proposalsOf } from "./profileShapes"

const X: Vec3 = { x: 1, y: 0, z: 0 }, Z: Vec3 = { x: 0, y: 0, z: 1 }

const box = (center: Vec3, half: Vec3): Float32Array =>
  trianglesOfPlacement({ kind: "box", center, half, rotation: IDENTITY_QUAT })

const ball = (center: Vec3, radius: number): Float32Array =>
  trianglesOfPlacement({ kind: "sphere", center, half: { x: radius, y: radius, z: radius }, rotation: IDENTITY_QUAT })

const tilt = quatFromAxisAngle({ x: 0.48, y: 0.6, z: 0.64 }, 0.9)

type Corner = readonly [number, number, number]

/** Triangles from quads, each given as four corners in order, all turned by `tilt` when `tilted`. */
const quadsTo = (tilted: boolean) => {
  const numbers: Array<number> = []
  const quad = (...corners: ReadonlyArray<Corner>) => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [x, y, z] = corners[k] ?? [0, 0, 0]
      const p = tilted ? rotateVec(tilt, { x, y, z }) : { x, y, z }
      numbers.push(p.x, p.y, p.z)
    }
  }
  return { quad, triangles: () => new Float32Array(numbers) }
}

/**
 * An outline swept 20 cm along z, as one closed mesh: `inside` says which cells of a 20 × 20 grid over 240 cm square
 * (x and y from -1 to 1) the outline holds. Each cell gives its two caps and a wall wherever its neighbour is outside.
 */
const swept = (inside: (x: number, y: number) => boolean, tilted = false): Float32Array => {
  const cells = 20, cell = 12, { quad, triangles } = quadsTo(tilted)
  const held = (i: number, j: number) => inside((2 * i + 1) / cells - 1, (2 * j + 1) / cells - 1)
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      if (!held(i, j)) continue
      const x0 = (i - cells / 2) * cell, x1 = x0 + cell, y0 = (j - cells / 2) * cell, y1 = y0 + cell
      quad([x0, y0, 10], [x1, y0, 10], [x1, y1, 10], [x0, y1, 10])
      quad([x0, y1, -10], [x1, y1, -10], [x1, y0, -10], [x0, y0, -10])
      if (!held(i - 1, j)) quad([x0, y0, -10], [x0, y0, 10], [x0, y1, 10], [x0, y1, -10])
      if (!held(i + 1, j)) quad([x1, y1, -10], [x1, y1, 10], [x1, y0, 10], [x1, y0, -10])
      if (!held(i, j - 1)) quad([x1, y0, -10], [x1, y0, 10], [x0, y0, 10], [x0, y0, -10])
      if (!held(i, j + 1)) quad([x0, y1, -10], [x0, y1, 10], [x1, y1, 10], [x1, y1, -10])
    }
  }
  return triangles()
}

/** A convex polygon swept 20 cm along z, as one closed mesh: straight walls, where `swept` has stairs. */
const prism = (points: ReadonlyArray<readonly [number, number]>, tilted = false): Float32Array => {
  const { quad, triangles } = quadsTo(tilted)
  const at = (i: number, z: number): Corner => {
    const [x, y] = points[i % points.length] ?? [0, 0]
    return [x, y, z]
  }
  points.forEach((_, i) => {
    quad(at(i, -10), at(i + 1, -10), at(i + 1, 10), at(i, 10))
    // The caps as fans from the first point; a quad with a corner twice is one triangle and one with no area.
    if (i > 0 && i < points.length - 1) quad(at(0, 10), at(i, 10), at(i + 1, 10), at(i + 1, 10))
    if (i > 0 && i < points.length - 1) quad(at(0, -10), at(i + 1, -10), at(i, -10), at(i, -10))
  })
  return triangles()
}

const ring = (x: number, y: number) => Math.hypot(x, y) < 0.9 && Math.hypot(x, y) > 0.55

const parts: Readonly<Record<string, (tilted?: boolean) => Float32Array>> = {
  "plate with two slots": (tilted) =>
    swept(
      (x, y) => Math.abs(x) < 0.9 && Math.abs(y) < 0.6 && !(Math.abs(Math.abs(x) - 0.45) < 0.15 && Math.abs(y) < 0.35),
      tilted
    ),
  ring: (tilted) => swept(ring, tilted),
  "bar with a crossbar": (tilted) =>
    swept((x, y) => Math.abs(x) < 0.17 || (Math.abs(y - 0.4) < 0.17 && Math.abs(x) < 0.85), tilted),
  wedge: (tilted) => prism([[-40, -100], [40, -100], [0, 100]], tilted),
  arrow: (tilted) => prism([[-30, -100], [30, -100], [30, 0], [0, 110], [-30, 0]], tilted)
}

const count = (marks: Uint8Array): number => marks.reduce((sum, mark) => sum + mark, 0)

/** A footprint of `width` × `height` pixels that holds the pixels `inside` says, as one layer 10 cm deep. */
const drawn = (width: number, height: number, inside: (x: number, y: number) => boolean) => {
  const mask = Uint8Array.from(
    { length: width * height },
    (_, i) => inside(i % width + 0.5, Math.floor(i / width) + 0.5) ? 1 : 0
  )
  const footprint: Footprint = {
    u: X,
    v: { x: 0, y: 1, z: 0 },
    w: Z,
    origin: [0, 0],
    pixel: 1,
    width,
    height,
    mask,
    near: new Float32Array(width * height),
    far: new Float32Array(width * height).fill(10)
  }
  const layer: Layer = { near: 0, far: 10, own: mask, allowed: mask }
  return { footprint, layer, proposals: proposalsOf(footprint, [layer]) }
}

afterEach(() => setClock(() => performance.now()))

describe("a part's footprint", () => {
  it("rasters a part along an axis, 128 pixels across its longer side inside a border of 4", () => {
    const f = footprintOf(box({ x: 50, y: 0, z: 5 }, { x: 160, y: 80, z: 20 }), Z, X)
    assert.isDefined(f)
    assert.deepStrictEqual([f.width, f.height, f.pixel], [136, 72, 2.5])
    assert.deepStrictEqual(f.origin, [-120, -90])
    assert.strictEqual(count(f.mask), 128 * 64)
    const middle = 68 + 36 * f.width
    assert.deepStrictEqual([f.mask[middle], f.near[middle], f.far[middle]], [1, -15, 25])
    assert.deepStrictEqual([f.mask[0], f.near[0], f.far[0]], [0, Infinity, -Infinity])
  })

  it("has none for a part with no extent", () => {
    assert.isUndefined(footprintOf(new Float32Array(), Z, X))
    assert.isUndefined(footprintOf(new Float32Array(9).fill(3), Z, X))
  })

  it("measures how full the columns are and how level their middles", () => {
    const slab = footprintOf(box({ x: 0, y: 0, z: 0 }, { x: 100, y: 100, z: 10 }), Z, X)
    const round = footprintOf(ball({ x: 0, y: 0, z: 0 }, 100), Z, X)
    assert.isDefined(slab)
    assert.isDefined(round)
    assert.deepStrictEqual(fullnessOf(slab), { solid: 1, drift: 0 })
    assert.closeTo(fullnessOf(round).solid, 2 / 3, 0.03)
    // A slab leaning along its length: every column as deep, their middles far apart.
    const leaning = footprintOf(
      trianglesOfPlacement({
        kind: "box",
        center: { x: 0, y: 0, z: 0 },
        half: { x: 100, y: 100, z: 10 },
        rotation: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.5)
      }),
      Z,
      X
    )
    assert.isDefined(leaning)
    assert.isAbove(fullnessOf(leaning).drift, 2)
  })
})

describe("a footprint's layers", () => {
  it("is one layer for a part of one depth", () => {
    const f = footprintOf(parts["plate with two slots"]?.() ?? new Float32Array(), Z, X)
    assert.isDefined(f)
    const layers = layersOf(f)
    assert.strictEqual(layers.length, 1)
    assert.deepStrictEqual([layers[0]?.near, layers[0]?.far], [-10, 10])
    assert.deepStrictEqual(layers[0]?.own, f.mask)
    assert.deepStrictEqual(layers[0]?.allowed, f.mask)
  })

  it("splits a tower from the lower plate beside it, the larger first", () => {
    const plate = box({ x: 0, y: 0, z: 0 }, { x: 150, y: 60, z: 10 })
    const tower = box({ x: 200, y: 0, z: 0 }, { x: 50, y: 60, z: 40 })
    const f = footprintOf(joined([plate, tower]), Z, X)
    assert.isDefined(f)
    const [low, tall, ...more] = layersOf(f)
    assert.isEmpty(more)
    assert.deepStrictEqual([low?.near, low?.far, tall?.near, tall?.far], [-10, 10, -40, 40])
    assert.strictEqual(count(low?.own ?? new Uint8Array()) + count(tall?.own ?? new Uint8Array()), count(f.mask))
    assert.closeTo(count(low?.own ?? new Uint8Array()) / count(tall?.own ?? new Uint8Array()), 3, 0.1)
    // A piece of the plate may run on into the tower, which holds its depth; the tower's may not leave the tower.
    assert.deepStrictEqual(low?.allowed, f.mask)
    assert.deepStrictEqual(tall?.allowed, tall?.own)
  })

  it("gives a thin rim of another depth to the layer it borders", () => {
    // A plate with a lip 5 cm wide round it, 6 cm lower: two pixels wide, so without a body.
    const plate = box({ x: 0, y: 0, z: 0 }, { x: 150, y: 150, z: 20 })
    const lip = box({ x: 0, y: 0, z: -3 }, { x: 155, y: 155, z: 17 })
    const f = footprintOf(joined([plate, lip]), Z, X)
    assert.isDefined(f)
    const layers = layersOf(f)
    assert.strictEqual(layers.length, 1)
    assert.deepStrictEqual(layers[0]?.own, f.mask)
  })
})

describe("the shapes offered to a cover", () => {
  it("offers a rectangle its own rectangle, whole", () => {
    // A picture whose diagonal is a whole, even number of pixels, as its sides are: the grid the rectangles are
    // found on then lies on the picture's own pixels.
    const { layer, proposals } = drawn(60, 80, (x, y) => x > 8 && x < 52 && y > 10 && y < 70)
    const whole = proposals.find((p) => p.pixels.length === count(layer.own) && p.spill === 0)
    assert.deepStrictEqual(whole?.shape, { kind: "rectangle", cu: 30, cv: 40, ru: 22, rv: 30, angle: 0 })
    assert.isTrue(proposals.every((p) => p.layer === 0 && p.spill <= 0.05 * (p.pixels.length + p.spill)))
  })

  it("offers a rectangle along the outline's own direction when that isn't the grid's", () => {
    // A bar 60 by 12 turned 30°.
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6)
    const { layer, proposals } = drawn(80, 80, (x, y) => {
      const dx = x - 40, dy = y - 40
      return Math.abs(dx * c + dy * s) < 30 && Math.abs(dy * c - dx * s) < 6
    })
    const most = proposals.toSorted((a, b) => b.pixels.length - 2 * b.spill - a.pixels.length + 2 * a.spill)[0]
    assert.strictEqual(most?.shape.kind, "rectangle")
    assert.isAbove((most?.pixels.length ?? 0) / count(layer.own), 0.75)
  })

  it("offers a disc a disc", () => {
    const { layer, proposals } = drawn(60, 60, (x, y) => Math.hypot(x - 30, y - 30) < 20)
    const discs = proposals.filter((p) => p.shape.kind === "ellipse")
    const most = discs.toSorted((a, b) => b.pixels.length - a.pixels.length)[0]
    assert.isAbove((most?.pixels.length ?? 0) / count(layer.own), 0.95)
    // No rectangle covers a disc as well.
    const rectangles = proposals.filter((p) => p.shape.kind === "rectangle").map((p) => p.pixels.length)
    assert.isBelow(Math.max(...rectangles), most?.pixels.length ?? 0)
  })

  it("offers triangles at a sharp tip, legs along its two sides", () => {
    // A wedge with its tip at (30, 55), 40 wide at its base.
    const { layer, proposals } = drawn(60, 60, (x, y) => y > 5 && y < 55 && Math.abs(x - 30) < (55 - y) * 0.4)
    const triangles = proposals.flatMap((p) => p.shape.kind === "triangle" ? [{ ...p, shape: p.shape }] : [])
    assert.isNotEmpty(triangles)
    const most = triangles.toSorted((a, b) => b.pixels.length - a.pixels.length)[0]
    assert.isAbove((most?.pixels.length ?? 0) / count(layer.own), 0.9)
    // The apex is where the two sides' lines meet, a pixel or two past the blunted tip.
    assert.closeTo(most?.shape.apex[0] ?? 0, 30, 1)
    assert.closeTo(most?.shape.apex[1] ?? 0, 55, 3)
  })

  it("offers nothing for an empty layer, or one too small to gain from", () => {
    assert.isEmpty(drawn(40, 40, () => false).proposals)
    assert.isEmpty(drawn(40, 40, (x, y) => x < 1 && y < 3).proposals)
  })
})

describe("flat profiles", () => {
  const depthOf = (piece: Placement) => piece.kind === "pyramid" ? piece.half.x : piece.half.z

  for (const [name, build] of Object.entries(parts)) {
    for (const tilted of [false, true]) {
      it(`covers a ${name}${tilted ? ", tilted" : ""}, with pieces as deep as the part`, async () => {
        await meshReady
        const split = profileSplit(build(tilted), { budget: 64 })
        assert.strictEqual(split.parts.length, 1)
        assert.strictEqual(split.remainder.length, 0)
        const covers = split.parts[0]?.covers ?? []
        const fullest = covers.at(-1)
        assert.isDefined(fullest)
        assert.isAtMost(fullest.uncovered, 0.1)
        assert.isAtMost(fullest.placements.length, 64)
        // Fewest pieces first, each cover leaving less out and starting with the one before.
        covers.slice(1).forEach((cover, k) => {
          const before = covers[k]
          assert.isBelow(cover.uncovered, before?.uncovered ?? 0)
          assert.deepStrictEqual(cover.placements.slice(0, before?.placements.length), before?.placements)
        })
        for (const piece of fullest.placements) {
          assert.closeTo(depthOf(piece), 10, 1e-3)
          const centre = tilted ? rotateVec({ ...tilt, w: -tilt.w }, piece.center) : piece.center
          assert.closeTo(centre.z, 0, 1e-3)
          assert.isBelow(Math.max(Math.abs(centre.x), Math.abs(centre.y)), 120)
        }
      })
    }
  }

  it("gives a tapering outline a flat pyramid and a ring no more than boxes and cylinders", async () => {
    await meshReady
    const kinds = (triangles: Float32Array) =>
      profileSplit(triangles, { budget: 64 }).parts[0]?.covers.at(-1)?.placements.map((p) => p.kind).toSorted()
    assert.deepStrictEqual(kinds(prism([[-40, -100], [40, -100], [0, 100]])), ["pyramid"])
    assert.deepStrictEqual([...new Set(kinds(swept(ring)))], ["box", "cylinder"])
  })

  it("leaves a part that isn't a prism in the remainder, beside one that is", async () => {
    await meshReady
    // The ball as the split reads it: without its triangles of no area at the poles.
    const round = joined(componentsOf(ball({ x: 400, y: 0, z: 0 }, 80))), flat = swept(ring)
    assert.isEmpty(profileSplit(round, { budget: 64 }).parts)
    const split = profileSplit(joined([round, flat]), { budget: 64 })
    assert.strictEqual(split.parts.length, 1)
    assert.strictEqual(split.parts[0]?.triangles.length, flat.length)
    assert.deepStrictEqual(split.remainder, round)
  })

  it("leaves out a part shorter than the least length", async () => {
    await meshReady
    const triangles = swept(ring)
    assert.strictEqual(profileSplit(triangles, { budget: 64, least: 200 }).parts.length, 1)
    const short = profileSplit(triangles, { budget: 64, least: 250 })
    assert.isEmpty(short.parts)
    assert.strictEqual(short.remainder.length, triangles.length)
  })

  it("takes no more pieces than the budget, and gives up a part it can't cover within it", async () => {
    await meshReady
    const triangles = swept(ring)
    const full = profileSplit(triangles, { budget: 64 }).parts[0]?.covers.at(-1)?.placements.length ?? 0
    assert.isAbove(full, 4)
    const capped = profileSplit(triangles, { budget: full - 1 }).parts[0]?.covers.at(-1)?.placements.length ?? 0
    assert.isAtMost(capped, full - 1)
    assert.isEmpty(profileSplit(triangles, { budget: 2 }).parts)
  })

  it("keeps every part in the remainder once its three seconds of work are up", async () => {
    await meshReady
    const triangles = joined([swept(ring), prism([[300, -100], [380, -100], [340, 100]])])
    // The clock is read to start, then once a part, an axis and a piece: a second a read stops it inside the cover.
    let seconds = 0
    setClock(() => 1000 * seconds++)
    const late = profileSplit(triangles, { budget: 64 })
    assert.isEmpty(late.parts)
    assert.deepStrictEqual(late.remainder, joined(componentsOf(triangles).toSorted((a, b) => b.length - a.length)))
    assert.isBelow(seconds, 8)
  })
})

describe("a profile piece narrowed", () => {
  const piece = (kind: Placement["kind"], half: Vec3): Placement => ({
    kind,
    center: { x: 1, y: 2, z: 3 },
    half,
    rotation: IDENTITY_QUAT
  })

  it("narrows a box or cylinder on its shorter side and thins it along its sweep", () => {
    assert.deepStrictEqual(narrowed(piece("box", { x: 40, y: 10, z: 8 }), 0.5, 0.25).half, { x: 40, y: 5, z: 2 })
    assert.deepStrictEqual(narrowed(piece("cylinder", { x: 10, y: 40, z: 8 }), 0.5, 0.25).half, { x: 5, y: 40, z: 2 })
    // A square or round one is narrowed on one side only.
    assert.deepStrictEqual(narrowed(piece("box", { x: 10, y: 10, z: 8 }), 0.5, 1).half, { x: 10, y: 5, z: 8 })
  })

  it("thins a pyramid through its thickness only, and leaves a sphere alone", () => {
    assert.deepStrictEqual(narrowed(piece("pyramid", { x: 8, y: 20, z: 30 }), 0.5, 0.25).half, { x: 2, y: 20, z: 30 })
    const sphere = piece("sphere", { x: 8, y: 8, z: 8 })
    assert.strictEqual(narrowed(sphere, 0.5, 0.25), sphere)
    assert.strictEqual(
      vecLength(vecSub(narrowed(piece("box", { x: 4, y: 2, z: 1 }), 0.5, 0.5).center, sphere.center)),
      0
    )
  })
})
