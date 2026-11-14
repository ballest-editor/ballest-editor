import { assert, describe, it } from "@effect/vitest"
import { turned } from "../../../test/placement"
import type { Vec3 } from "../../coords"
import { IDENTITY_QUAT, quatFromAxisAngle, quatMul, rotateVec, vecDistance, vecDot } from "../../ueMath"
import { trianglesBox } from "../grid/voxelize"
import { trianglesOfPlacement } from "../look/views"
import { type Placement, shapeKinds } from "../shapes"
import { joined } from "./meshParts"
import {
  chosenSymmetries,
  IDENTITY_MOTION,
  membersOf,
  mirrorMotion,
  mirrorPlacement,
  mirrorPoint,
  type MirrorSymmetry,
  movedPlacement,
  seedsOf,
  shapeGap,
  snappedTo,
  symmetriesOf,
  symmetrized,
  type Symmetry,
  turnMotion,
  type TurnSymmetry,
  tyingOf
} from "./symmetry"

const X: Vec3 = { x: 1, y: 0, z: 0 }
const Y: Vec3 = { x: 0, y: 1, z: 0 }
const Z: Vec3 = { x: 0, y: 0, z: 1 }
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }
/** The plane y = 0. */
const SIDE_PLANE = { normal: Y, offset: 0 }
const Z_LINE = { direction: Z, through: ORIGIN }

const piece = turned

const meshOf = (placements: ReadonlyArray<Placement>): Float32Array => joined(placements.map(trianglesOfPlacement))

/** The first mirror of `symmetries`, which must have one. */
const mirrorOf = (symmetries: ReadonlyArray<Symmetry>): MirrorSymmetry => {
  const found = symmetries.find((s) => s.kind === "mirror")
  assert.isDefined(found)
  return found
}

/** The first turn of `symmetries`, which must have one. */
const turnIn = (symmetries: ReadonlyArray<Symmetry>): TurnSymmetry => {
  const found = symmetries.find((s) => s.kind === "turn")
  assert.isDefined(found)
  return found
}

const tumbled = quatMul(quatFromAxisAngle(X, 0.5), quatFromAxisAngle(Z, 0.8))

describe("moving a piece", () => {
  it("mirrors a point across a plane that misses the origin", () => {
    assert.deepStrictEqual(mirrorPoint({ x: 3, y: 10, z: -2 }, { normal: Y, offset: 4 }), { x: 3, y: -2, z: -2 })
  })

  it.each(shapeKinds)("mirrors a tumbled %s onto its mirror image, with the same half sizes", (kind) => {
    const original = piece(kind, [40, 300, 20], [90, 50, 130], tumbled)
    const image = mirrorPlacement(original, SIDE_PLANE)
    assert.deepStrictEqual(image.half, original.half)
    // The image covers the original's box, reflected.
    const from = trianglesBox(trianglesOfPlacement(original)), to = trianglesBox(trianglesOfPlacement(image))
    assert.closeTo(vecDistance(to.min, { ...from.min, y: -from.max.y }), 0, 1e-2)
    assert.closeTo(vecDistance(to.max, { ...from.max, y: -from.min.y }), 0, 1e-2)
    assert.closeTo(shapeGap(mirrorPlacement(image, SIDE_PLANE), original), 0, 1e-6)
  })

  it("turns a piece about a line", () => {
    const original = piece("cone", [100, 0, 50], [30, 30, 80], quatFromAxisAngle(Y, Math.PI / 2))
    const quarter = movedPlacement(
      turnMotion({ direction: Z, through: { x: 100, y: 100, z: 0 } }, Math.PI / 2),
      original
    )
    assert.closeTo(vecDistance(quarter.center, { x: 200, y: 100, z: 50 }), 0, 1e-9)
    // The cone pointed along x and now points along y.
    assert.closeTo(vecDistance(rotateVec(quarter.rotation, Z), Y), 0, 1e-9)
  })

  it("leaves a piece as it is under the identity", () => {
    const original = piece("box", [1, 2, 3], [4, 5, 6], tumbled)
    assert.strictEqual(movedPlacement(IDENTITY_MOTION, original), original)
  })
})

