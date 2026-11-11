import { assert, beforeAll, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "../domain/bundledCatalog.json"
import { Catalog, indexCatalog } from "../domain/Catalog"
import type { UeTransform, Vec3 } from "../domain/coords"
import { placementTransform } from "../domain/factory"
import { type FieldKind, type FieldView, readThing, sharedValue } from "../domain/fieldEdit"
import { applyGroupDelta, type Axis, readField, type TransformField, writeField } from "../domain/groupTransform"
import { extentOf } from "../domain/itemBounds"
import { type NumberEntry, offsetEntry, parseNumberEntry, setEntry } from "../domain/numberEntry"
import { localToWorld } from "../domain/pivot"
import { quatConjugate, quatMul, quatNormalize, rotateVec, rotatorToQuat, vecAdd, vecSub } from "../domain/ueMath"
import { assertVec } from "../test/vec"
import { editSelectionField, pasteSelectionField, previewSelectionField, setSelectionPivot } from "./actions"
import {
  initialMap,
  pivotOf,
  pivotRowOf,
  selectionPivot,
  selectionThings,
  shownPivotPoint,
  shownTransform,
  unitExtentOf,
  useEditor
} from "./store"

const catalog = Schema.decodeUnknownSync(Catalog)(fixture)

/** The Transform row a stored field is shown in, in centimetres. */
const KINDS: Readonly<Record<TransformField, FieldKind>> = {
  translation: "location",
  rotation: "rotation",
  scale3D: "scale"
}
const viewOf = (field: TransformField | "size" | "pivot"): FieldView => ({
  kind: field === "size" || field === "pivot" ? field : KINDS[field],
  perUnit: 1
})
const entry = (text: string): NumberEntry => parseNumberEntry(text)!
/** Typing `text` into one field of a row. */
const type = (field: TransformField | "size" | "pivot", axis: Axis, text: string) =>
  editSelectionField(viewOf(field), axis, entry(text))
const offset = (field: TransformField, axis: Axis, by: number) =>
  editSelectionField(viewOf(field), axis, offsetEntry(by))
const setTo = (field: TransformField, axis: Axis, value: number) =>
  editSelectionField(viewOf(field), axis, setEntry(value))
const paste = (field: TransformField | "size", value: Vec3) => pasteSelectionField(viewOf(field), value)
const cube = catalog.pieces.find((p) => p.className === "BP_Prim_Cube")!
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

const expectVec = assertVec
/** Same position and orientation (a quaternion and its negation are the same turn). */
const sameTransform = (a: UeTransform, b: UeTransform, message: string) => {
  expectVec(a.translation, b.translation, `${message} translation`)
  expectVec(a.scale3D, b.scale3D, `${message} scale`)
  for (const v of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }]) {
    expectVec(rotateVec(a.rotation, v), rotateVec(b.rotation, v), `${message} rotation`)
  }
}

/** Every item in `before` swung a quarter turn about `pivot` (yaw is a turn about game Z: heights stay). */
const expectQuarterTurnAbout = (before: ReadonlyMap<string, UeTransform>, pivot: Vec3) => {
  for (const [id, from] of before) {
    const d0 = { x: from.translation.x - pivot.x, y: from.translation.y - pivot.y }
    expectVec(docTransform(id).translation, { x: pivot.x - d0.y, y: pivot.y + d0.x, z: from.translation.z }, id)
  }
}

/**
 * `t` with its own `field` changed by `by` on `axis`, about its origin: one piece edited alone (a cube's pivot is its
 * origin), from its rotator round-tripped through the quaternion.
 */
