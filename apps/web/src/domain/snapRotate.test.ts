import { assert, describe, it } from "@effect/vitest"
import { boxAt, meshOfBox } from "../test/snapFixtures"
import type { Vec3 } from "./coords"
import {
  alignedTurns,
  type Body,
  firstContacts,
  snappedScale,
  turnLanding,
  turnReach,
  type TurnStop,
  turnStopsInOrder,
  wrapAngle
} from "./snapRotate"
import { rotateVec, rotatorToQuat } from "./ueMath"

const Z = { x: 0, y: 0, z: 1 }
const deg = (d: number) => d * Math.PI / 180
const toDeg = (r: number) => r * 180 / Math.PI

/** A 100 cm cube at `at` as a body: its eight corners and six faces. */
const cube = (at: Vec3, half = 50): Body => {
  const { faces, vertices } = meshOfBox(boxAt(at, half))
  return { points: vertices, faces }
}

describe("where a turn first meets a neighbour", () => {
  const contacts = (still: Body, pivot: Vec3 = { x: 0, y: 0, z: 0 }) =>
    firstContacts({ axis: Z, pivot, moving: cube({ x: 0, y: 0, z: 0 }), still, tolerance: 1 })

  it("is where a corner swings onto a face, each way round", () => {
    // the near face is 10 cm off: a corner 70.7 cm out reaches x = 60 at 45° - 31.95°
    const { ahead, behind } = contacts(cube({ x: 110, y: 0, z: 0 }))
    assert.closeTo(toDeg(ahead?.angle ?? 0), 13.05, 0.01)
    assert.closeTo(toDeg(behind?.angle ?? 0), -13.05, 0.01)
    assert.closeTo(ahead?.at.x ?? 0, 60, 1e-6)
    assert.strictEqual(ahead?.face.normal.x, -1)
  })

  it("is where a face swings onto a neighbour's corner", () => {
    // a corner of the neighbour stands in front of the cube's +X face, which no corner of the cube reaches first
    const corner: Body = { points: [{ x: 60, y: 0, z: 0 }], faces: [] }
    const { ahead, behind } = contacts(corner)
    assert.closeTo(toDeg(ahead?.angle ?? 0), 33.56, 0.01)
    assert.closeTo(toDeg(behind?.angle ?? 0), -33.56, 0.01)
    assert.deepStrictEqual(ahead?.at, { x: 60, y: 0, z: 0 })
  })

  it("meets at once what it touches at the start, both ways when either corner swings in", () => {
    const { ahead, behind } = contacts(cube({ x: 100, y: 0, z: 0 }))
    assert.strictEqual(ahead?.angle, 0)
    assert.strictEqual(behind?.angle, 0)
  })

  it("meets nothing it can't reach", () => {
    assert.deepStrictEqual(contacts(cube({ x: 200, y: 0, z: 0 })), {})
  })

  it("meets at once only the way that takes it in", () => {
    // swung about its far edge, the cube's touching face leaves the neighbour clockwise and goes into it the other way
    const { ahead, behind } = contacts(cube({ x: 100, y: 0, z: 0 }), { x: -50, y: 50, z: 0 })
    assert.strictEqual(ahead?.angle, 0)
    assert.notStrictEqual(behind?.angle, 0)
  })

  it("is a whole face coming flush, swung shut about an edge", () => {
    // a door on its hinge at (50, 50) closes onto a wall whose face is at x = 150
    const { ahead } = contacts(cube({ x: 200, y: 0, z: 0 }), { x: 50, y: 50, z: 0 })
    assert.closeTo(toDeg(ahead?.angle ?? 0), 90, 1e-6)
  })
})

describe("where a turn lines axes up", () => {
  const axesOf = (yaw: number) =>
    [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, Z].map((axis) =>
      rotateVec(rotatorToQuat({ pitch: 0, roll: 0, yaw }), axis)
    )

  it("lays an axis along another's each quarter turn, naming the ones that meet their own", () => {
    const turns = alignedTurns(axesOf(0), axesOf(30), Z).map(({ angle, same }) => [Math.round(toDeg(angle)), same])
    assert.sameDeepMembers(turns, [[30, [0, 1]], [-150, [0, 1]], [120, []], [-60, []]])
  })

  it("leaves out the turn's own axis, which no turn moves", () => {
    assert.isTrue(alignedTurns([Z], axesOf(30), Z).length === 0)
  })
})