describe("shapeGap", () => {
  const can = piece("cylinder", [0, 0, 0], [50, 50, 120])

  it("is how far the pieces' shapes are apart", () => {
    assert.strictEqual(shapeGap(can, { ...can, kind: "capsule" }), Infinity)
    assert.closeTo(shapeGap(can, { ...can, center: { x: 0, y: 7, z: 0 } }), 7, 1e-9)
    assert.closeTo(shapeGap(can, { ...can, half: { x: 50, y: 50, z: 123 } }), 3, 1e-9)
  })

  it("counts a turn that leaves the shape where it was as nothing", () => {
    // A round piece about its own axis, and end over end unless it has a tip.
    assert.closeTo(shapeGap(can, { ...can, rotation: quatFromAxisAngle(Z, 1.1) }), 0, 1e-9)
    assert.closeTo(shapeGap(can, { ...can, rotation: quatFromAxisAngle(X, Math.PI) }), 0, 1e-9)
    const cone: Placement = { ...can, kind: "cone" }
    assert.isAbove(shapeGap(cone, { ...cone, rotation: quatFromAxisAngle(X, Math.PI) }), 100)
    // A ball however it is turned, and a box by a half turn.
    const ball = piece("sphere", [0, 0, 0], [60, 60, 60])
    assert.closeTo(shapeGap(ball, { ...ball, rotation: tumbled }), 0, 1e-9)
    const box = piece("box", [0, 0, 0], [80, 30, 10])
    assert.closeTo(shapeGap(box, { ...box, rotation: quatFromAxisAngle(Z, Math.PI) }), 0, 1e-6)
    assert.isAbove(shapeGap(box, { ...box, rotation: quatFromAxisAngle(Z, Math.PI / 2) }), 50)
  })
})

/** A cart: a body, an axle through it, and a handle at one end, so only the plane y = 0 mirrors it. */
const cart = [
  piece("box", [0, 0, 0], [300, 160, 90]),
  piece("cylinder", [-80, 0, -90], [50, 50, 220], quatFromAxisAngle(X, Math.PI / 2)),
  piece("cone", [380, 0, 60], [60, 60, 120], quatFromAxisAngle(Y, Math.PI / 2)),
  piece("sphere", [-200, 0, 150], [70, 70, 50])
]

/** A propeller: a hub on the z axis and three blades tilted the same way round it. */
const blade = (k: number): Placement => {
  const angle = 2 * Math.PI * k / 3
  return piece(
    "box",
    [330 * Math.cos(angle), 330 * Math.sin(angle), 0],
    [240, 60, 12],
    quatMul(quatFromAxisAngle(Z, angle), quatFromAxisAngle(X, 0.5))
  )
}
const propeller = [piece("cone", [0, 0, 20], [90, 90, 110]), blade(0), blade(1), blade(2)]

