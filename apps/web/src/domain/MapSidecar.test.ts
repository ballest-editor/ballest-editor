import { assert, describe, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { MapSidecar } from "./MapSidecar"

const Codec = Schema.fromJsonString(MapSidecar)

const sidecar = {
  formatVersion: 1,
  mapHash: "a".repeat(64),
  items: {
    "k-1": { index: 0, fingerprint: "BP_Prim_Cube|0,0,0|0,0,0,1|1,1,1" },
    k_2: { index: 1, fingerprint: "BP_Prim_Cube|1,0,0|0,0,0,1|1,1,1", name: "Left ramp", tags: ["start", "hard"] },
    k3: { index: 2, fingerprint: "BP_Prim_Cube|2,0,0|0,0,0,1|1,1,1" }
  },
  tree: [
    { kind: "item", key: "k-1" },
    {
      kind: "group",
      id: "g1",
      name: "Outer",
      tags: ["a"],
      children: [
        { kind: "group", id: "g2", name: "Inner", tags: [], children: [{ kind: "item", key: "k_2" }] },
        { kind: "item", key: "k3" }
      ]
    }
  ]
}

describe("MapSidecar", () => {
  it("round-trips nested groups, names and tags", () => {
    const text = JSON.stringify(sidecar)
    const decoded = Schema.decodeSync(Codec)(text)
    assert.deepStrictEqual(JSON.parse(Schema.encodeSync(Codec)(decoded)), sidecar)
  })

  it("round-trips a group's pivot and a chain with its growth, and refuses a pivot or growth it doesn't know", () => {
    const decodes = (value: unknown) => Option.isSome(Schema.decodeUnknownOption(MapSidecar)(value))
    const withGroups = (...groups: ReadonlyArray<Record<string, unknown>>) => ({
      ...sidecar,
      tree: groups.map((extra, i) => ({ kind: "group", id: `p${i}`, name: "G", tags: [], children: [], ...extra }))
    })
    const good = withGroups(
      { pivot: { choice: "Top" } },
      { pivot: { choice: "item", key: "k3" } },
      { pivot: { choice: "point", world: { x: 1, y: -2.5, z: 3 } }, chain: true },
      { chain: true, growth: { curve: "compound", percent: -12.5 } }
    )
    const text = JSON.stringify(good)
    assert.deepStrictEqual(JSON.parse(Schema.encodeSync(Codec)(Schema.decodeSync(Codec)(text))), good)
    assert.isFalse(decodes(withGroups({ pivot: { choice: "Centre" } })))
    assert.isFalse(decodes(withGroups({ pivot: { choice: "item" } })))
    assert.isFalse(decodes(withGroups({ pivot: { choice: "point", world: { x: 1, y: 2 } } })))
    assert.isFalse(decodes(withGroups({ chain: false })))
    assert.isFalse(decodes(withGroups({ chain: true, growth: { curve: "steep", percent: 10 } })))
    assert.isFalse(decodes(withGroups({ chain: true, growth: { curve: "linear" } })))
  })

  it("refuses a sidecar of another format version, or a key that isn't URL-safe", () => {
    const decodes = (value: unknown) => Option.isSome(Schema.decodeUnknownOption(MapSidecar)(value))
    assert.isTrue(decodes(sidecar))
    assert.isFalse(decodes({ ...sidecar, formatVersion: 2 }))
    assert.isFalse(decodes({ ...sidecar, mapHash: "abc" }))
    assert.isFalse(decodes({ ...sidecar, tree: [{ kind: "item", key: "not a key" }] }))
    assert.isFalse(decodes({ ...sidecar, items: { k: { index: -1, fingerprint: "" } } }))
  })
})
