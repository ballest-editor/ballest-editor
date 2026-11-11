import { assert, beforeAll, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import fixture from "../domain/bundledCatalog.json"
import { Catalog, indexCatalog } from "../domain/Catalog"
import type { UeTransform, Vec3 } from "../domain/coords"
import { placementTransform } from "../domain/factory"
import { applyGroupDelta, type Axis, readField, selectionAxisEdit, type TransformField } from "../domain/groupTransform"
import { extentOf } from "../domain/itemBounds"
import { localToWorld } from "../domain/pivot"
import { quatConjugate, quatMul, rotateVec, rotatorToQuat, vecAdd } from "../domain/ueMath"
import { assertVec } from "../test/vec"
import {
  editSelectionAxis,
  moveSelectionBy,
  previewSelectionAxis,
  setSelectionField,
  setSelectionPivot,
  setSelectionSize,
  setSelectionUnitField
} from "./actions"
import { initialMap, pivotOf, selectionPivot, shownPivotPoint, shownTransform, unitExtentOf, useEditor } from "./store"

const catalog = Schema.decodeUnknownSync(Catalog)(fixture)
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
    expectQuarterTurnAbout(before, before.get(ids.at(-1)!)!.translation)
    // the active item turns in place and only its yaw changes
    const active = docTransform(ids.at(-1)!)
    expectVec(readField(active, "rotation"), { x: 5, y: -15, z: -150 }, "active rotator")
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

  it("scales about the active item's pivot, which stays put", () => {
    const { ids } = withPivots()
    const activeId = ids.at(-1)!
    for (
      const edit of [
        () => editSelectionAxis("scale3D", "z", { kind: "offset", by: 0.5 }),
        () => editSelectionAxis("scale3D", "x", { kind: "set", value: 2 })
      ]
    ) {
      const before = pivotPoint(activeId)
      edit()
      expectVec(pivotPoint(activeId), before, activeId)
    }
  })

  it("takes a typed value as the change from the active item, rigid about its pivot, as the game does", () => {
    // docs/qa/joins-and-typed-rotation.md: typing a yaw turns every piece by the change about the active pivot
    const { ids, before } = withPivots()
    const activeId = ids.at(-1)!
    const pivot = pivotPoint(activeId, before.get(activeId))
    const yaw = readField(before.get(activeId)!, "rotation").z
    editSelectionAxis("rotation", "z", { kind: "set", value: yaw + 90 })
    expectVec(pivotPoint(activeId), pivot, "active pivot")
    // the rotator wraps past 180, as the game's panel does (225 typed into 0 reads -135)
    assert.closeTo((readField(docTransform(activeId), "rotation").z - (yaw + 90) + 720) % 360, 0, 1e-6)
    expectQuarterTurnAbout(before, pivot)
    // a typed location moves every item by the change; only a pasted row sets them all
    const z = before.get(activeId)!.translation.z
    editSelectionAxis("translation", "z", { kind: "set", value: z + 70 })
    for (const id of ids) assert.closeTo(docTransform(id).translation.z, before.get(id)!.translation.z + 70, 1e-6)
    setSelectionField("translation", { x: 1, y: 2, z: 3 })
    for (const id of ids) expectVec(docTransform(id).translation, { x: 1, y: 2, z: 3 }, id)
  })

  it("pastes a rotation about each item's own pivot", () => {
    const { ids } = withPivots()
    const before = new Map(ids.map((id) => [id, pivotPoint(id)]))
    setSelectionField("rotation", { x: 10, y: 20, z: 30 })
    for (const id of ids) {
      expectVec(pivotPoint(id), before.get(id)!, id)
      expectVec(readField(docTransform(id), "rotation"), { x: 10, y: 20, z: 30 }, id)
    }
  })
})