const ownEdit = (t: UeTransform, field: TransformField, axis: Axis, by: number): UeTransform => {
  if (field === "translation") return { ...t, translation: { ...t.translation, [axis]: t.translation[axis] + by } }
  if (field === "scale3D") return { ...t, scale3D: { ...t.scale3D, [axis]: t.scale3D[axis] + by } }
  const rotator = readField(t, "rotation")
  const from = writeField(t, "rotation", rotator).rotation
  const to = writeField(t, "rotation", { ...rotator, [axis]: rotator[axis] + by }).rotation
  return applyGroupDelta(t, t.translation, {
    kind: "rotate",
    rotation: quatNormalize(quatMul(to, quatConjugate(from)))
  })
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
        previewSelectionField(viewOf(field), axis, offsetEntry(by))
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
      previewSelectionField(viewOf(field), axis, null)
      offset(field, axis, total)
      assert.strictEqual(s().past.length, steps + 1)

      for (const id of ids) {
        sameTransform(docTransform(id), ownEdit(before.get(id)!, field, axis, total), id)
        sameTransform(last!.get(id)!, docTransform(id), `${id} release`)
      }
      s().undo()
      for (const id of ids) assert.deepStrictEqual(docTransform(id), before.get(id))
    })
  }

  it("turns every piece where it stands by a change, whatever Together says (the editor's rules § 4)", () => {
    const { ids, before } = setup()
    offset("rotation", "z", 90)
    for (const id of ids) {
      expectVec(docTransform(id).translation, before.get(id)!.translation, id)
      sameTransform(docTransform(id), ownEdit(before.get(id)!, "rotation", "z", 90), id)
    }
    // only the yaw changes
    expectVec(readField(docTransform(ids.at(-1)!), "rotation"), { x: 5, y: -15, z: -150 }, "active rotator")
  })
})

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

describe("scrubbing with pivots (#51)", () => {
  it("turns every piece about its own pivot, which stays put, whichever is active", () => {
    const { ids, before } = withPivots()
    const pivots = new Map(ids.map((id) => [id, pivotPoint(id)]))
    previewSelectionField(viewOf("rotation"), "y", offsetEntry(25))
    previewSelectionField(viewOf("rotation"), "y", null)
    offset("rotation", "y", 25)
    for (const id of ids) {
      expectVec(pivotPoint(id), pivots.get(id)!, id)
      const turned = ownEdit(before.get(id)!, "rotation", "y", 25)
      // the same turn as the piece alone, moved to keep its pivot
      for (const v of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }]) {
        expectVec(rotateVec(docTransform(id).rotation, v), rotateVec(turned.rotation, v), `${id} rotation`)
      }
    }
  })

  it("scales every piece about its own pivot, which stays put", () => {
    const { ids } = withPivots()
    for (const edit of [() => offset("scale3D", "z", 0.5), () => setTo("scale3D", "x", 2)]) {
      const before = new Map(ids.map((id) => [id, pivotPoint(id)]))
      edit()
      for (const id of ids) expectVec(pivotPoint(id), before.get(id)!, id)
    }
  })

  it("sets every piece to a typed value about its own pivot, and changes each from its own by +=", () => {
    const { ids, before } = withPivots()
    const pivots = new Map(ids.map((id) => [id, pivotPoint(id)]))
    type("rotation", "z", "90")
    for (const id of ids) {
      expectVec(pivotPoint(id), pivots.get(id)!, id)
      assert.closeTo(readField(docTransform(id), "rotation").z, 90, 1e-6, id)
    }
    type("rotation", "z", "+= 90")
    // 180 may read -180
    for (const id of ids) assert.closeTo(Math.abs(readField(docTransform(id), "rotation").z), 180, 1e-6, id)
    type("translation", "z", "+= 70")
    for (const id of ids) {
      assert.closeTo(docTransform(id).translation.z, before.get(id)!.translation.z + 70, 1e-6, id)
    }
    type("translation", "z", "3")
    for (const id of ids) assert.closeTo(docTransform(id).translation.z, 3, 1e-6, id)
  })

  it("pastes a rotation about each item's own pivot", () => {
    const { ids } = withPivots()
    const before = new Map(ids.map((id) => [id, pivotPoint(id)]))
    paste("rotation", { x: 10, y: 20, z: 30 })
    for (const id of ids) {
      expectVec(pivotPoint(id), before.get(id)!, id)
      expectVec(readField(docTransform(id), "rotation"), { x: 10, y: 20, z: 30 }, id)
    }
  })
})

