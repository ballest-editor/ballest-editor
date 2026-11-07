import { assert, describe, it } from "@effect/vitest"
import { expectVec } from "../test/vec"
import type { UeTransform } from "./coords"
import { identityTransform } from "./factory"
import type { Box } from "./itemBounds"
import { defaultSnapConfig } from "./snapConfig"
import {
  alignOffsets,
  angleBetweenFaces,
  axisFromPoints,
  distributeOffsets,
  faceMeeting,
  measurementFacts,
  mirroredTransform,
  planeFromFace,
  planeFromOffset,
  planeFromPoints,
  planeFromWorld,
  selectionBases
} from "./snapTools"
import { rotateVec, rotatorToQuat, vecDot } from "./ueMath"

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("expected a value")
  return value
}

const box = (minX: number, maxX: number): Box => ({
  min: { x: minX, y: 0, z: 0 },
  max: { x: maxX, y: 100, z: 100 }
})

describe("faceMeeting", () => {
  const a = { point: { x: 100, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } }

  it("Tangent brings B's face against A's, facing it", () => {
    const b = { point: { x: 300, y: 50, z: 0 }, normal: { x: -1, y: 0, z: 0 } }
    const move = faceMeeting(a, b, "tangent", 0)
    expectVec(move.offset, { x: -200, y: 0, z: 0 })
    expectVec(rotateVec(move.rotation, b.normal), { x: -1, y: 0, z: 0 })
  })

  it("Flush makes B's face coplanar with A's, facing the same way", () => {
    const b = { point: { x: 300, y: 50, z: 0 }, normal: { x: -1, y: 0, z: 0 } }
    const move = faceMeeting(a, b, "flush", 0)
    expectVec(rotateVec(move.rotation, b.normal), { x: 1, y: 0, z: 0 })
    expectVec(move.offset, { x: -200, y: 0, z: 0 })
  })

  it("stands off by the offset, along A's normal", () => {
    const b = { point: { x: 300, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } }
    expectVec(faceMeeting(a, b, "tangent", 25).offset, { x: -175, y: 0, z: 0 })
  })
})

describe("alignOffsets and distributeOffsets", () => {
  it("aligns each box's side to the reference's", () => {
    const boxes = [box(0, 100), box(250, 300), box(700, 1000)]
    const offsets = alignOffsets(boxes, "x", "min", boxes[0] ?? box(0, 0))
    assert.deepStrictEqual(offsets.map(({ x }) => x), [0, -250, -700])
    const centred = alignOffsets(boxes, "x", "centre", boxes[0] ?? box(0, 0))
    assert.deepStrictEqual(centred.map(({ x }) => x), [0, -225, -800])
  })

  it("spaces centres evenly, the outer two staying", () => {
    const boxes = [box(0, 100), box(100, 200), box(900, 1000)]
    assert.deepStrictEqual(distributeOffsets(boxes, "x", "spacing").map(({ x }) => x), [0, 350, 0])
  })

  it("makes the gaps equal, the outer two staying", () => {
    const boxes = [box(0, 100), box(150, 350), box(900, 1000)]
    assert.deepStrictEqual(distributeOffsets(boxes, "x", "gaps").map(({ x }) => x), [0, 250, 0])
  })

  it("leaves two or fewer where they are", () => {
    assert.deepStrictEqual(distributeOffsets([box(0, 100), box(500, 600)], "x", "gaps").map(({ x }) => x), [0, 0])
  })
})

