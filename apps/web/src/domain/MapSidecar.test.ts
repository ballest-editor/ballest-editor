import { assert, describe, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { MapSidecar } from "./MapSidecar"
import { defaultSnapConfig, SnapConfig } from "./snapConfig"

const Codec = Schema.fromJsonString(MapSidecar)

const sidecar = {
  formatVersion: 1,
  mapHash: "a".repeat(64),
  items: {
    "k-1": { index: 0, fingerprint: "BP_Prim_Cube|0,0,0|0,0,0,1|1,1,1", locked: true },
    k_2: { index: 1, fingerprint: "BP_Prim_Cube|1,0,0|0,0,0,1|1,1,1", name: "Left ramp", tags: ["start", "hard"] },
    k3: {
      index: 2,
      fingerprint: "BP_Prim_Cube|2,0,0|0,0,0,1|1,1,1",
      connectAt: { "0": "topLeft", "1": "centre" },
      hidden: true
    }
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
  it("refuses a connection spot it doesn't know, and drops one not keyed by an end", () => {
    const decoded = (connectAt: unknown) =>
      Schema.decodeUnknownOption(MapSidecar)({ ...sidecar, items: { k3: { index: 2, fingerprint: "x", connectAt } } })
        .pipe(Option.map(({ items }) => items["k3"]?.connectAt))
    assert.deepStrictEqual(decoded({ "2": "bottomRight" }), Option.some({ "2": "bottomRight" }))
    assert.isTrue(Option.isNone(decoded({ "0": "middle" })))
    assert.deepStrictEqual(decoded({ front: "top" }), Option.some({}))
  })

  it("refuses hidden or locked written as anything but true", () => {
    const decodes = (extra: Record<string, unknown>) =>
      Option.isSome(
        Schema.decodeUnknownOption(MapSidecar)({ ...sidecar, items: { k3: { index: 2, fingerprint: "x", ...extra } } })
      )
    assert.isTrue(decodes({ hidden: true, locked: true }))
    assert.isFalse(decodes({ hidden: false }))
    assert.isFalse(decodes({ locked: "yes" }))
  })

  it("round-trips nested groups, names, tags, connection spots and hidden and locked items", () => {
    const text = JSON.stringify(sidecar)
    const decoded = Schema.decodeSync(Codec)(text)
    assert.deepStrictEqual(JSON.parse(Schema.encodeSync(Codec)(decoded)), sidecar)
  })

  it("round-trips a group's pivot, turn and a chain with its growth, and refuses ones it doesn't know", () => {
    const decodes = (value: unknown) => Option.isSome(Schema.decodeUnknownOption(MapSidecar)(value))
    const withGroups = (...groups: ReadonlyArray<Record<string, unknown>>) => ({
      ...sidecar,
      tree: groups.map((extra, i) => ({ kind: "group", id: `p${i}`, name: "G", tags: [], children: [], ...extra }))
    })
    const good = withGroups(
      { pivot: { choice: "Top" } },
      { pivot: { choice: "item", key: "k3" } },
      { pivot: { choice: "point", world: { x: 1, y: -2.5, z: 3 } }, chain: true },
      { chain: true, growth: { curve: "compound", percent: -12.5 } },
      { rotation: { x: 0, y: 0, z: 0.5, w: 0.8660254037844387 } }
    )
    const text = JSON.stringify(good)
    assert.deepStrictEqual(JSON.parse(Schema.encodeSync(Codec)(Schema.decodeSync(Codec)(text))), good)
    assert.isFalse(decodes(withGroups({ pivot: { choice: "Centre" } })))
    assert.isFalse(decodes(withGroups({ pivot: { choice: "item" } })))
    assert.isFalse(decodes(withGroups({ pivot: { choice: "point", world: { x: 1, y: 2 } } })))
    assert.isFalse(decodes(withGroups({ chain: false })))
    assert.isFalse(decodes(withGroups({ rotation: { x: 0, y: 0, z: 1 } })))
    assert.isFalse(decodes(withGroups({ chain: true, growth: { curve: "steep", percent: 10 } })))
    assert.isFalse(decodes(withGroups({ chain: true, growth: { curve: "linear" } })))
  })

  it("round-trips a prefab link with its members' overrides, and reads one written before overrides", () => {
    const decodes = (value: unknown) => Option.isSome(Schema.decodeUnknownOption(MapSidecar)(value))
    const link = { tier: "user", name: "Arch", hash: "b".repeat(64), items: ["a|0,0,0|0,0,0,1|1,1,1|f"] }
    const withLink = (prefab: Record<string, unknown>) => ({
      ...sidecar,
      tree: [{ kind: "group", id: "i", name: "Arch", tags: [], children: [], prefab }]
    })
    const good = withLink({
      ...link,
      overrides: [{
        member: 0,
        transform: {
          translation: { x: -1000, y: 0, z: 12.5 },
          rotation: { x: 0, y: 0, z: 0.5, w: 0.8660254 },
          scale3D: { x: 2, y: 1, z: 1 }
        },
        paint: true
      }, { member: 3, hidden: true }]
    })
    const text = JSON.stringify(good)
    assert.deepStrictEqual(JSON.parse(Schema.encodeSync(Codec)(Schema.decodeSync(Codec)(text))), good)
    const old = withLink(link)
    assert.deepStrictEqual(JSON.parse(Schema.encodeSync(Codec)(Schema.decodeSync(Codec)(JSON.stringify(old)))), old)
    assert.isFalse(decodes(withLink({ ...link, overrides: [{ member: -1, paint: true }] })))
    assert.isFalse(decodes(withLink({ ...link, overrides: [{ member: 0, transform: true }] })))
    assert.isFalse(decodes(withLink({ ...link, overrides: [{ member: 0, paint: false }] })))
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

describe("snap data", () => {
  const decode = Schema.decodeUnknownOption(MapSidecar)
  const bare = { formatVersion: 1, mapHash: "a".repeat(64), items: {}, tree: [] }

  it("reads a sidecar written before snapping had any", () => {
    assert.isTrue(Option.isSome(decode(bare)))
  })

  it("reads a map's snapping from before your snapping moved to Settings, without what moved", () => {
    const snap = Schema.encodeSync(SnapConfig)(defaultSnapConfig)
    const old = {
      ...snap,
      bodyDrag: "never",
      targets: { ...snap.targets, mesh: { ...snap.targets.mesh, occlusion: "through" } }
    }
    const decoded = decode({ ...bare, snap: old })
    assert.isTrue(Option.isSome(decoded))
    assert.deepStrictEqual(Option.getOrThrow(decoded).snap, defaultSnapConfig)
  })

  it("reads annotations and turns down a joint that names no item", () => {
    const joint = { a: { item: "abc", end: 0 }, b: { item: "def", end: 1 } }
    const annotations = { joints: [joint], construction: [], measurements: [] }
    assert.isTrue(Option.isSome(decode({ ...bare, annotations })))
    const broken = { ...annotations, joints: [{ a: { item: "", end: 0 }, b: joint.b }] }
    assert.isTrue(Option.isNone(decode({ ...bare, annotations: broken })))
  })
})