describe("Each in the Inspector", () => {
  it("sets every unit to a typed scale, and multiplies each by its own with *=, in Each as in Together", () => {
    const { ids } = setup()
    const [a = "", b = "", active = ""] = ids
    for (const mode of ["each", "together"] as const) {
      if (s().pivotMode !== mode) s().togglePivotMode()
      s().transformItems(
        new Map(
          ([[a, 2], [b, 1], [active, 1]] as const).map((
            [id, x]
          ) => [id, { ...docTransform(id), scale3D: { x, y: 1, z: 1 } }])
        )
      )
      type("scale3D", "x", "*= 2")
      assert.deepStrictEqual([a, b, active].map((id) => docTransform(id).scale3D.x), [4, 2, 2], mode)
      type("scale3D", "x", "3")
      assert.deepStrictEqual([a, b, active].map((id) => docTransform(id).scale3D.x), [3, 3, 3], mode)
    }
  })

  it("moves only the links edited inside an entered chain, exactly, in either chain setting (the editor's rules § 5)", () => {
    const { ids } = setup()
    const [, l2 = "", l3 = ""] = ids
    s().chainSelection()
    const chain = s().doc.structure.tree.find((n) => n.kind === "group")
    s().enterGroup(chain?.kind === "group" ? chain.id : null)
    const before = new Map(ids.map((id) => [id, docTransform(id)]))
    const movesOf = (edit: () => void) => {
      edit()
      const moves = ids.map((id) => docTransform(id).translation.y - before.get(id)!.translation.y)
      s().undo()
      return moves
    }
    s().select([l2])
    const y2 = before.get(l2)!.translation.y
    for (const mode of ["links", "rigid"] as const) {
      if (s().chainMode !== mode) s().togglePivotMode()
      assert.deepStrictEqual(
        movesOf(() => offset("translation", "y", 40)),
        [0, 40, 0],
        `${mode}: a scrub carries nothing`
      )
      assert.deepStrictEqual(movesOf(() => type("translation", "y", `${y2 + 40}`)), [0, 40, 0], `${mode}: typed`)
      assert.deepStrictEqual(
        movesOf(() => paste("translation", { ...before.get(l2)!.translation, y: y2 + 40 })),
        [0, 40, 0],
        `${mode}: pasted, as typed`
      )
    }
    // two links take each its own worked-out value, in chain order
    s().select([l3, l2])
    type("translation", "y", "L(0, 100)")
    assert.deepStrictEqual([l2, l3].map((id) => docTransform(id).translation.y), [0, 100])
    s().enterGroup(null)
  })

  it("moves a whole chain as one solid block by a typed location, whatever the settings", () => {
    const { ids, before } = setup()
    s().chainSelection()
    s().select([...ids])
    for (const mode of ["together", "each"] as const) {
      if (s().pivotMode !== mode) s().togglePivotMode()
      offset("translation", "y", 40)
      assert.deepStrictEqual(ids.map((id) => docTransform(id).translation.y - before.get(id)!.translation.y), [
        40,
        40,
        40
      ], mode)
      s().undo()
    }
    if (s().pivotMode !== "together") s().togglePivotMode()
  })

  it("turns each piece about its own pivot by a typed yaw, so every pivot stays put", () => {
    const { ids, before } = withPivots()
    s().togglePivotMode()
    const where = () => new Map(ids.map((id) => [id, pivotPoint(id)]))
    const pivots = where()
    type("rotation", "z", "+= 30")
    for (const id of ids) {
      expectVec(pivotPoint(id), pivots.get(id)!, id)
      assert.closeTo(
        (readField(docTransform(id), "rotation").z - readField(before.get(id)!, "rotation").z + 720) % 360,
        30,
        1e-6,
        id
      )
    }
    s().togglePivotMode()
  })
})

