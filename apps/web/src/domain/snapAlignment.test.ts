import { assert, describe, it } from "@effect/vitest"
import { boxAt, cubeAt, topView } from "../test/snapFixtures"
import type { Vec3 } from "./coords"
import { alignmentHit } from "./snapAlignment"
import { defaultSnapConfig } from "./snapConfig"
import type { SnapFrame, SnapItem, SnapView } from "./snapFrame"
import { cornersOf } from "./snapRelation"
import { IDENTITY_QUAT, ORIGIN, vecAdd, vecScale } from "./ueMath"

const view = (orthographic: boolean, inView: SnapView["inView"] = () => true) => topView(1, { orthographic, inView })

const item = (key: string, at: Vec3): SnapItem => cubeAt(key, at, { name: `Cube ${key}` })

const X = { x: 1, y: 0, z: 0 }
const Y = { x: 0, y: 1, z: 0 }
const Z = { x: 0, y: 0, z: 1 }

/** A free drag on the ground: both of its axes are searched. */
const onGround = { constraint: { kind: "plane", normal: Z } } as const

/** A 100 cm pillar 10 m tall: its size is what makes a neighbour 9 m off near enough to line up with. */
const pillar = { min: { x: -50, y: -50, z: -500 }, max: { x: 50, y: 50, z: 500 } }