const stop = (degrees: number, kind: TurnStop["kind"] = "touch"): TurnStop => ({
  angle: deg(degrees),
  kind,
  from: "mesh",
  relation: "onFace",
  label: `${kind} ${degrees}`,
  marks: []
})

describe("a turn's stops", () => {
  it("keep one at an angle, the most particular kind", () => {
    const stops = turnStopsInOrder([stop(90, "grid"), stop(-90, "grid"), stop(90, "aligned"), stop(13, "touch")])
    assert.deepStrictEqual(stops.map(({ kind }) => kind), ["grid", "touch", "aligned"])
  })

  it("wrap round the half turn", () => {
    assert.closeTo(wrapAngle(deg(190)), deg(-170), 1e-12)
    assert.closeTo(wrapAngle(-Math.PI), Math.PI, 1e-12)
    assert.closeTo(wrapAngle(deg(-30)), deg(-30), 1e-12)
  })
})

describe("getting to a turn's stop", () => {
  // the shared 12 px threshold on the 78 px ring: 8.8°
  const { nudge, reach } = turnReach(12, 78)
  const at30 = [stop(30)]
  /** The angles a turn lands on through the pointer's `samples`, in degrees. */
  const landings = (samples: ReadonlyArray<number>, stops = at30, hold = false) => {
    let from = 0
    let on: TurnStop | undefined
    return samples.map((free) => {
      const landed = turnLanding({ free: deg(free), from: deg(from), on, stops, reach, nudge, hold })
      from = free
      on = landed.on
      return Math.round(toDeg(landed.angle) * 10) / 10
    })
  }

  it("holds as far past as the threshold reaches along the ring", () => {
    assert.closeTo(toDeg(reach), 8.81, 0.01)
    assert.deepStrictEqual(landings([20, 29, 34, 38, 39.5, 40]), [20, 29, 30, 30, 39.5, 40])
  })

  it("reaches a stop a pixel ahead", () => {
    assert.deepStrictEqual(landings([20, 29.5]), [20, 30])
  })

  it("doesn't catch coming back until it crosses again", () => {
    assert.deepStrictEqual(landings([20, 35, 41, 35, 25]), [20, 30, 41, 35, 30])
  })

  it("goes through a stop it passes by more than the threshold", () => {
    assert.deepStrictEqual(landings([45]), [45])
  })

  it("doesn't catch on a stop it starts on", () => {
    assert.deepStrictEqual(landings([5, 10], [stop(0)]), [5, 10])
  })

  it("takes the first it crosses", () => {
    assert.deepStrictEqual(landings([34], [stop(33), stop(30)]), [30])
  })

  it("stays held past the threshold while Shift is down", () => {
    assert.deepStrictEqual(landings([32, 60], at30, true), [30, 30])
  })

  it("takes the step off a stop", () => {
    const landed = turnLanding({ free: deg(22), from: 0, on: undefined, stops: [], reach, nudge, step: 15 })
    assert.closeTo(landed.angle, deg(15), 1e-9)
    assert.isUndefined(turnLanding({ free: deg(22), from: 0, on: undefined, stops: [], reach, nudge }).on)
  })
})

describe("snappedScale", () => {
  it("lands the active item's scale on the step along its axis", () => {
    assert.closeTo(snappedScale({ from: 1, free: 1.37, step: 25 }).factor, 1.25, 1e-9)
    assert.closeTo(snappedScale({ from: 2, free: 2.6, step: 50 }).factor, 1.25, 1e-9)
  })

  it("never lands on nothing", () => {
    assert.closeTo(snappedScale({ from: 1, free: 0.02, step: 25 }).factor, 0.25, 1e-9)
    assert.closeTo(snappedScale({ from: 1, free: -0.02, step: 25 }).factor, -0.25, 1e-9)
  })

  it("stops the scaled face on a plane in range, over the step", () => {
    const stops = [{ at: 310, label: "Face of Wall", relation: "flush" as const, marks: [] }]
    const far = snappedScale({ from: 1, free: 1.52, step: 25, face: { reach: 100, range: 20 }, stops })
    assert.closeTo(far.factor, 1.5, 1e-9)
    assert.isUndefined(far.label)
    const near = snappedScale({ from: 1, free: 3.0, step: 25, face: { reach: 100, range: 20 }, stops })
    assert.closeTo(near.factor, 3.1, 1e-9)
    assert.strictEqual(near.label, "Face of Wall")
    assert.strictEqual(near.relation, "flush")
  })
})
