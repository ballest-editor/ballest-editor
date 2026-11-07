import { assert, describe, it } from "@effect/vitest"
import { boxAt, cubeAt, topView } from "../test/snapFixtures"
import type { Vec3 } from "./coords"
import { alignmentHit } from "./snapAlignment"
import { defaultSnapConfig } from "./snapConfig"
import type { SnapFrame, SnapItem, SnapView } from "./snapFrame"
import { IDENTITY_QUAT, ORIGIN, vecAdd, vecScale } from "./ueMath"

const view = (orthographic: boolean, inView: SnapView["inView"] = () => true) => topView(1, { orthographic, inView })

const item = (key: string, at: Vec3): SnapItem => cubeAt(key, at, { name: `Cube ${key}` })

const X = { x: 1, y: 0, z: 0 }
const Y = { x: 0, y: 1, z: 0 }
const Z = { x: 0, y: 0, z: 1 }

/** A free drag on the ground: both of its axes are searched. */
const onGround = { constraint: { kind: "plane", normal: Z } } as const

const frame = (offset: Vec3, items: ReadonlyArray<SnapItem>, extra: Partial<SnapFrame> = {}): SnapFrame => ({
  config: defaultSnapConfig,
  view: view(true),
  items,
  constraint: { kind: "line", direction: X },
  pointer: { x: offset.x, y: offset.y },
  offset,
  slip: { x: 0, y: 0 },
  bases: [{ start: ORIGIN, label: "Pivot" }],
  box: boxAt(ORIGIN),
  rotation: IDENTITY_QUAT,
  units: "cm",
  tracked: [],
  construction: [],
  measurements: [],
  ...extra
})

