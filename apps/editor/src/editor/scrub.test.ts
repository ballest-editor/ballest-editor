import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "../domain/bundledCatalog.json"
import { Catalog } from "../domain/Catalog"
import type { UeTransform, Vec3 } from "../domain/coords"
import { placementTransform } from "../domain/factory"
import { applyGroupDelta, type Axis, readField, selectionAxisEdit, type TransformField } from "../domain/groupTransform"
import { localToWorld } from "../domain/pivot"
import { quatConjugate, quatMul, rotateVec, rotatorToQuat } from "../domain/ueMath"
import { editSelectionAxis, previewSelectionAxis, setSelectionField } from "./actions"
import { initialMap, pivotOf, shownTransform, useEditor } from "./store"

const cube = Schema.decodeUnknownSync(Catalog)(fixture).pieces.find((p) => p.className === "BP_Prim_Cube")!
const s = () => useEditor.getState()
const docTransform = (id: string) => s().doc.map.items[s().doc.ids.indexOf(id)]!.itemTransform

/** Three cubes, each turned differently (one near gimbal lock), all selected; the last is active. */
const setup = () => {
  s().loadMap(initialMap(), null)
  const turns = [{ roll: 20, pitch: 30, yaw: 40 }, { roll: -70, pitch: 89.9, yaw: 10 }, {
    roll: 5,
    pitch: -15,
    yaw: 120
  }]
  const ids = turns.map((turn, i) => {
    s().placePiece(cube, {
      ...placementTransform(cube, { x: i * 300, y: i * 70, z: 50 }),
      rotation: { ...rotatorToQuat(turn) }
    })
    return s().selectedIds[0]!
  })
  s().select(ids)
  return { ids, before: new Map(ids.map((id) => [id, docTransform(id)])), steps: s().past.length }
}

const expectVec = (a: Vec3, b: Vec3, message: string) => {
  for (const k of ["x", "y", "z"] as const) assert.closeTo(a[k], b[k], 1e-6, `${message}: ${k}`)
}
/** Same position and orientation (a quaternion and its negation are the same turn). */
const sameTransform = (a: UeTransform, b: UeTransform, message: string) => {
  expectVec(a.translation, b.translation, `${message} translation`)
  expectVec(a.scale3D, b.scale3D, `${message} scale`)
  for (const v of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }]) {
    expectVec(rotateVec(a.rotation, v), rotateVec(b.rotation, v), `${message} rotation`)
  }
}

const cases: ReadonlyArray<readonly [TransformField, Axis]> = [
  ["translation", "x"],
  ["translation", "z"],
  ["rotation", "x"],
  ["rotation", "y"],
  ["rotation", "z"],
  ["scale3D", "y"]
]

describe("scrubbing a transform field over a turned multi-selection (#43)", () => {
  for (const [field, axis] of cases) {
    it(`${field} ${axis}: many small steps end where one edit of the total does, in one undo step`, () => {
      const { ids, before, steps } = setup()
      const total = field === "scale3D" ? 0.75 : 40
      // a scrub previews its running offset from the start on every pointer move, back and forth
      const ramp = (from: number, to: number, n: number) =>
        Array.from({ length: n + 1 }, (_, i) => from + (to - from) * i / n)
      const path = [...ramp(0, total, 80), ...ramp(total, total / 2, 80), ...ramp(total / 2, total, 40)]
      let last: ReadonlyMap<string, UeTransform> | undefined
      for (const by of path) {
        previewSelectionAxis(field, axis, { kind: "offset", by })
        const shown = new Map(ids.map((id) => [id, shownTransform(s(), id)!]))
        if (last !== undefined) {
          // nothing jumps: consecutive previews stay within a step of each other
          for (const id of ids) {
            const [a, b] = [last.get(id)!, shown.get(id)!]
            assert.isBelow(
              Math.hypot(
                a.translation.x - b.translation.x,
                a.translation.y - b.translation.y,
                a.translation.z - b.translation.z
              ),
              10,
              `${id} moved`
            )
            assert.isAbove(
              Math.abs(
                a.rotation.x * b.rotation.x + a.rotation.y * b.rotation.y + a.rotation.z * b.rotation.z +
                  a.rotation.w * b.rotation.w
              ),
              0.999,
              `${id} spun`
            )
          }
        }
        last = shown
        assert.strictEqual(s().past.length, steps, "a preview is not a step")
      }
      previewSelectionAxis(field, axis, null)
      editSelectionAxis(field, axis, { kind: "offset", by: total })
      assert.strictEqual(s().past.length, steps + 1)

      const active = before.get(ids.at(-1)!)!
      const once = selectionAxisEdit(active, field, axis, { kind: "offset", by: total })
      for (const id of ids) {
        sameTransform(docTransform(id), once(before.get(id)!), id)
        sameTransform(last!.get(id)!, docTransform(id), `${id} release`)
      }
      s().undo()
      for (const id of ids) assert.deepStrictEqual(docTransform(id), before.get(id))
    })
  }

  it("turns the selection rigidly about the active item, like the gizmo", () => {
    const { ids, before } = setup()
    editSelectionAxis("rotation", "z", { kind: "offset", by: 90 })
    const pivot = before.get(ids.at(-1)!)!.translation
    for (const id of ids) {
      const [from, to] = [before.get(id)!, docTransform(id)]
      // yaw is a turn about game Z: offsets from the pivot rotate by 90 degrees, heights stay
      const d0 = { x: from.translation.x - pivot.x, y: from.translation.y - pivot.y }
      expectVec(to.translation, { x: pivot.x - d0.y, y: pivot.y + d0.x, z: from.translation.z }, id)
    }
    // the active item turns in place and only its yaw changes
    const active = docTransform(ids.at(-1)!)
    expectVec(readField(active, "rotation"), { x: 5, y: -15, z: -150 }, "active rotator")
  })
})

