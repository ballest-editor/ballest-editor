import { assert, beforeEach, describe, it } from "@effect/vitest"
import * as THREE from "three"
import { leadingKeys } from "../../domain/units"
import { grouped, loadPieces } from "../../test/snapFixtures"
import { sceneRegistry } from "../sceneRegistry"
import { useEditor } from "../store"
import { dragTargetOf, selectionSnapStart } from "./selectionStart"

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
