import { assert, beforeEach, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { indexCatalog } from "../../domain/Catalog"
import { editTransform } from "../../domain/editTransform"
import { identityTransform, itemFromPiece, newMapFile } from "../../domain/factory"
import { defaultSettings } from "../../domain/Settings"
import { defaultSnapConfig, type SnapConfig } from "../../domain/snapConfig"
import { rotatorToQuat } from "../../domain/ueMath"
import { leadingKeys, pivotUnitOf } from "../../domain/units"
import { catalogWithEnds, grouped, loadPieces } from "../../test/snapFixtures"
import { assertVec } from "../../test/vec"
import { setSelectionPivot } from "../actions/selection"
import { sceneRegistry } from "../sceneRegistry"
import { useEditor } from "../store"
import { baseFaceOf, bodyDrags, dragTargetOf, selectionSnapStart } from "./selectionStart"

const s = () => useEditor.getState()

const inScene = (keys: ReadonlyArray<string>) => {
  sceneRegistry.objects.clear()
  for (const key of keys) sceneRegistry.objects.set(key, new THREE.Object3D())
}

const load = (xs: ReadonlyArray<number>) => {
  const keys = loadPieces(xs.map((x) => ({ x, y: 0, z: 0 })))
  inScene(keys)
  return keys
}

const target = () => {
  const found = dragTargetOf(s())
  if (found === undefined) return assert.fail("nothing to drag")
  return found
}

const faceOfActive = () => baseFaceOf(s(), pivotUnitOf(target().selection, s().pivotMode))

describe("what a drag acts on", () => {
  beforeEach(() => sceneRegistry.objects.clear())

  it("starts at a whole group's pivot, where the gizmo sits, and not at an item's", () => {
    const [a = "", b = ""] = load([0, 1000])
    const id = grouped([a, b])
    const world = { x: 123, y: 45, z: 6 }
    s().setGroupPivot(id, { choice: "point", world })
    assert.deepStrictEqual(target().pivot, world)
    assert.notDeepEqual(target().activePivot, world)
  })

  it("reaches the links a selected link carries, which don't lead it", () => {
    const [root = "", link = "", last = ""] = load([0, 1000, 2000])
    s().enterGroup(grouped([root, link, last], true))
    s().select([link])
    const found = target()
    assert.deepStrictEqual([...found.transforms.keys()].toSorted(), [link, root, last].toSorted())
    const leading = selectionSnapStart(s(), found.transforms, leadingKeys(found.selection, "together"))
    const all = selectionSnapStart(s(), found.transforms, [...found.transforms.keys()])
    assert.isBelow(leading.ends.length, all.ends.length)
    assert.isAbove(leading.box.min.x, all.box.min.x, "the box is the selected link's alone")
  })

  it("leaves out what isn't in the scene", () => {
    const [a = "", b = ""] = load([0, 1000])
    inScene([a])
    s().select([a, b])
    assert.deepStrictEqual([...target().transforms.keys()], [a])
  })
})

describe("the face a turn brings flush", () => {
  beforeEach(() => sceneRegistry.objects.clear())

  it("is the item's pivot face along its own axes", () => {
    const [a = ""] = load([0])
    s().select([a])
    setSelectionPivot("Top")
    assertVec(faceOfActive() ?? { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, "out of the top")
  })

  it("is a group's chosen face along the world's axes, whatever way the active item faces", () => {
    const [a = "", b = ""] = load([0, 1000])
    const rotation = rotatorToQuat({ roll: 90, pitch: 0, yaw: 0 })
    const item = s().doc.map.items[0]
    if (item === undefined) return assert.fail("the map is empty")
    s().transformItems(new Map([[a, { ...editTransform(item), rotation }]]))
    const id = grouped([a, b])
    s().setGroupPivot(id, { choice: "Top" })
    assertVec(faceOfActive() ?? { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, "out of the group's top")
  })

  it("has none on a group that pivots off its faces", () => {
    const [a = "", b = ""] = load([0, 1000])
    const id = grouped([a, b])
    assert.isUndefined(faceOfActive(), "the centre")
    s().setGroupPivot(id, { choice: "point", world: { x: 1, y: 2, z: 3 } })
    assert.isUndefined(faceOfActive(), "a frozen point")
  })

  it("follows a group's Item pivot to that member's own face and axes", () => {
    const [a = "", b = ""] = load([0, 1000])
    s().select([a])
    setSelectionPivot("Top")
    const id = grouped([a, b])
    s().setGroupPivot(id, { choice: "item", key: a })
    assertVec(faceOfActive() ?? { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, "out of the member's top")
  })
})

describe("whether a press on the selection's body drags it", () => {
  beforeEach(() => sceneRegistry.objects.clear())

  const config = (bodyDrag: SnapConfig["bodyDrag"], enabled: boolean, connectors: boolean): SnapConfig => ({
    ...defaultSnapConfig,
    enabled,
    bodyDrag,
    targets: {
      ...defaultSnapConfig.targets,
      connectors: { ...defaultSnapConfig.targets.connectors, enabled: connectors }
    }
  })

  it.each(
    [
      ["ends", "snapping on, Connectors on, a piece with ends", true, true, 0, true],
      ["ends", "snapping off", false, true, 0, false],
      ["ends", "Connectors off", true, false, 0, false],
      ["ends", "a piece with no ends", true, true, 1, false],
      ["always", "snapping off, a piece with no ends", false, false, 1, true],
      ["never", "snapping on, Connectors on, a piece with ends", true, true, 0, false]
    ] as const
  )("%s, with %s: %s", (bodyDrag, _case, enabled, connectors, piece, drags) => {
    const [a = ""] = loadPieces([{ x: 0, y: 0, z: 0 }], piece)
    inScene([a])
    s().setTabSnap(config(bodyDrag, enabled, connectors))
    s().select([a])
    assert.strictEqual(bodyDrags(s()), drags)
  })

  it("counts the ends of everything it carries, not only the active item's", () => {
    const catalog = catalogWithEnds()
    const [withEnds, plain] = catalog.pieces
    if (withEnds === undefined || plain === undefined) return assert.fail("the bundled catalog is short")
    const map = {
      ...newMapFile({ displayName: "Test", creatorName: "me", createdAt: "" }),
      items: [
        itemFromPiece(withEnds, identityTransform({ x: 0, y: 0, z: 0 })),
        itemFromPiece(plain, identityTransform({ x: 1000, y: 0, z: 0 }))
      ]
    }
    useEditor.setState({ catalogIndex: indexCatalog(catalog), settings: defaultSettings })
    s().loadMap(map, null)
    const [a = "", b = ""] = s().doc.ids
    inScene([a, b])
    s().setTabSnap(config("ends", true, true))
    s().select([b])
    assert.isFalse(bodyDrags(s()), "the plain piece alone")
    s().select([b, a])
    assert.isTrue(bodyDrags(s()), "with the piece that has ends")
  })
})
