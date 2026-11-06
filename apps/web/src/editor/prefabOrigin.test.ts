import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import * as THREE from "three"
import { ueToThreeVector } from "../domain/coords"
import { mapOfPrefab } from "../domain/prefab"
import { PrefabFile } from "../domain/PrefabFile"
import { changedPrefab } from "../test/prefabs"
import { sceneAxisColors } from "./axisColors"
import { PrefabOrigin } from "./prefabOrigin"

const decodePrefab = Schema.decodeSync(Schema.fromJsonString(PrefabFile))

const barColor = (marker: PrefabOrigin, longest: "x" | "y" | "z") => {
  const bar = marker.bars.find(({ geometry }) => {
    geometry.computeBoundingBox()
    const size = geometry.boundingBox!.getSize(new THREE.Vector3())
    return size[longest] === Math.max(size.x, size.y, size.z)
  })
  return `#${bar?.material.color.getHexString()}`
}

describe("PrefabOrigin", () => {
  it("sits where a location of 0, 0, 0 lands in a definition's tab", () => {
    const atZero = changedPrefab(({ items }) => {
      items[0]!.transform.location = [0, 0, 0]
    })
    const { items } = mapOfPrefab("Zero", decodePrefab(atZero), null)
    const { x, y, z } = ueToThreeVector(items[0]!.itemTransform.translation)
    assert.deepStrictEqual(new PrefabOrigin(new THREE.Texture()).position.toArray(), [x, y, z])
  })

  it("keeps its size on screen, in a scene that doesn't work out matrices itself", () => {
    const marker = new PrefabOrigin(new THREE.Texture())
    marker.fitTo(3)
    assert.strictEqual(marker.scale.x, 3)
    assert.strictEqual(marker.matrixWorld.getMaxScaleOnAxis(), 3)
  })

  it("colours each of the game's axes as the gizmo does, with its Z standing up", () => {
    const marker = new PrefabOrigin(new THREE.Texture())
    for (const dark of [true, false]) {
      marker.setDark(dark)
      const colors = sceneAxisColors(dark)
      assert.strictEqual(barColor(marker, "x"), colors.x)
      assert.strictEqual(barColor(marker, "z"), colors.y)
      assert.strictEqual(barColor(marker, "y"), colors.z)
    }
  })
})
