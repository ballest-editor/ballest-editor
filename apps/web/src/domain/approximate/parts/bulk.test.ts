import { assert, describe, it } from "@effect/vitest"
import type { Vec3 } from "../../coords"
import { IDENTITY_QUAT, quatFromAxisAngle } from "../../ueMath"
import { PlateSolid } from "../grid/solid"
import type { VoxelGrid } from "../grid/voxelize"
import type { Placement } from "../shapes"
import { bulkPrimitives, holder } from "./bulk"

const VOXEL = 10
const CELLS = 36

/** A cube of cells 360 cm a side about the origin, solid where `inside` says. */
const solidOf = (inside: (p: Vec3) => boolean): PlateSolid => {
  const cells = new Uint8Array(CELLS ** 3)
  const middle = (i: number) => (i + 0.5 - CELLS / 2) * VOXEL
  cells.forEach((_, i) => {
    const p = { x: middle(i % CELLS), y: middle(Math.floor(i / CELLS) % CELLS), z: middle(Math.floor(i / CELLS ** 2)) }
    if (inside(p)) cells[i] = 1
  })
  const corner = -CELLS * VOXEL / 2
  const grid: VoxelGrid = { n: [CELLS, CELLS, CELLS], origin: { x: corner, y: corner, z: corner }, voxel: VOXEL, cells }
  return new PlateSolid(grid)
}

interface Egg {
  readonly centre: Vec3
  readonly half: Vec3
}

const inEgg = ({ centre: c, half: h }: Egg, p: Vec3) =>
  ((p.x - c.x) / h.x) ** 2 + ((p.y - c.y) / h.y) ** 2 + ((p.z - c.z) / h.z) ** 2 <= 1

/** `count` points spread over the egg's surface. */
const onEgg = ({ centre: c, half: h }: Egg, count: number): Array<Vec3> =>
  Array.from({ length: count }, (_, k) => {
    const z = 1 - 2 * (k + 0.5) / count, ring = Math.sqrt(1 - z * z), angle = k * 2.399963
    return { x: c.x + h.x * ring * Math.cos(angle), y: c.y + h.y * ring * Math.sin(angle), z: c.z + h.z * z }
  })

const options = { tolerance: 1.2 * VOXEL, proud: 0.4 * VOXEL, minShare: 0.05, most: 4 }