describe("scrubbing with pivots (#51)", () => {
  /** setup(), with a different pivot on each cube (the cube's bounds run 0..1000 in Z). */
  const withPivots = () => {
    const setUp = setup()
    const pivots = [
      { choice: "Top", localPosition: { x: 0, y: 0, z: 1000 } },
      { choice: "Back", localPosition: { x: 500, y: 0, z: 500 } },
      { choice: "Left", localPosition: { x: 0, y: -500, z: 500 } }
    ]
    s().setItemPivots(new Map(setUp.ids.map((id, i) => [id, pivots[i]!])))
    return { ...setUp, pivots: new Map(setUp.ids.map((id) => [id, pivotOf(s(), id).localPosition])) }
  }
  const pivotPoint = (id: string, t = docTransform(id)) => localToWorld(t, pivotOf(s(), id).localPosition)

  it("turns the selection about the active item's pivot, as the gizmo does", () => {
    const { ids, before } = withPivots()
    const activeId = ids.at(-1)!
    const pivot = pivotPoint(activeId, before.get(activeId))
    previewSelectionAxis("rotation", "y", { kind: "offset", by: 25 })
    previewSelectionAxis("rotation", "y", null)
    editSelectionAxis("rotation", "y", { kind: "offset", by: 25 })
    expectVec(pivotPoint(activeId), pivot, "active pivot")
    const turn = selectionAxisEdit(before.get(activeId)!, "rotation", "y", { kind: "offset", by: 25 })
    const delta = { kind: "rotate", rotation: turn(before.get(activeId)!).rotation } as const
    for (const id of ids) {
      // the same rigid turn the gizmo applies, about the same point
      const gizmo = applyGroupDelta(before.get(id)!, pivot, {
        ...delta,
        rotation: quatMul(delta.rotation, quatConjugate(before.get(activeId)!.rotation))
      })
      sameTransform(docTransform(id), gizmo, id)
    }
  })

  it("scales and sets rotation or scale about each item's own pivot", () => {
    const { ids } = withPivots()
    const where = () => new Map(ids.map((id) => [id, pivotPoint(id)]))
    for (
      const edit of [
        () => editSelectionAxis("scale3D", "z", { kind: "offset", by: 0.5 }),
        () => editSelectionAxis("scale3D", "x", { kind: "set", value: 2 }),
        () => editSelectionAxis("rotation", "x", { kind: "set", value: 30 }),
        () => setSelectionField("rotation", { x: 10, y: 20, z: 30 })
      ]
    ) {
      const before = where()
      edit()
      for (const id of ids) expectVec(pivotPoint(id), before.get(id)!, id)
    }
    // a typed location still sets the origin
    editSelectionAxis("translation", "z", { kind: "set", value: 70 })
    for (const id of ids) assert.strictEqual(docTransform(id).translation.z, 70)
  })
})