describe("symmetriesOf", () => {
  it("finds a cart's one mirror plane, and ties pieces by it", () => {
    const chosen = chosenSymmetries(symmetriesOf(meshOf(cart)))
    assert.deepStrictEqual(chosen.map((s) => s.kind), ["mirror"])
    const mirror = mirrorOf(chosen)
    assert.isAbove(Math.abs(mirror.plane.normal.y), 0.999)
    assert.closeTo(mirror.plane.offset, 0, 2)
    assert.isAbove(mirror.holds, 0.95)
    assert.isBelow(mirror.residual, 0.005)
  })

  it("finds a propeller's three-fold turn, and no mirror: the blades are tilted", () => {
    const report = symmetriesOf(meshOf(propeller))
    const chosen = chosenSymmetries(report)
    assert.deepStrictEqual(chosen.map((s) => s.kind), ["turn"])
    const turn = turnIn(chosen)
    assert.strictEqual(turn.order, 3)
    assert.isFalse(turn.round)
    assert.isAbove(Math.abs(turn.axis.direction.z), 0.999)
    assert.isBelow(Math.hypot(turn.axis.through.x, turn.axis.through.y), 5)
    // Half the box's diagonal.
    const box = trianglesBox(meshOf(propeller))
    assert.closeTo(report.radius, vecDistance(box.min, box.max) / 2, 1e-6)
  })

  it("calls a bottle round about its axis, with the planes through it", () => {
    const bottle = [piece("cylinder", [0, 0, 0], [120, 120, 200]), piece("cone", [0, 0, 300], [120, 120, 100])]
    const chosen = chosenSymmetries(symmetriesOf(meshOf(bottle)))
    const turn = turnIn(chosen)
    assert.strictEqual(chosen[0], turn)
    assert.isTrue(turn.round)
    assert.strictEqual(turn.order, 12)
    assert.isAbove(Math.abs(turn.axis.direction.z), 0.999)
    assert.isAbove(chosen.length, 1)
    for (const s of chosen.slice(1)) {
      assert.strictEqual(s.kind, "mirror")
      if (s.kind === "mirror") assert.isBelow(Math.abs(s.plane.normal.z), 0.02)
    }
  })

  it("finds nothing to tie pieces by on a lopsided model", () => {
    const lump = [
      piece("box", [0, 0, 0], [300, 200, 100], tumbled),
      piece("cone", [250, 180, 90], [160, 100, 320], quatFromAxisAngle(Y, 0.9)),
      piece("sphere", [-260, 90, -140], [220, 140, 80], quatFromAxisAngle(X, 0.4))
    ]
    assert.deepStrictEqual(chosenSymmetries(symmetriesOf(meshOf(lump))), [])
  })

  it("says which parts and samples a symmetry holds on", () => {
    // The cart with a lamp on one side only: the mirror holds on the cart's four parts and not on the lamp.
    const lamp = piece("sphere", [100, 420, 200], [60, 60, 60])
    const report = symmetriesOf(meshOf([...cart, lamp]))
    const mirror = mirrorOf(report.symmetries.filter((s) => s.kind === "mirror" && Math.abs(s.plane.normal.y) > 0.99))
    const { mask, partOf, parts, points } = mirror.where
    assert.strictEqual(parts.length, 5)
    assert.isBelow(parts[4] ?? 1, 0.05)
    for (const share of parts.slice(0, 4)) assert.isAbove(share, 0.9)
    assert.strictEqual(points.length, 3 * mask.length)
    const held = mask.reduce((n, m) => n + m, 0)
    assert.closeTo(mirror.holds, held / mask.length, 1e-12)
    assert.isTrue(partOf.every((part, i) => part !== 4 || mask[i] === 0))
    assert.isAtMost(mirror.exact, mirror.holds)
  })
})

/** A symmetry that holds everywhere. */
const everywhere = {
  residual: 0,
  holds: 1,
  exact: 1,
  where: { points: Float64Array.of(0, 0, 0), mask: Uint8Array.of(1), partOf: Uint16Array.of(0), parts: [1] }
}
const mirrorIn = (normal: Vec3, offset = 0): Symmetry => ({ kind: "mirror", plane: { normal, offset }, ...everywhere })
const turnOf = (order: number, round = false): Symmetry => ({ kind: "turn", axis: Z_LINE, order, round, ...everywhere })

describe("chosenSymmetries", () => {
  it("takes the turn of highest order that holds about as well as the best, then the mirrors", () => {
    const weak: Symmetry = { ...mirrorIn(X), holds: 0.8 }
    const rough: Symmetry = { ...mirrorIn(Z), holds: 0.9, exact: 0.4 }
    const two: Symmetry = { ...turnOf(2), holds: 1 }
    const five: Symmetry = { ...turnOf(5), holds: 0.96 }
    const ten: Symmetry = { ...turnOf(10), holds: 0.9 }
    const mirror = mirrorIn(Y)
    assert.deepStrictEqual(
      chosenSymmetries({ radius: 100, symmetries: [two, mirror, five, ten, rough, weak] }),
      [five, mirror]
    )
  })
})

