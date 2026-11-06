import { assert, describe, it } from "@effect/vitest"
import { boxAt, cubeAt, topView } from "../test/snapFixtures"
import type { Vec3 } from "./coords"
import { alignmentHit } from "./snapAlignment"
import { defaultSnapConfig } from "./snapConfig"
import type { SnapFrame, SnapItem, SnapView } from "./snapFrame"
import { IDENTITY_QUAT, ORIGIN } from "./ueMath"

const view = (orthographic: boolean, inView: SnapView["inView"] = () => true) => topView(1, { orthographic, inView })

const item = (key: string, at: Vec3): SnapItem => cubeAt(key, at, { name: `Cube ${key}` })

const X = { x: 1, y: 0, z: 0 }

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
  it("stops a centre on a neighbour's along the handle's axis, and says how far apart they are", () => {
    const [hit] = alignmentHit(frame({ x: 396, y: 0, z: 0 }, [item("a", { x: 400, y: 900, z: 0 })]))
    assert.deepStrictEqual(hit?.landing, { x: 400, y: 0, z: 0 })
    assert.strictEqual(hit?.label, "Level with Cube a, 800 cm")
    assert.strictEqual(hit?.marks[0]?.kind, "guide")
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
    assert.lengthOf(hit?.marks.filter((mark) => mark.kind === "guide") ?? [], 2)
    assert.lengthOf(alignmentHit(frame({ x: 596, y: 0, z: 0 }, items, { ...row, view: view(false) })), 0)
  })
})