describe("a whole group's Transform rows, over its frame", () => {
  const grouped = () => {
    const setUp = setup()
    s().groupSelection()
    const unit = () => selectionPivot(s(), (id) => shownTransform(s(), id))!.unit
    return { ...setUp, unit }
  }

  it("is a point with no turn and no scale of its own, at the group's pivot", () => {
    const { unit } = grouped()
    const frame = unit()
    expectVec(frame.translation, selectionPivot(s(), (id) => docTransform(id))!.pivot, "pivot")
    expectVec(readField(frame, "rotation"), { x: 0, y: 0, z: 0 }, "rotation")
    expectVec(frame.scale3D, { x: 1, y: 1, z: 1 }, "scale")
  })

  it("moves the group by a typed location, so the frame lands on the value", () => {
    const { ids, before, unit } = grouped()
    const from = unit().translation
    setTo("translation", "x", from.x + 250)
    expectVec(unit().translation, { ...from, x: from.x + 250 }, "frame")
    for (const id of ids) {
      expectVec(docTransform(id).translation, vecAdd(before.get(id)!.translation, { x: 250, y: 0, z: 0 }), id)
    }
  })

  it("turns the group rigidly about its pivot by a typed yaw, which the row then reads as the group's turn", () => {
    const { ids, before, unit } = grouped()
    const pivot = unit().translation
    setTo("rotation", "z", 90)
    expectQuarterTurnAbout(before, pivot)
    for (const id of ids) {
      sameTransform(
        docTransform(id),
        applyGroupDelta(before.get(id)!, pivot, {
          kind: "rotate",
          rotation: rotatorToQuat({ roll: 0, pitch: 0, yaw: 90 })
        }),
        id
      )
    }
    expectVec(readField(unit(), "rotation"), { x: 0, y: 0, z: 90 }, "rotation")
    expectVec(unit().translation, pivot, "the pivot stays, on the box that turned with the group")
    // typing the value it already holds turns nothing
    setTo("rotation", "z", 90)
    expectQuarterTurnAbout(before, pivot)
  })

  it("takes a pasted row as the group's new values: a turn to the pasted yaw, a scale by the ratio, a move there", () => {
    const { ids, before, unit } = grouped()
    const pivot = unit().translation
    paste("rotation", { x: 0, y: 0, z: 90 })
    expectQuarterTurnAbout(before, pivot)
    const turned = new Map(ids.map((id) => [id, docTransform(id)]))
    paste("scale3D", { x: 1, y: 2, z: 1 })
    for (const id of ids) {
      sameTransform(
        docTransform(id),
        applyGroupDelta(turned.get(id)!, pivot, { kind: "scale", factor: 2, axis: "y" }),
        id
      )
    }
    const moved = new Map(ids.map((id) => [id, docTransform(id)]))
    paste("translation", vecAdd(unit().translation, { x: 5, y: 0, z: 0 }))
    for (const id of ids) assert.closeTo(docTransform(id).translation.x, moved.get(id)!.translation.x + 5, 1e-9)
  })

  it("scales every item by a typed factor about the pivot, along its own axes, and the row reads 1 again", () => {
    const { ids, before, unit } = grouped()
    const pivot = unit().translation
    setTo("scale3D", "y", 2)
    for (const id of ids) {
      sameTransform(
        docTransform(id),
        applyGroupDelta(before.get(id)!, pivot, { kind: "scale", factor: 2, axis: "y" }),
        id
      )
    }
    expectVec(unit().scale3D, { x: 1, y: 1, z: 1 }, "scale")
  })
})