describe("measuring", () => {
  it("gives the distance and each axis's delta", () => {
    const facts = measurementFacts({ x: 0, y: 0, z: 0 }, { x: 300, y: 400, z: 0 })
    assert.strictEqual(facts.distance, 500)
    assert.deepStrictEqual(facts.delta, { x: 300, y: 400, z: 0 })
  })

  it("gives the angle between two faces", () => {
    assert.closeTo(angleBetweenFaces({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), 90, 1e-9)
  })
})

describe("mirroredTransform", () => {
  const plane = { origin: { x: 100, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } }

  it("reflects the origin, and flips local X so the geometry mirrors", () => {
    const t = identityTransform({ x: 150, y: 20, z: 5 })
    const mirrored = mirroredTransform(t, plane)
    expectVec(mirrored.translation, { x: 50, y: 20, z: 5 })
    // local +X, flipped by the item's Flip X, must end up where the reflection of the old +X is
    expectVec(rotateVec(mirrored.rotation, { x: -1, y: 0, z: 0 }), { x: -1, y: 0, z: 0 })
    expectVec(rotateVec(mirrored.rotation, { x: 0, y: 1, z: 0 }), { x: 0, y: 1, z: 0 })
  })

  it("keeps a turned item's other axes where the reflection puts them", () => {
    const turned = {
      ...identityTransform({ x: 0, y: 0, z: 0 }),
      rotation: rotatorToQuat({ pitch: 0, yaw: 30, roll: 0 })
    }
    const mirrored = mirroredTransform<UeTransform>(turned, plane)
    const y = rotateVec(turned.rotation, { x: 0, y: 1, z: 0 })
    expectVec(rotateVec(mirrored.rotation, { x: 0, y: 1, z: 0 }), { x: -y.x, y: y.y, z: y.z })
  })
})

describe("construction geometry", () => {
  it("makes a plane from a face, square and unit length", () => {
    const plane = planeFromFace({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 2 }, "p", "Face")
    expectVec(plane.normal, { x: 0, y: 0, z: 1 })
    assert.closeTo(vecDot(plane.normal, plane.xAxis), 0, 1e-9)
  })

  it("makes a plane from three points, and refuses three in a line", () => {
    const plane = planeFromPoints({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 0, y: 100, z: 0 }, "p", "Three")
    expectVec(must(plane).normal, { x: 0, y: 0, z: 1 })
    assert.isUndefined(planeFromPoints({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, "p", "Line"))
  })

  it("makes a plane from a world plane through a point", () => {
    expectVec(planeFromWorld("xz", { x: 7, y: 8, z: 9 }, "p", "World").normal, { x: 0, y: 1, z: 0 })
  })

  it("offsets and tilts a plane from another", () => {
    const base = planeFromWorld("xy", { x: 0, y: 0, z: 0 }, "p", "Floor")
    const raised = planeFromOffset(base, 100, 0, "q", "Raised")
    expectVec(raised.origin, { x: 0, y: 0, z: 100 })
    const tilted = planeFromOffset(base, 0, 90, "r", "Wall")
    assert.closeTo(Math.abs(vecDot(tilted.normal, base.normal)), 0, 1e-9)
  })

  it("makes an axis through two points", () => {
    expectVec(must(axisFromPoints({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }, "a", "Up")).direction, {
      x: 0,
      y: 0,
      z: 1
    })
    assert.isUndefined(axisFromPoints({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, "a", "None"))
  })
})

describe("selectionBases", () => {
  const selection = {
    pivot: { x: 1, y: 2, z: 3 },
    box: { min: { x: -100, y: -100, z: 0 }, max: { x: 100, y: 100, z: 200 } },
    ends: []
  }

  it("gives the pivot by default, and the box's centre for Centre", () => {
    assert.deepStrictEqual(selectionBases(defaultSnapConfig, selection).map(({ start }) => start), [selection.pivot])
    const centre = selectionBases({ ...defaultSnapConfig, base: "centre" }, selection)
    assert.deepStrictEqual(centre.map(({ start }) => start), [{ x: 0, y: 0, z: 100 }])
  })

  it("gives corners, edge middles and face centres for Closest", () => {
    assert.lengthOf(selectionBases({ ...defaultSnapConfig, base: "closest" }, selection), 26)
  })

  const line = { kind: "line", direction: { x: 1, y: 0, z: 0 } } as const
  const face = { kind: "face", axis: line.direction } as const

  it("adds the near face, the centre and the far face along a line, whatever the setting", () => {
    const pivot = { x: 1, y: 2, z: 3 }
    assert.deepStrictEqual(selectionBases(defaultSnapConfig, selection, line), [
      { start: pivot, label: "Pivot" },
      { start: { x: -100, y: 0, z: 100 }, label: "Near face", station: true, stop: face },
      { start: { x: 0, y: 0, z: 100 }, label: "Centre", station: true, stop: { kind: "centre" } },
      { start: { x: 100, y: 0, z: 100 }, label: "Far face", station: true, stop: face }
    ])
    const centred = selectionBases({ ...defaultSnapConfig, base: "centre" }, selection, line)
    assert.deepStrictEqual(centred.map(({ label }) => label), ["Centre", "Pivot", "Near face", "Far face"])
  })

  it("lets a point that is already a station stop as one, under its own name", () => {
    const onFace = { ...selection, pivot: { x: -100, y: 0, z: 100 } }
    const [pivot] = selectionBases(defaultSnapConfig, onFace, line)
    assert.deepStrictEqual(pivot, { start: onFace.pivot, label: "Pivot", stop: face })
    const [centre] = selectionBases({ ...defaultSnapConfig, base: "centre" }, selection, line)
    assert.deepStrictEqual(centre?.stop, { kind: "centre" })
  })

  it("keeps a selection with no depth along the move both a face and a centre", () => {
    const flat = { ...selection, box: { min: { x: 0, y: -100, z: 0 }, max: { x: 0, y: 100, z: 200 } } }
    const stops = selectionBases(defaultSnapConfig, flat, line).flatMap(({ stop }) => stop?.kind ?? [])
    assert.deepStrictEqual(stops, ["face", "centre"])
  })

  it("adds them along both of a plane's axes, and none on a surface", () => {
    const plane = { kind: "plane", normal: { x: 0, y: 0, z: 1 } } as const
    assert.lengthOf(selectionBases(defaultSnapConfig, selection, plane), 6, "the pivot, four faces and the centre")
    const surface = { kind: "surface", normal: { x: 0, y: 0, z: 1 } } as const
    assert.lengthOf(selectionBases(defaultSnapConfig, selection, surface), 1)
  })

  it("reaches a box's far corner along a slanted line", () => {
    const slant = { kind: "line", direction: { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 } } as const
    const far = selectionBases(defaultSnapConfig, selection, slant).find(({ label }) => label === "Far face")
    assert.closeTo(far?.start.x ?? 0, 100, 1e-6)
    assert.closeTo(far?.start.y ?? 0, 100, 1e-6)
  })

  it("lets a piece's ends take over with Connectors on, whatever the setting", () => {
    const end = {
      ref: { item: "a", end: 0 },
      position: { x: 5, y: 0, z: 0 },
      forward: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 0, z: 1 },
      profile: "Track"
    }
    const bases = selectionBases(defaultSnapConfig, { ...selection, ends: [end] })
    assert.deepStrictEqual(bases.map(({ start }) => start), [end.position])
    const constrained = selectionBases(defaultSnapConfig, { ...selection, ends: [end] }, line)
    assert.deepStrictEqual(constrained.map(({ label }) => label), ["End", "Pivot", "Near face", "Centre", "Far face"])
    const off = {
      ...defaultSnapConfig,
      targets: { ...defaultSnapConfig.targets, connectors: { ...defaultSnapConfig.targets.connectors, enabled: false } }
    }
    assert.deepStrictEqual(selectionBases(off, { ...selection, ends: [end] }).map(({ start }) => start), [
      selection.pivot
    ])
  })
})