describe("Each in the Inspector", () => {
  it("scales every unit by the active one's ratio, not by its difference", () => {
    const { ids } = setup()
    s().togglePivotMode()
    const [a = "", b = "", active = ""] = ids
    s().transformItems(new Map([[a, { ...docTransform(a), scale3D: { x: 2, y: 1, z: 1 } }]]))
    editSelectionAxis("scale3D", "x", { kind: "set", value: 2 })
    assert.closeTo(docTransform(a).scale3D.x, 4, 1e-9, "twice its own")
    assert.closeTo(docTransform(b).scale3D.x, 2, 1e-9)
    assert.closeTo(docTransform(active).scale3D.x, 2, 1e-9)
    s().togglePivotMode()
  })

  it("carries the links after a link edited inside an entered chain, rigidly in Rigid and adding up link by link", () => {
    const { ids } = setup()
    const [, l2 = ""] = ids
    s().chainSelection()
    const chain = s().doc.structure.tree.find((n) => n.kind === "group")
    s().enterGroup(chain?.kind === "group" ? chain.id : null)
    s().select([l2])
    const before = new Map(ids.map((id) => [id, docTransform(id)]))
    // how far each link moves for a y move of 40 on link 2; the link before stays
    const movesOf = () => {
      editSelectionAxis("translation", "y", { kind: "offset", by: 40 })
      const moves = ids.map((id) => docTransform(id).translation.y - before.get(id)!.translation.y)
      s().undo()
      return moves
    }
    assert.deepStrictEqual(movesOf(), [0, 40, 80], "a new chain goes link by link: the moves add up from link 2")
    s().togglePivotMode()
    assert.strictEqual(s().chainMode, "rigid")
    assert.deepStrictEqual(movesOf(), [0, 40, 40], "Rigid: link 3 is carried")
    s().togglePivotMode()
    s().enterGroup(null)
  })

  it("turns each piece about its own pivot by a typed yaw, so every pivot stays put", () => {
    const { ids, before } = withPivots()
    s().togglePivotMode()
    const where = () => new Map(ids.map((id) => [id, pivotPoint(id)]))
    const pivots = where()
    editSelectionAxis("rotation", "z", { kind: "set", value: readField(before.get(ids.at(-1)!)!, "rotation").z + 30 })
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
    editSelectionAxis("translation", "x", { kind: "set", value: from.x + 250 })
    expectVec(unit().translation, { ...from, x: from.x + 250 }, "frame")
    for (const id of ids) {
      expectVec(docTransform(id).translation, vecAdd(before.get(id)!.translation, { x: 250, y: 0, z: 0 }), id)
    }
  })

  it("turns the group rigidly about its pivot by a typed yaw, which the row then reads as the group's turn", () => {
    const { ids, before, unit } = grouped()
    const pivot = unit().translation
    editSelectionAxis("rotation", "z", { kind: "set", value: 90 })
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
    editSelectionAxis("rotation", "z", { kind: "set", value: 90 })
    expectQuarterTurnAbout(before, pivot)
  })

  it("takes a pasted row as the group's new values: a turn to the pasted yaw, a scale by the ratio, a move there", () => {
    const { ids, before, unit } = grouped()
    const pivot = unit().translation
    setSelectionUnitField("rotation", { x: 0, y: 0, z: 90 })
    expectQuarterTurnAbout(before, pivot)
    const turned = new Map(ids.map((id) => [id, docTransform(id)]))
    setSelectionUnitField("scale3D", { x: 1, y: 2, z: 1 })
    for (const id of ids) {
      sameTransform(
        docTransform(id),
        applyGroupDelta(turned.get(id)!, pivot, { kind: "scale", factor: 2, axis: "y" }),
        id
      )
    }
    const moved = new Map(ids.map((id) => [id, docTransform(id)]))
    moveSelectionBy({ x: 5, y: 0, z: 0 })
    for (const id of ids) assert.strictEqual(docTransform(id).translation.x, moved.get(id)!.translation.x + 5)
  })

  it("scales every item by a typed factor about the pivot, along its own axes, and the row reads 1 again", () => {
    const { ids, before, unit } = grouped()
    const pivot = unit().translation
    editSelectionAxis("scale3D", "y", { kind: "set", value: 2 })
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
    editSelectionAxis("translation", "x", { kind: "set", value: 1000 })
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
    setSelectionSize({ x: 500, y: 3000, z: 250 })
    // the cube is 1000 cm a side: a flipped X stays flipped
    expectVec(docTransform(id).scale3D, { x: -0.5, y: 3, z: 0.25 }, "scale")
    expectVec(shownPivotPoint(s())!, before, "pivot")
  })

  it("keeps the left face where it is and grows to the right", () => {
    const id = cubeAt({ x: 0, y: 0, z: 5000 }, 0, "Left")
    editSelectionAxis("scale3D", "y", { kind: "set", value: 2 })
    expectVec(docTransform(id).translation, { x: 0, y: 500, z: 5000 }, "origin")
    expectVec(shownPivotPoint(s())!, { x: 0, y: -500, z: 5500 }, "pivot")
  })

  it("keeps the top where it is and grows downwards, on a turned piece too", () => {
    const id = cubeAt({ x: 3000, y: 0, z: 5000 }, 90, "Top")
    editSelectionAxis("scale3D", "z", { kind: "set", value: 3 })
    expectVec(docTransform(id).translation, { x: 3000, y: 0, z: 3000 }, "origin")
    expectVec(shownPivotPoint(s())!, { x: 3000, y: 0, z: 6000 }, "pivot")
  })

  it("moves the piece by what its pivot moves, which is what the game's Location field does", () => {
    const id = cubeAt({ x: 0, y: 0, z: 5000 }, 0, "Left")
    editSelectionAxis("scale3D", "y", { kind: "set", value: 2 })
    editSelectionAxis("translation", "x", { kind: "offset", by: 100 })
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