describe("tyingOf", () => {
  it("makes the whole group the symmetries generate", () => {
    assert.strictEqual(tyingOf([], 100).group.length, 1)
    assert.strictEqual(tyingOf([mirrorIn(Y)], 100).group.length, 2)
    assert.strictEqual(tyingOf([mirrorIn(Y), mirrorIn(X)], 100).group.length, 4)
    assert.strictEqual(tyingOf([turnOf(5)], 100).group.length, 5)
    // A turn, a plane through its axis and the plane across it.
    assert.strictEqual(tyingOf([turnOf(3), mirrorIn(Y), mirrorIn(Z)], 100).group.length, 12)
  })

  it("makes a mirror nearly through a turn's axis exactly so, and leaves out one at an odd angle", () => {
    const nearly = mirrorIn({ x: 0, y: Math.cos(0.05), z: Math.sin(0.05) })
    const tying = tyingOf([turnOf(4), nearly, mirrorIn({ x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 })], 100)
    assert.strictEqual(tying.group.length, 8)
    // Every motion keeps the axis as a line: a point on it stays on it.
    for (const motion of tying.group) {
      const moved = movedPlacement(motion, piece("sphere", [0, 0, 50], [1, 1, 1])).center
      assert.closeTo(Math.hypot(moved.x, moved.y), 0, 1e-9)
    }
  })

  it("leaves out a second mirror that isn't nearly square to the first", () => {
    const slanted = mirrorIn({ x: Math.sin(0.5), y: Math.cos(0.5), z: 0 })
    assert.strictEqual(tyingOf([mirrorIn(Y), slanted], 100).group.length, 2)
  })

  it("ties a piece only by the symmetries that hold where it is", () => {
    // The mirror holds on the samples with x below zero only.
    const xs = [-300, -200, -100, -50, 50, 100, 200, 300]
    const half: Symmetry = {
      ...mirrorIn(Y),
      where: {
        points: Float64Array.from(xs.flatMap((x) => [x, 0, 0])),
        mask: Uint8Array.from(xs.map((x) => x < 0 ? 1 : 0)),
        partOf: new Uint16Array(xs.length),
        parts: [0.5]
      }
    }
    const tying = tyingOf([half], 100)
    assert.strictEqual(tying.groupAt(piece("box", [-200, 40, 0], [160, 10, 10])).length, 2)
    assert.strictEqual(tying.groupAt(piece("box", [200, 40, 0], [160, 10, 10])).length, 1)
    // With no sample in reach, the nearest few say.
    assert.strictEqual(tying.groupAt(piece("box", [-900, 40, 0], [5, 5, 5])).length, 2)
    assert.strictEqual(tying.groupAt(piece("box", [900, 40, 0], [5, 5, 5])).length, 1)
  })
})

describe("snappedTo", () => {
  const mirror = mirrorMotion(SIDE_PLANE)

  it("puts a piece near a mirror plane on it, squared to it", () => {
    const leaning = piece("box", [50, 6, 0], [80, 40, 20], quatFromAxisAngle(Z, 0.1))
    const snapped = snappedTo(leaning, [mirror])
    assert.closeTo(snapped?.center.y ?? 1, 0, 1e-9)
    assert.closeTo(snapped?.center.x ?? 0, 50, 1e-9)
    assert.isDefined(snapped)
    assert.closeTo(shapeGap(movedPlacement(mirror, snapped), snapped), 0, 1e-6)
  })

  it("lays a round piece in the plane when that turns it less than standing it across", () => {
    const lying = snappedTo(piece("cylinder", [0, 3, 0], [20, 20, 90], quatFromAxisAngle(X, 0.2)), [mirror])
    assert.closeTo(Math.abs(rotateVec(lying?.rotation ?? IDENTITY_QUAT, Z).z), 1, 1e-9)
    const across = snappedTo(piece("cylinder", [0, 3, 0], [20, 20, 90], quatFromAxisAngle(X, 1.4)), [mirror])
    assert.closeTo(Math.abs(rotateVec(across?.rotation ?? IDENTITY_QUAT, Z).y), 1, 1e-9)
  })

  it("stands a piece on a turn's axis with equal sides, when its kind can have them", () => {
    const turns = (order: number) =>
      Array.from({ length: order - 1 }, (_, k) => turnMotion(Z_LINE, 2 * Math.PI * (k + 1) / order))
    const box = piece("box", [4, -3, 70], [60, 40, 90], quatFromAxisAngle(X, 0.1))
    const square = snappedTo(box, turns(4))
    assert.closeTo(Math.hypot(square?.center.x ?? 1, square?.center.y ?? 1), 0, 1e-9)
    assert.deepStrictEqual(square?.half, { x: 50, y: 50, z: 90 })
    assert.closeTo(Math.abs(rotateVec(square?.rotation ?? IDENTITY_QUAT, Z).z), 1, 1e-9)
    assert.isUndefined(snappedTo(box, turns(5)))
    assert.strictEqual(snappedTo({ ...box, kind: "cylinder" }, turns(5))?.half.x, 50)
    // A half turn only needs one of the box's axes along it.
    assert.deepStrictEqual(snappedTo(box, turns(2))?.half, box.half)
    assert.strictEqual(snappedTo(box, []), box)
  })
})