describe("bulkPrimitives", () => {
  const egg: Egg = { centre: { x: 10, y: -20, z: 0 }, half: { x: 150, y: 90, z: 90 } }

  it("takes one ellipsoid for an egg, about its size and place, and says what it explains", () => {
    const samples = onEgg(egg, 500)
    const found = bulkPrimitives(solidOf((p) => inEgg(egg, p)), samples, [], options)
    assert.strictEqual(found.length, 1)
    const [{ piece, points, share, spill } = { piece: undefined, points: new Float64Array(), share: 0, spill: 1 }] =
      found
    assert.strictEqual(piece?.kind, "sphere")
    assert.closeTo(piece?.center.x ?? 0, 10, 15)
    assert.closeTo(piece?.center.y ?? 0, -20, 15)
    assert.closeTo(Math.max(piece?.half.x ?? 0, piece?.half.y ?? 0, piece?.half.z ?? 0), 150, 20)
    assert.closeTo(Math.min(piece?.half.x ?? 0, piece?.half.y ?? 0, piece?.half.z ?? 0), 90, 20)
    assert.isAbove(share, 0.9)
    assert.isAtMost(spill, 0.06)
    // It steers by every other sample, and shows where those it explains are.
    assert.strictEqual(points.length, 3 * Math.round(share * 250))
    assert.deepStrictEqual(Array.from(points.subarray(0, 3)), [samples[0]?.x, samples[0]?.y, samples[0]?.z])
  })

  const left: Egg = { centre: { x: -95, y: 0, z: 0 }, half: { x: 70, y: 70, z: 70 } }
  const right: Egg = { centre: { x: 95, y: 0, z: 0 }, half: { x: 70, y: 70, z: 70 } }
  const pair = solidOf((p) => inEgg(left, p) || inEgg(right, p))
  const pairSamples = [...onEgg(left, 250), ...onEgg(right, 250)]

  it("takes a piece for each of two balls, and none that bridges the gap between them", () => {
    const found = bulkPrimitives(pair, pairSamples, [], options)
    assert.deepStrictEqual(found.map(({ piece }) => Math.sign(piece.center.x)).sort((a, b) => a - b), [-1, 1])
    for (const { piece, share } of found) {
      assert.closeTo(Math.abs(piece.center.x), 95, 15)
      assert.isBelow(Math.max(piece.half.x, piece.half.y, piece.half.z), 95)
      assert.closeTo(share, 0.5, 0.1)
    }
  })

  it("keeps no more than asked for, and none that explains too little", () => {
    assert.strictEqual(bulkPrimitives(pair, pairSamples, [], { ...options, most: 1 }).length, 1)
    assert.strictEqual(bulkPrimitives(pair, pairSamples, [], { ...options, minShare: 0.7 }).length, 0)
  })

  it("fits the same every time", () => {
    assert.deepStrictEqual(
      bulkPrimitives(pair, pairSamples, [], options),
      bulkPrimitives(pair, pairSamples, [], options)
    )
  })

  it("starts a piece from a thin part's cells too", () => {
    // A rod too thin for any cell of it to count as deep: only the part's cells seed a piece for it.
    const inRod = (p: Vec3) => Math.abs(p.x) <= 140 && Math.abs(p.y) <= 10 && Math.abs(p.z) <= 10
    const rod = solidOf(inRod)
    const samples = Array.from({ length: 280 }, (_, k) => {
      const angle = k * 2.399963
      return { x: -139.5 + k, y: 10 * Math.cos(angle), z: 10 * Math.sin(angle) }
    })
    const cells = Int32Array.from(rod.grid.cells.keys()).filter((i) => rod.grid.cells[i] === 1)
    assert.strictEqual(bulkPrimitives(rod, samples, [], options).length, 0)
    const [found] = bulkPrimitives(rod, samples, [{ cells, reach: 14, joint: new Int32Array() }], options)
    assert.closeTo(Math.max(found?.piece.half.x ?? 0, found?.piece.half.y ?? 0, found?.piece.half.z ?? 0), 140, 25)
  })
})

describe("holder", () => {
  const slab: Placement = {
    kind: "box",
    center: { x: 100, y: 0, z: 0 },
    half: { x: 50, y: 20, z: 10 },
    rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2)
  }
  const ball: Placement = {
    kind: "sphere",
    center: { x: -100, y: 0, z: 0 },
    half: { x: 30, y: 30, z: 30 },
    rotation: IDENTITY_QUAT
  }

  it("says whether a point is inside any of the pieces, each in its own frame and shape", () => {
    const inside = holder([slab, ball])
    // The slab's long side lies along y once turned.
    assert.isTrue(inside({ x: 100, y: 45, z: 0 }))
    assert.isFalse(inside({ x: 145, y: 0, z: 0 }))
    assert.isTrue(inside({ x: -100, y: 0, z: 29 }))
    // In the ball's box, outside the ball.
    assert.isFalse(inside({ x: -125, y: 25, z: 25 }))
    assert.isFalse(inside({ x: 0, y: 0, z: 0 }))
    assert.isFalse(holder([])({ x: 0, y: 0, z: 0 }))
  })

  it("grows each piece along its own axes, and shrinks one to nothing", () => {
    const p = { x: 100, y: 0, z: 14 }
    assert.isFalse(holder([slab])(p))
    assert.isTrue(holder([slab], 5)(p))
    assert.isTrue(holder([slab], -5)(slab.center))
    assert.isFalse(holder([slab], -10)(slab.center))
  })
})