describe("a pivot on the piece, as measured in the game (docs/qa/gizmo-scale.md)", () => {
  beforeAll(() => useEditor.setState({ catalogIndex: indexCatalog(catalog) }))

  /** A lone cube at `translation`, selected, with `choice` for its pivot. */
  const cubeAt = (translation: Vec3, yaw: number, choice: "Left" | "Top") => {
    s().loadMap(initialMap(), null)
    s().placePiece(cube, {
      ...placementTransform(cube, translation),
      translation: { ...translation },
      rotation: { ...rotatorToQuat({ roll: 0, pitch: 0, yaw }) }
    })
    setSelectionPivot(choice)
    return s().selectedIds[0]!
  }

  it("shows the gizmo pivot for a mixed selection with an active group, as the Location of the unit it moves", () => {
    const { ids } = setup()
    s().select(ids.slice(1))
    s().groupSelection()
    s().select(ids)
    const target = selectionPivot(s(), (id) => shownTransform(s(), id))!
    expectVec(target.unit.translation, target.pivot, "the Location row")
    assert.strictEqual(shownPivotPoint(s()), undefined, "no Position row repeating it")
  })

  /** The selection's unit as the Inspector's rows read it, and that unit's size at scale 1. */
  const unitNow = () => {
    const target = selectionPivot(s(), (id) => shownTransform(s(), id))!
    const unit = target.selection.units[0]!
    return { target, extent: unitExtentOf(s(), unit) }
  }
  it("gives a group a Location, its pivot, that a typed value moves it to like a piece's", () => {
    const { ids } = setup()
    s().groupSelection()
    const { target } = unitNow()
    expectVec(target.unit.translation, target.pivot, "Location is the pivot")
    setTo("translation", "x", 1000)
    const after = unitNow().target
    assertVec(after.pivot, { ...target.pivot, x: 1000 }, "the group moved so its pivot is at x = 1000")
    for (const id of ids) assert.closeTo(docTransform(id).translation.y, shownTransform(s(), id)!.translation.y, 1e-6)
  })

  it("gives a plain group no size, since its turned items don't scale its box by the factor", () => {
    setup()
    s().groupSelection()
    assert.isUndefined(unitNow().extent)
  })

  it("sizes a group that pivots on a member by that member, whose transform its rows read", () => {
    const { ids } = setup()
    s().groupSelection()
    const group = s().doc.structure.tree.find((node) => node.kind === "group")!
    s().setGroupPivot(group.id, { choice: "item", key: ids[1]! })
    const { target, extent } = unitNow()
    assert.strictEqual(target.selection.units[0]?.anchor, ids[1])
    const item = s().doc.map.items[s().doc.ids.indexOf(ids[1]!)]!
    assertVec(extent!, extentOf(item, s().catalogIndex)!, "the member's own extent")
  })

  it("does not change member pivots through a whole group, but allows them after entering", () => {
    const { ids } = setup()
    s().groupSelection()
    const group = s().doc.structure.tree.find((node) => node.kind === "group")!
    const before = s().doc
    setSelectionPivot("Top")
    assert.strictEqual(s().doc, before)
    s().enterGroup(group.id)
    setSelectionPivot("Top")
    for (const id of ids) assert.strictEqual(pivotOf(s(), id).choice, "Top")
  })

  it("pastes a size onto every item along its own axes, keeping flips and each pivot", () => {
    const id = cubeAt({ x: 0, y: 0, z: 5000 }, 30, "Left")
    s().transformItems(new Map([[id, { ...docTransform(id), scale3D: { x: -2, y: 1, z: 0.5 } }]]))
    const before = shownPivotPoint(s())!
    paste("size", { x: 500, y: 3000, z: 250 })
    // the cube is 1000 cm a side: a flipped X stays flipped
    expectVec(docTransform(id).scale3D, { x: -0.5, y: 3, z: 0.25 }, "scale")
    expectVec(shownPivotPoint(s())!, before, "pivot")
  })

  it("keeps the left face where it is and grows to the right", () => {
    const id = cubeAt({ x: 0, y: 0, z: 5000 }, 0, "Left")
    setTo("scale3D", "y", 2)
    expectVec(docTransform(id).translation, { x: 0, y: 500, z: 5000 }, "origin")
    expectVec(shownPivotPoint(s())!, { x: 0, y: -500, z: 5500 }, "pivot")
  })

  it("keeps the top where it is and grows downwards, on a turned piece too", () => {
    const id = cubeAt({ x: 3000, y: 0, z: 5000 }, 90, "Top")
    setTo("scale3D", "z", 3)
    expectVec(docTransform(id).translation, { x: 3000, y: 0, z: 3000 }, "origin")
    expectVec(shownPivotPoint(s())!, { x: 3000, y: 0, z: 6000 }, "pivot")
  })

  it("moves the piece by what its pivot moves, which is what the game's Location field does", () => {
    const id = cubeAt({ x: 0, y: 0, z: 5000 }, 0, "Left")
    setTo("scale3D", "y", 2)
    offset("translation", "x", 100)
    expectVec(docTransform(id).translation, { x: 100, y: 500, z: 5000 }, "origin")
    expectVec(shownPivotPoint(s())!, { x: 100, y: -500, z: 5500 }, "pivot")
  })

  it("shows a pivot point only where it isn't the Location already: off a piece's origin, never for a group's frame", () => {
    const { ids } = setup()
    s().select(ids.slice(0, 1))
    assert.strictEqual(shownPivotPoint(s()), undefined)
    s().select(ids)
    setSelectionPivot("Left")
    assert.isDefined(shownPivotPoint(s()))
    s().groupSelection()
    const target = selectionPivot(s(), (id) => shownTransform(s(), id))!
    expectVec(target.unit.translation, target.pivot, "a group's Location is its pivot")
    assert.strictEqual(shownPivotPoint(s()), undefined)
  })

  it("refuses a pivot on a whole group, whose gizmo sits on its frame, as the game does", () => {
    const { ids } = setup()
    s().groupSelection()
    setSelectionPivot("Left")
    for (const id of ids) assert.strictEqual(pivotOf(s(), id).choice, "Default")
  })
})