const frame = (offset: Vec3, items: ReadonlyArray<SnapItem>, extra: Partial<SnapFrame> = {}): SnapFrame => ({
  config: defaultSnapConfig,
  view: view(true),
  items,
  constraint: { kind: "line", direction: X },
  pointer: { x: offset.x, y: offset.y },
  offset,
  slip: { x: 0, y: 0 },
  bases: [{ start: ORIGIN, label: "Pivot" }],
  box: pillar,
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
    assert.strictEqual(hit?.label, "Center level with Cube a on X")
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
      assert.strictEqual(hit?.label, "Center level with Cube a on X")
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
    assert.strictEqual(along(Y), "Center level with Cube a on Y")
    assert.strictEqual(along(vecScale(Y, -1)), "Center level with Cube a on Y")
    assert.strictEqual(along(turned(20)), "Center level with Cube a on X")
    assert.strictEqual(along(turned(70)), "Center level with Cube a on Y")
    assert.strictEqual(along(turned(45)), "Center level with Cube a on an axis")
  })

  it("keeps its words as the gap to what it lines up with closes", () => {
    const neighbour = [item("a", { x: 1126, y: 3, z: 0 })]
    const at = (x: number) => alignmentHit(frame({ x, y: 0, z: 0 }, neighbour, onGround))[0]
    assert.strictEqual(at(100)?.label, "Center level with Cube a on Y")
    assert.strictEqual(at(526)?.label, "Center level with Cube a on Y")
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
    assert.strictEqual(hit?.label, "Center level with Cube a on X and Y")
    assert.lengthOf(hit?.parts ?? [], 2)
  })

  it("reads two axes as both of their words when they don't", () => {
    const items = [item("a", { x: 400, y: 900, z: 0 }), item("b", { x: 900, y: 400, z: 0 })]
    const [hit] = alignmentHit(frame({ x: 396, y: 396, z: 0 }, items, onGround))
    assert.strictEqual(hit?.label, "Center level with Cube a on X; Center level with Cube b on Y")
  })

  it("tells two items of one name apart across two axes", () => {
    const name = { name: "Cube" }
    const items = [cubeAt("a", { x: 400, y: 900, z: 0 }, name), cubeAt("b", { x: 900, y: 400, z: 0 }, name)]
    const [hit] = alignmentHit(frame({ x: 396, y: 396, z: 0 }, items, onGround))
    assert.strictEqual(hit?.label, "Center level with Cube on X; Center level with Cube on Y")
  })

  it("says two axes that run along none of the game's as two axes", () => {
    const across = { x: -Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }
    const up = { x: -0.5, y: -0.5, z: Math.SQRT1_2 }
    const at = (cm: number) => vecAdd(vecScale(across, cm), vecScale(up, cm))
    const [hit] = alignmentHit(frame(at(396), [item("a", at(400))], {
      constraint: { kind: "plane", normal: { x: 0.5, y: 0.5, z: Math.SQRT1_2 } }
    }))
    assert.strictEqual(hit?.label, "Center level with Cube a on two axes")
  })

  it("stops a face plane on a neighbour's", () => {
    const [hit] = alignmentHit(frame({ x: 396, y: 0, z: 0 }, [item("a", { x: 300, y: 900, z: 0 })]))
    assert.closeTo(hit?.landing.x ?? 0, 400, 1e-6)
  })

  it("draws both boxes with the sides that lined up, and a guide between them in the plane they share", () => {
    const [hit] = alignmentHit(frame({ x: 396, y: 0, z: 0 }, [item("a", { x: 300, y: 900, z: 0 })]))
    assert.strictEqual(hit?.relation, "aligned")
    const [guide, box, target] = hit?.marks ?? []
    // the selection's near side, at 350 once it has landed, on the neighbour's far side
    assert.deepStrictEqual(guide, {
      kind: "guide",
      from: { x: 350, y: 0, z: 0 },
      to: { x: 350, y: 900, z: 0 },
      text: "800 cm"
    })
    assert.deepStrictEqual(box, { kind: "box", role: "target", corners: cornersOf(boxAt({ x: 300, y: 900, z: 0 })) })
    assert.isTrue(target?.kind === "face" && target.role === "target" && target.corners.every(({ x }) => x === 350))
    const [ownBox, source] = hit?.source ?? []
    assert.deepStrictEqual(ownBox, { kind: "box", role: "source", corners: cornersOf(pillar) })
    assert.isTrue(source?.kind === "face" && source.role === "source" && source.corners.every(({ x }) => x === -50))
  })

  it("draws a whole side of the box, however little of the piece is on it", () => {
    // Curve H 90's box: a tube rising from along X to straight up, which only meets its far side at the top
    const curve = { min: { x: 0, y: -150, z: -150 }, max: { x: 711.6, y: 150, z: 561.6 } }
    const [hit] = alignmentHit(frame({ x: 4, y: 0, z: 0 }, [item("a", { x: 661.6, y: 600, z: 0 })], { box: curve }))
    assert.strictEqual(hit?.label, "Far side level with Cube a on X")
    const side = hit?.source.find((mark) => mark.kind === "face")
    assert.isTrue(side?.kind === "face" && side.corners.every(({ x }) => x === 711.6))
    const spans = (axis: "y" | "z") => side?.kind === "face" ? side.corners.map((corner) => corner[axis]) : []
    assert.deepStrictEqual([Math.min(...spans("y")), Math.max(...spans("y"))], [-150, 150])
    assert.deepStrictEqual([Math.min(...spans("z")), Math.max(...spans("z"))], [-150, 561.6])
  })

  it("draws a centre that lined up as the two centres, in their boxes", () => {
    const [hit] = alignmentHit(frame({ x: 396, y: 0, z: 0 }, [item("a", { x: 400, y: 900, z: 0 })]))
    assert.deepStrictEqual(hit?.marks[2], { kind: "dot", role: "target", at: { x: 400, y: 900, z: 0 } })
    assert.deepStrictEqual(hit?.source, [{ kind: "box", role: "source", corners: cornersOf(pillar) }, {
      kind: "dot",
      role: "source",
      at: ORIGIN
    }])
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

  it("only lines up with a neighbour no further off than the selection's own size, in any pane", () => {
    const cube = { box: boxAt(ORIGIN) }
    const at = (y: number, extra: Partial<SnapFrame> = {}) =>
      alignmentHit(frame({ x: 396, y: 0, z: 0 }, [item("a", { x: 400, y, z: 0 })], { ...cube, ...extra }))
    // the cube's diagonal is 173 cm: 120 cm between them is near, 800 cm isn't
    assert.lengthOf(at(220), 1)
    assert.lengthOf(at(900), 0)
    // in perspective a piece far behind can show right beside the selection, and it still isn't near
    const behind = view(false, () => true)
    assert.lengthOf(at(900, { view: { ...behind, project: ({ x, y }) => ({ x, y: y / 100 }) } }), 0)
  })

  it("lets a small piece reach as far as the range at its depth", () => {
    const small = { box: boxAt(ORIGIN, 1), view: topView(10, { orthographic: true }) }
    const [hit] = alignmentHit(frame({ x: 396, y: 0, z: 0 }, [item("a", { x: 400, y: 100, z: 0 })], small))
    assert.strictEqual(hit?.label, "Center level with Cube a on X")
  })

  it("lines up with the nearer of two neighbours that line up as well as each other", () => {
    const items = [item("far", { x: 400, y: 900, z: 0 }), item("near", { x: 400, y: 300, z: 0 })]
    const [hit] = alignmentHit(frame({ x: 396, y: 0, z: 0 }, items))
    assert.strictEqual(hit?.label, "Center level with Cube near on X")
  })

  it("matches the gap between two neighbours and draws both gaps, in orthographic panes", () => {
    const items = [item("a", { x: 0, y: 500, z: 0 }), item("b", { x: 300, y: 500, z: 0 })]
    const row = {
      constraint: { kind: "line", direction: X } as const,
      box: { min: { x: -50, y: 450, z: -500 }, max: { x: 50, y: 550, z: 500 } }
    }
    const [hit] = alignmentHit(frame({ x: 596, y: 0, z: 0 }, items, row))
    assert.closeTo(hit?.landing.x ?? 0, 600, 1e-6)
    assert.strictEqual(hit?.label, "Same gap as Cube b to Cube a, 200 cm")
    assert.strictEqual(hit?.relation, "gap")
    // each gap measured along the move between the sides that face each other: Cube b's far side to the selection's
    // near side, and Cube a's far side to Cube b's near side
    const guides = hit?.marks.flatMap((mark) => mark.kind === "guide" ? [[mark.from.x, mark.to.x]] : []) ?? []
    assert.deepStrictEqual(guides.map(([from, to]) => [Math.round(from ?? 0), Math.round(to ?? 0)]), [[350, 550], [
      50,
      250
    ]])
    assert.deepInclude(hit?.source[1], { kind: "face", role: "source" })
    assert.lengthOf(alignmentHit(frame({ x: 596, y: 0, z: 0 }, items, { ...row, view: view(false) })), 0)
  })
})