describe("symmetrized", () => {
  it("keeps the pieces on the seed's side with their mirror images, and snaps one that straddles the plane", () => {
    const tying = tyingOf([mirrorIn(Y)], 500)
    const wheel = piece("cylinder", [100, 200, 0], [60, 60, 20], quatFromAxisAngle(X, Math.PI / 2))
    const farWheel = piece("cylinder", [-120, -210, 5], [55, 60, 20], quatFromAxisAngle(X, Math.PI / 2))
    const body = piece("box", [0, 8, 40], [250, 120, 60], quatFromAxisAngle(Z, 0.05))
    const { orbits, placements } = symmetrized([wheel, farWheel, body], tying, { x: 0, y: 300, z: 0 })
    // The far wheel is on the other side: the near one's image stands in for it.
    assert.deepStrictEqual(orbits.map((orbit) => orbit.motions.length), [2, 1])
    assert.deepStrictEqual(orbits.map((orbit) => orbit.stabilizer.length), [0, 1])
    assert.strictEqual(placements.length, 3)
    assert.deepStrictEqual(placements, orbits.flatMap(membersOf))
    assert.strictEqual(placements[0], wheel)
    assert.closeTo(shapeGap(placements[1] ?? wheel, mirrorPlacement(wheel, SIDE_PLANE)), 0, 1e-6)
    assert.closeTo(placements[2]?.center.y ?? 1, 0, 1e-9)
    assert.closeTo(shapeGap(mirrorPlacement(placements[2] ?? body, SIDE_PLANE), placements[2] ?? body), 0, 1e-6)
  })

  it("makes a ring of pieces from one sector of a turn, and keeps one on the axis single", () => {
    const tying = tyingOf([turnOf(5)], 500)
    const arm = (k: number, long: number) => {
      const angle = 2 * Math.PI * k / 5 + 0.3
      return piece(
        "box",
        [300 * Math.cos(angle), 300 * Math.sin(angle), 0],
        [long, 40, 30],
        quatFromAxisAngle(Z, angle)
      )
    }
    const arms = [0, 1, 2, 3, 4].map((k) => arm(k, 100 + 5 * k))
    const hub = piece("cylinder", [3, -2, 0], [90, 80, 50])
    const [seed] = seedsOf([hub, ...arms], tying)
    assert.strictEqual(seedsOf([hub, ...arms], tying).length, 5)
    // The most generic centre is the longest arm's.
    assert.deepStrictEqual(seed, arms[4]?.center)
    const { orbits, placements } = symmetrized([hub, ...arms], tying)
    assert.deepStrictEqual(orbits.map((orbit) => orbit.motions.length), [1, 5])
    assert.strictEqual(orbits[0]?.stabilizer.length, 4)
    assert.deepStrictEqual(orbits[0]?.piece.half, { x: 85, y: 85, z: 50 })
    assert.strictEqual(orbits[1]?.piece, arms[4])
    // Every arm's place is taken by an image of the longest.
    for (const original of arms) {
      const nearest = Math.min(
        ...placements.slice(1).map((image) => shapeGap(image, { ...original, half: image.half }))
      )
      assert.closeTo(nearest, 0, 1e-6)
    }
  })

  it("leaves pieces alone where no symmetry holds, and one that can't be made to stay put", () => {
    const nowhere: Symmetry = { ...turnOf(5), where: { ...everywhere.where, mask: Uint8Array.of(0) } }
    const free = piece("box", [200, 0, 0], [50, 20, 20])
    assert.deepStrictEqual(symmetrized([free], tyingOf([nowhere], 500)).placements, [free])
    // A box on a five-fold axis.
    const stuck = piece("box", [2, 1, 0], [80, 60, 40])
    const { orbits } = symmetrized([stuck], tyingOf([turnOf(5)], 500))
    assert.deepStrictEqual(orbits, [{ piece: stuck, motions: [IDENTITY_MOTION], stabilizer: [] }])
  })

  it("is what the model's own symmetry makes of pieces fitted to one side of it", () => {
    const report = symmetriesOf(meshOf(cart))
    const tying = tyingOf(chosenSymmetries(report), report.radius)
    const lamp = piece("sphere", [150, 230, 120], [40, 40, 40])
    const { placements } = symmetrized([lamp], tying)
    assert.strictEqual(placements.length, 2)
    assert.closeTo(vecDot(placements[1]?.center ?? ORIGIN, Y), -230, 3)
  })
})