describe("a group, a whole chain and a loose piece in the fields, each one thing (#263)", () => {
  beforeAll(() => useEditor.setState({ catalogIndex: indexCatalog(catalog) }))

  /** Two cubes grouped, three chained and one loose, apart from one another, selected group, chain, piece. */
  const mixed = () => {
    s().loadMap(initialMap(), null)
    if (s().pivotMode !== "together") s().togglePivotMode()
    const place = (x: number, y: number) => {
      s().placePiece(cube, placementTransform(cube, { x, y, z: 50 }))
      return s().selectedIds[0]!
    }
    const group = [place(0, 0), place(1500, 300)]
    s().select(group)
    s().groupSelection()
    const chain = [place(0, 5000), place(1000, 5000), place(2000, 5000)]
    s().select(chain)
    s().chainSelection()
    const piece = place(9000, -4000)
    const ids = [...group, ...chain, piece]
    s().select(ids)
    return { group, chain, piece, ids }
  }
  const things = () => selectionThings(s(), (id) => shownTransform(s(), id))!
  const shown = (field: TransformField | "size" | "pivot", axis: Axis) =>
    things().map((thing) => readThing(thing, viewOf(field))?.[axis])
  const distance = (a: string, b: string) => {
    const d = vecSub(docTransform(a).translation, docTransform(b).translation)
    return Math.hypot(d.x, d.y, d.z)
  }
  /** Every distance inside the group and the chain, which no field edit may change but a scale. */
  const shapeOf = ({ group, chain }: ReturnType<typeof mixed>) => [
    distance(group[0]!, group[1]!),
    distance(chain[0]!, chain[1]!),
    distance(chain[1]!, chain[2]!),
    distance(chain[0]!, chain[2]!)
  ]
  const expectShape = (actual: ReadonlyArray<number>, expected: ReadonlyArray<number>, message: string) =>
    actual.forEach((d, i) => assert.closeTo(d, expected[i]!, 1e-6, message))

  it("reads Multiple where the things differ, and the one value once a number sets them all", () => {
    const setUp = mixed()
    const shape = shapeOf(setUp)
    assert.lengthOf(things(), 3, "a group, a chain and a piece are three things")
    assert.isNull(sharedValue(shown("translation", "x"), 1e-6))
    assert.strictEqual(sharedValue(shown("scale3D", "x"), 1e-6), 1, "they agree on a scale")
    type("translation", "x", "500")
    assert.strictEqual(sharedValue(shown("translation", "x"), 1e-6), 500)
    expectShape(shapeOf(setUp), shape, "the group and the chain moved whole")
  })

  it("moves each thing by += from its own value", () => {
    const setUp = mixed()
    const before = new Map(setUp.ids.map((id) => [id, docTransform(id)]))
    type("translation", "y", "+= 100")
    for (const id of setUp.ids) {
      assert.closeTo(docTransform(id).translation.y, before.get(id)!.translation.y + 100, 1e-6)
    }
    s().undo()
    type("translation", "y", "+100")
    for (const id of setUp.ids) {
      assert.closeTo(docTransform(id).translation.y, before.get(id)!.translation.y + 100, 1e-6)
    }
  })

  it("spaces them evenly with $prev + 300 and spreads them with L(0, 1000), in selection order", () => {
    const setUp = mixed()
    const shape = shapeOf(setUp)
    const [first = 0] = shown("translation", "x")
    type("translation", "x", "$prev + 300")
    assert.deepStrictEqual(shown("translation", "x"), [first, first + 300, first + 600])
    type("translation", "y", "L(0, 1000)")
    assert.deepStrictEqual(shown("translation", "y"), [0, 500, 1000])
    expectShape(shapeOf(setUp), shape, "nothing deformed")
    // selected piece first, the piece leads
    s().select([setUp.piece, ...setUp.group, ...setUp.chain])
    type("translation", "y", "L(0, 1000)")
    assert.strictEqual(docTransform(setUp.piece).translation.y, 0)
    assert.deepStrictEqual(shown("translation", "y"), [0, 500, 1000])
  })

  it("takes a pasted row exactly as its three values typed, and never collapses the group", () => {
    const setUp = mixed()
    const shape = shapeOf(setUp)
    for (
      const [field, value] of [
        ["translation", { x: 100, y: 200, z: 300 }],
        ["rotation", { x: 0, y: 0, z: 90 }],
        ["scale3D", { x: 2, y: 1, z: 0.5 }]
      ] as const
    ) {
      const steps = s().past.length
      paste(field, value)
      const pasted = new Map(setUp.ids.map((id) => [id, docTransform(id)]))
      while (s().past.length > steps) s().undo()
      for (const axis of ["x", "y", "z"] as const) type(field, axis, `${value[axis]}`)
      for (const id of setUp.ids) sameTransform(docTransform(id), pasted.get(id)!, `${field} ${id}`)
      // a group holds no scale of its own, so its Scale reads 1 again after one
      if (field !== "scale3D") {
        for (const axis of ["x", "y", "z"] as const) {
          assert.closeTo(sharedValue(shown(field, axis), 1e-6) ?? Number.NaN, value[axis], 1e-6, `${field} ${axis}`)
        }
        expectShape(shapeOf(setUp), shape, field)
      }
      while (s().past.length > steps) s().undo()
    }
  })

  it("scales the group and the chain whole about their pivots, so their gaps scale with them", () => {
    const setUp = mixed()
    const gap = docTransform(setUp.group[1]!).translation.x - docTransform(setUp.group[0]!).translation.x
    type("scale3D", "x", "2")
    assert.closeTo(
      docTransform(setUp.group[1]!).translation.x - docTransform(setUp.group[0]!).translation.x,
      gap * 2,
      1e-6
    )
    for (const id of setUp.ids) assert.closeTo(docTransform(id).scale3D.x, 2, 1e-9, id)
  })

  it("lands every pivot on a typed Position, moving each thing whole", () => {
    const setUp = mixed()
    const shape = shapeOf(setUp)
    type("pivot", "x", "700")
    assert.deepStrictEqual(shown("pivot", "x"), [700, 700, 700])
    expectShape(shapeOf(setUp), shape, "moved whole")
  })

  it("shows the combined pivot in Together, which moves everything as one, and each one's own in Each", () => {
    const setUp = mixed()
    const before = new Map(setUp.ids.map((id) => [id, docTransform(id)]))
    const together = pivotRowOf(s())!
    assert.isFalse(together.each)
    assertVec(together.points[0]!, selectionPivot(s(), (id) => shownTransform(s(), id))!.pivot, "where the gizmo sits")
    // what the Position field does in Together: the change that brings the combined pivot to 500, for every thing
    editSelectionField(viewOf("pivot"), "x", offsetEntry(500 - together.points[0]!.x))
    assert.closeTo(pivotRowOf(s())!.points[0]!.x, 500, 1e-6)
    for (const id of setUp.ids) {
      assert.closeTo(
        docTransform(id).translation.x - before.get(id)!.translation.x,
        500 - together.points[0]!.x,
        1e-6,
        id
      )
    }
    s().togglePivotMode()
    assert.isUndefined(pivotRowOf(s()), "in Each every pivot is its thing's Location already")
    s().select([setUp.piece])
    setSelectionPivot("Top")
    s().select(setUp.ids)
    const each = pivotRowOf(s())!
    assert.isTrue(each.each)
    assert.lengthOf(each.points, 3)
    assert.strictEqual(each.active, 2, "the piece, selected last")
    s().togglePivotMode()
  })

  it("keeps a whole chain's flip when its own Size is pasted back", () => {
    const { chain } = mixed()
    s().select(chain)
    const [root = ""] = chain
    s().transformItems(new Map([[root, { ...docTransform(root), scale3D: { x: -1, y: 1, z: 1 } }]]))
    const before = new Map(chain.map((id) => [id, docTransform(id)]))
    const [thing] = things()
    paste("size", readThing(thing!, viewOf("size"))!)
    for (const id of chain) sameTransform(docTransform(id), before.get(id)!, id)
    type("size", "x", "*= 2")
    assert.strictEqual(docTransform(root).scale3D.x, -2, "a size keeps the flip")
  })
})
