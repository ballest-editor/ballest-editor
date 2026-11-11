import { assert, describe, it } from "@effect/vitest"
import { defaultSnapConfig, type SnapConfig } from "../../domain/snapConfig"
import { ORIGIN, rotatorToQuat } from "../../domain/ueMath"
import { grouped, loadPieces, lookDown } from "../../test/snapFixtures"
import { PaneCamera } from "../paneCameras"
import { shownGroupFrame, useEditor } from "../store"
import { MoveSession } from "./moveSession"
import { snapItemsOf } from "./snapScene"
import { snapViewOf } from "./snapView"

/** Only the Mesh target, with nothing but its bounds faces and their middle. */
const onlyBoundsFaces: SnapConfig = {
  ...defaultSnapConfig,
  magnet: true,
  targets: {
    ...defaultSnapConfig.targets,
    grid: { ...defaultSnapConfig.targets.grid, enabled: false },
    connectors: { ...defaultSnapConfig.targets.connectors, enabled: false },
    mesh: {
      ...defaultSnapConfig.targets.mesh,
      elements: {
        boundsCorners: false,
        boundsFaceCentres: false,
        boundsFaces: true,
        vertices: false,
        sharpEdges: false,
        edgeMidpoints: false,
        faceCentres: false,
        faces: false
      }
    },
    construction: { enabled: false },
    tracking: { enabled: false },
    alignment: { ...defaultSnapConfig.targets.alignment, enabled: false }
  }
}

/** The first piece at the origin, and a group of two 1000 cm pieces from x -2500 to 1500, its middle at -500. */
const besideGroup = () => {
  const [moved = "", ...rest] = loadPieces([ORIGIN, { x: -2000, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }])
  const group = grouped(rest)
  useEditor.getState().select([moved])
  useEditor.getState().setTabSnap(onlyBoundsFaces)
  return { moved, rest, group }
}

describe("snapItemsOf", () => {
  it("offers a group as a target, named as the Outline names it, with the box around its items", () => {
    const { group, moved, rest } = besideGroup()
    const items = snapItemsOf(useEditor.getState(), new Set([moved]), 30)
    const target = items.find((item) => item.key === group)
    assert.strictEqual(target?.name, "Group")
    const members = items.filter((item) => rest.includes(item.key))
    assert.closeTo(target?.box.min.x ?? 0, Math.min(...members.map(({ box }) => box.min.x)), 1e-6)
    assert.closeTo(target?.box.max.x ?? 0, Math.max(...members.map(({ box }) => box.max.x)), 1e-6)
    assert.deepStrictEqual(target?.ends, [])
  })

  it("leaves out a group holding something that moves, as its box moves with it", () => {
    const { group, rest } = besideGroup()
    const items = snapItemsOf(useEditor.getState(), new Set(rest.slice(0, 1)), 30)
    assert.isUndefined(items.find((item) => item.key === group))
  })

  it("counts a hidden item in its group's box, and offers the item itself as no target", () => {
    const { group, moved, rest } = besideGroup()
    useEditor.getState().setItemFlag(rest.slice(1), "hidden", true)
    const items = snapItemsOf(useEditor.getState(), new Set([moved]), 30)
    const target = items.find((item) => item.key === group)
    assert.closeTo(target?.box.max.x ?? 0, 1500, 0.01, "the hidden item at 1000 still reaches to 1500")
    assert.isUndefined(items.find((item) => item.key === rest[1]))
  })

  it("squares a turned group's box to its turn, as the group's frame has it", () => {
    const { group, moved } = besideGroup()
    const turn = rotatorToQuat({ roll: 0, pitch: 0, yaw: 30 })
    useEditor.setState((s) => ({
      doc: {
        ...s.doc,
        structure: {
          ...s.doc.structure,
          tree: s.doc.structure.tree.map((node) =>
            node.kind === "group" && node.id === group ? { ...node, rotation: turn } : node
          )
        }
      }
    }))
    const target = snapItemsOf(useEditor.getState(), new Set([moved]), 30).find((item) => item.key === group)
    const frame = shownGroupFrame(useEditor.getState(), group)
    assert.deepStrictEqual(target?.transform.rotation, turn)
    assert.deepStrictEqual(target?.transform.translation, frame?.origin)
    const h = frame?.halfExtents ?? ORIGIN
    assert.deepStrictEqual(target?.bounds, { min: [-h.x, -h.y, -h.z], max: [h.x, h.y, h.z] })
  })

  it("leaves out a group whose items are all hidden", () => {
    const { group, moved, rest } = besideGroup()
    useEditor.getState().setItemFlag(rest, "hidden", true)
    const items = snapItemsOf(useEditor.getState(), new Set([moved]), 30)
    assert.isUndefined(items.find((item) => item.key === group))
  })
})

/** A drag of the first piece from `from`, looking down, and how to point it at x along y 0. */
const dragAlongX = (moved: string, from = ORIGIN) => {
  const pane = lookDown(new PaneCamera())
  const view = snapViewOf(pane)
  const at = (x: number, y = 0) => {
    const px = view.project({ x, y, z: 0 }) ?? { x: 0, y: 0 }
    return { ray: view.rayAt(px), px }
  }
  const start = at(from.x, from.y)
  const session = new MoveSession({
    pane,
    keys: new Set([moved]),
    pivot: from,
    box: { min: from, max: from },
    ends: [],
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    frame: undefined,
    constraint: { kind: "surface", normal: { x: 0, y: 0, z: 1 } },
    ray: start.ray,
    px: start.px
  })
  const up = { off: false, hold: false }
  return { session, point: (x: number) => session.update(at(x).ray, at(x).px, up) }
}

describe("a move past a group", () => {
  it("stops an axis lock at the group's middle, where none of its items has one", () => {
    const { session, point } = dragAlongX(besideGroup().moved)
    session.toggleLock({ axis: "x", plane: false })
    point(-497)
    assert.strictEqual(point(-502).hit?.label, "Middle of Group")
  })

  it("stops an axis lock at the group's faces", () => {
    const { session, point } = dragAlongX(besideGroup().moved)
    session.toggleLock({ axis: "x", plane: false })
    point(1497)
    assert.strictEqual(point(1502).hit?.label, "Face of Group")
  })

  it("doesn't land a free drag on the group's box in the air between its items", () => {
    const { point } = dragAlongX(besideGroup().moved, { x: -500, y: 3000, z: 0 })
    point(-500)
    assert.isUndefined(point(-500).hit)
  })
})
