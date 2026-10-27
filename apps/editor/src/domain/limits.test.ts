import { assert, describe, it } from "@effect/vitest"
import { addItem } from "./edits"
import { identityTransform, newMapFile, playerStartItem } from "./factory"
import { gameLoadProblems, isNormalizedRotation, LIMITS } from "./limits"
import type { Item, MapFile } from "./MapFile"

const fresh = (): MapFile => newMapFile({ displayName: "A", creatorName: "B", createdAt: "" })
const plain = (): Item => ({ ...playerStartItem(), actorToSpawn: "/Script/Engine.BlueprintGeneratedClass'/Game/X/BP_X.BP_X_C'" })
const withRotation = (item: Item, rotation: Item["itemTransform"]["rotation"]): Item => ({ ...item, itemTransform: { ...identityTransform(), rotation } })

describe("game load rules", () => {
  it("accepts a fresh map", () => {
    assert.deepStrictEqual(gameLoadProblems(fresh()), [])
  })

  it("requires exactly one player start", () => {
    assert.match(gameLoadProblems({ ...fresh(), items: [] })[0]!, /exactly one MP_PlayerStart.*has 0/)
    assert.match(gameLoadProblems(addItem(fresh(), playerStartItem()))[0]!, /has 2/)
  })

  it("rejects non-normalized rotations", () => {
    assert.isTrue(isNormalizedRotation({ x: 0, y: 0, z: Math.SQRT1_2 - 1e-5, w: Math.SQRT1_2 - 1e-5 }))
    assert.isFalse(isNormalizedRotation({ x: 0, y: 0, z: 1, w: 1 }))
    const map = addItem(fresh(), withRotation(plain(), { x: 0, y: 0, z: 1, w: 1 }))
    assert.deepStrictEqual(gameLoadProblems(map), ["Item 1 has a non-normalized rotation."])
  })

  it("enforces the per-item array limits", () => {
    const base = plain()
    const tooManyMeshes: Item = { ...base, meshComponents: Array.from({ length: LIMITS.meshComponentsPerItem + 1 }, () => base.meshComponents[0]!) }
    const tooManyProps: Item = {
      ...base,
      boolProperties: Array.from({ length: LIMITS.propertiesPerList + 1 }, () => ({ propertyName: "b", propertyType: "Bool", currentValue: true }))
    }
    const problems = gameLoadProblems(addItem(addItem(fresh(), tooManyMeshes), tooManyProps))
    assert.strictEqual(problems.length, 2)
    assert.match(problems[0]!, /Item 1 has 65 mesh components/)
    assert.match(problems[1]!, /Item 2 has 4097 boolProperties/)
  })

  it("enforces the item-count limit without touching every item", () => {
    const items = Array.from({ length: LIMITS.itemsPerLevel + 1 }, () => plain())
    const map: MapFile = { ...fresh(), items: [playerStartItem(), ...items] }
    assert.match(gameLoadProblems(map)[0]!, /100002 items/)
  })
})