describe("alignmentHit", () => {
  it("stops a centre on a neighbour's along the handle's axis, with how far apart they are on the guide", () => {
    const [hit] = alignmentHit(frame({ x: 396, y: 0, z: 0 }, [item("a", { x: 400, y: 900, z: 0 })]))
    assert.deepStrictEqual(hit?.landing, { x: 400, y: 0, z: 0 })
    assert.strictEqual(hit?.label, "Centre level with Cube a on X")
    assert.deepInclude(hit?.marks[0], { kind: "guide", text: "800 cm" })
  })

  it("names the sides that lined up, the neighbour's too when it isn't the selection's own", () => {
    const a = item("a", { x: 300, y: 900, z: 0 })
    const nearToFar = alignmentHit(frame({ x: 396, y: 0, z: 0 }, [a]))
    const farToNear = alignmentHit(frame({ x: 204, y: 0, z: 0 }, [a]))
    assert.strictEqual(nearToFar[0]?.label, "Near side level with far side of Cube a on X")
    assert.strictEqual(farToNear[0]?.label, "Far side level with near side of Cube a on X")
    // a wider neighbour: the same side, and no centre to say it for them
    const wide = { ...a, box: boxAt({ x: 300, y: 900, z: 0 }, 150) }
    const near = alignmentHit(frame({ x: 204, y: 0, z: 0 }, [wide]))
    const far = alignmentHit(frame({ x: 396, y: 0, z: 0 }, [wide]))
    assert.strictEqual(near[0]?.label, "Near side level with Cube a on X")
    assert.strictEqual(far[0]?.label, "Far side level with Cube a on X")
  })

  it("says the centre when boxes of one size line up on every feature at once", () => {
    for (const x of [396, 396.1, 396.3, 403.7]) {
      const [hit] = alignmentHit(frame({ x, y: 0, z: 0 }, [item("a", { x: 400, y: 900, z: 0 })]))
      assert.strictEqual(hit?.label, "Centre level with Cube a on X")
    }
  })

  it("names the axis the move runs along, or none when it runs along none of them", () => {
    const along = (direction: Vec3) => {
      const offset = vecScale(direction, 396)
      const neighbour = item("a", vecAdd(vecScale(direction, 400), { x: 0, y: 0, z: 900 }))
      const [hit] = alignmentHit(frame(offset, [neighbour], { constraint: { kind: "line", direction } }))
      return hit?.label
    }
    const turned = (degrees: number) => {
      const angle = degrees * Math.PI / 180
      return { x: Math.cos(angle), y: Math.sin(angle), z: 0 }
    }
    assert.strictEqual(along(Y), "Centre level with Cube a on Y")
    assert.strictEqual(along(vecScale(Y, -1)), "Centre level with Cube a on Y")
    assert.strictEqual(along(turned(20)), "Centre level with Cube a on X")
    assert.strictEqual(along(turned(70)), "Centre level with Cube a on Y")
    assert.strictEqual(along(turned(45)), "Centre level with Cube a on an axis")
  })

  it("keeps its words as the gap to what it lines up with closes", () => {
    const neighbour = [item("a", { x: 1126, y: 3, z: 0 })]
    const at = (x: number) => alignmentHit(frame({ x, y: 0, z: 0 }, neighbour, onGround))[0]
    assert.strictEqual(at(100)?.label, "Centre level with Cube a on Y")
    assert.strictEqual(at(526)?.label, "Centre level with Cube a on Y")
    assert.deepInclude(at(100)?.marks[0], { text: "926 cm" })
    assert.deepInclude(at(526)?.marks[0], { text: "500 cm" })
  })

  it("puts no distance on the guide of pieces that touch or overlap", () => {
    const textOf = (offset: Vec3, at: Vec3) => {
      const [mark] = alignmentHit(frame(offset, [item("a", at)]))[0]?.marks ?? []
      return mark?.kind === "guide" ? mark.text : "no guide"
    }
    assert.isUndefined(textOf({ x: 196, y: 0, z: 0 }, { x: 300, y: 0, z: 0 }))
    assert.isUndefined(textOf({ x: 396, y: 0, z: 0 }, { x: 400, y: 0, z: 0 }))
    assert.isUndefined(textOf({ x: 396, y: 0, z: 0 }, { x: 400, y: 100.4, z: 0 }))
  })

  it("reads two axes as one when they line up the same feature of the same item", () => {
    const [hit] = alignmentHit(frame({ x: 396, y: 396, z: 0 }, [item("a", { x: 400, y: 400, z: 0 })], onGround))
    assert.strictEqual(hit?.label, "Centre level with Cube a on X and Y")
    assert.lengthOf(hit?.parts ?? [], 2)
  })

  it("reads two axes as both of their words when they don't", () => {
    const items = [item("a", { x: 400, y: 900, z: 0 }), item("b", { x: 900, y: 400, z: 0 })]
    const [hit] = alignmentHit(frame({ x: 396, y: 396, z: 0 }, items, onGround))
    assert.strictEqual(hit?.label, "Centre level with Cube a on X; Centre level with Cube b on Y")
  })

  it("tells two items of one name apart across two axes", () => {
    const name = { name: "Cube" }
    const items = [cubeAt("a", { x: 400, y: 900, z: 0 }, name), cubeAt("b", { x: 900, y: 400, z: 0 }, name)]
    const [hit] = alignmentHit(frame({ x: 396, y: 396, z: 0 }, items, onGround))
    assert.strictEqual(hit?.label, "Centre level with Cube on X; Centre level with Cube on Y")
  })

  it("says two axes that run along none of the game's as two axes", () => {
    const across = { x: -Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }
    const up = { x: -0.5, y: -0.5, z: Math.SQRT1_2 }
    const at = (cm: number) => vecAdd(vecScale(across, cm), vecScale(up, cm))
    const [hit] = alignmentHit(frame(at(396), [item("a", at(400))], {
      constraint: { kind: "plane", normal: { x: 0.5, y: 0.5, z: Math.SQRT1_2 } }
    }))
    assert.strictEqual(hit?.label, "Centre level with Cube a on two axes")
  })

  it("stops a face plane on a neighbour's", () => {
    const [hit] = alignmentHit(frame({ x: 396, y: 0, z: 0 }, [item("a", { x: 300, y: 900, z: 0 })]))
    assert.closeTo(hit?.landing.x ?? 0, 400, 1e-6)
  })

  it("only searches the handle's axes", () => {
    const off = frame({ x: 0, y: 396, z: 0 }, [item("a", { x: 777, y: 400, z: 0 })])
    assert.lengthOf(alignmentHit(off), 0)
  })

  it("only looks at what the pane shows", () => {
    const hidden = frame({ x: 396, y: 0, z: 0 }, [item("a", { x: 400, y: 900, z: 0 })], {
      view: view(true, () => false)
    })
    assert.lengthOf(alignmentHit(hidden), 0)
  })

  it("is quieter in perspective: a neighbour must be within the threshold on screen", () => {
    const far = [item("a", { x: 400, y: 900, z: 0 })]
    assert.lengthOf(alignmentHit(frame({ x: 396, y: 0, z: 0 }, far, { view: view(false) })), 0)
    const close = [item("a", { x: 400, y: 105, z: 0 })]
    assert.lengthOf(alignmentHit(frame({ x: 396, y: 0, z: 0 }, close, { view: view(false) })), 1)
  })

  it("matches the gap between two neighbours and draws both gaps, in orthographic panes", () => {
    const items = [item("a", { x: 0, y: 500, z: 0 }), item("b", { x: 300, y: 500, z: 0 })]
    const row = { constraint: { kind: "line", direction: X } as const, box: boxAt({ x: 0, y: 500, z: 0 }) }
    const [hit] = alignmentHit(frame({ x: 596, y: 0, z: 0 }, items, row))
    assert.closeTo(hit?.landing.x ?? 0, 600, 1e-6)
    assert.strictEqual(hit?.label, "Same gap as Cube b to Cube a, 200 cm")
    assert.lengthOf(hit?.marks.filter((mark) => mark.kind === "guide") ?? [], 2)
    assert.lengthOf(alignmentHit(frame({ x: 596, y: 0, z: 0 }, items, { ...row, view: view(false) })), 0)
  })
})
