import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { listSamples, readSample } from "../test/samples"
import { catalogWithEnds } from "../test/snapFixtures"
import { indexCatalog } from "./Catalog"
import { defaultEditorState, identityTransform, itemFromPiece, newMapFile, playerStartItem } from "./factory"
import { type Item, MapFile } from "./MapFile"
import { type GroupNode, MapSidecar, type TreeNode } from "./MapSidecar"
import { fingerprintOf, loadGameStructure, loadStructure, sidecarOf, structureOfMap } from "./sidecar"
import { defaultSnapConfig } from "./snapConfig"
import {
  itemNode,
  type Structure,
  treeKeys,
  withAnnotations,
  withChain,
  withConnectAt,
  withGroup,
  withGroupPivot,
  withItemName,
  withTags
} from "./structure"
import { withFlag } from "./visibility"

const decodeMap = Schema.decodeUnknownSync(Schema.fromJsonString(MapFile))

const HASH = "a".repeat(64)
const OTHER_HASH = "b".repeat(64)

const start = playerStartItem()
const at = (x: number, y = 0, z = 0): Item => ({ ...start, itemTransform: identityTransform({ x, y, z }) })
const mapOf = (items: ReadonlyArray<Item>): MapFile => ({
  ...newMapFile({ displayName: "Test", creatorName: "me", createdAt: "" }),
  items
})
const nudged = (item: Item, dx: number): Item => {
  const { translation } = item.itemTransform
  return { ...item, itemTransform: { ...item.itemTransform, translation: { ...translation, x: translation.x + dx } } }
}

/** Five items, the middle three in a named group with a name and a tag on the way. */
const authored = () => {
  const map = mapOf([at(0), at(100), at(200), at(300), at(400)])
  const { ids, structure } = structureOfMap(map)
  const [k0 = "", k1 = "", k2 = "", k3 = "", k4 = ""] = ids
  let next: Structure = withGroup(structure, [k1, k2], "g1", "Inner")!
  next = withGroup(next, [k3], "g2", "Other")!
  next = withItemName(next, k1, "Named")!
  next = withTags(next, k2, ["tagged"])!
  next = withTags(next, "g1", ["a tag"])!
  next = withConnectAt(next, k3, 0, "bottomLeft")!
  return { map, ids, keys: { k0, k1, k2, k3, k4 }, structure: next, sidecar: sidecarOf(map, ids, next, HASH) }
}

describe("fingerprintOf", () => {
  it("names the class and the transform, rounded", () => {
    const item = at(1.234, -0.001, 8615.999)
    assert.strictEqual(fingerprintOf(item), "MP_PlayerStart|1.23,0,8616|0,0,0,1|1,1,1")
  })

  it("treats a quaternion and its negative as the same rotation", () => {
    const turned = (sign: number): Item => ({
      ...at(0),
      itemTransform: {
        ...at(0).itemTransform,
        rotation: { x: 0, y: 0, z: sign * Math.SQRT1_2, w: sign * Math.SQRT1_2 }
      }
    })
    assert.strictEqual(fingerprintOf(turned(1)), fingerprintOf(turned(-1)))
  })
})

describe("loadStructure", () => {
  it("trusts the sidecar's indices when the hash is the map's", () => {
    const { ids, map, sidecar, structure } = authored()
    const loaded = loadStructure(map, HASH, sidecar)
    assert.deepStrictEqual(loaded.ids, ids)
    assert.deepStrictEqual(loaded.structure.tree, structure.tree)
    assert.deepStrictEqual(loaded.structure.items, structure.items)
    assert.strictEqual(loaded.unmatched, 0)
    assert.isFalse(loaded.rematched)
  })

  it("reads back where an item's ends connect, through the sidecar's file", () => {
    const { keys, map, sidecar } = authored()
    const Codec = Schema.fromJsonString(MapSidecar)
    const file = Schema.decodeSync(Codec)(Schema.encodeSync(Codec)(sidecar))
    assert.deepStrictEqual(file.items[keys.k3]?.connectAt, { "0": "bottomLeft" })
    assert.deepStrictEqual(loadStructure(map, HASH, file).structure.items.get(keys.k3), {
      connectAt: { "0": "bottomLeft" }
    })
  })

  // #81's done-when: hidden and locked pieces survive a reload, and the map the game gets is the same either way.
  it("reads back hidden and locked items through the file, and after the game rewrote others", () => {
    const { ids, keys, map, structure } = authored()
    const flagged = withFlag(withFlag(structure, [keys.k0, keys.k3], "hidden", true)!, [keys.k1], "locked", true)!
    const Codec = Schema.fromJsonString(MapSidecar)
    const file = Schema.decodeSync(Codec)(Schema.encodeSync(Codec)(sidecarOf(map, ids, flagged, HASH)))
    assert.deepStrictEqual(file.items[keys.k0], { index: 0, fingerprint: fingerprintOf(map.items[0]!), hidden: true })
    const reloaded = loadStructure(map, HASH, file).structure
    assert.deepStrictEqual(reloaded.items, flagged.items)

    const [first, second, third, fourth] = map.items
    const edited = mapOf([fourth!, first!, at(9000), second!, third!])
    const rematched = loadStructure(edited, OTHER_HASH, file).structure
    assert.deepStrictEqual(rematched.items.get(keys.k0), { hidden: true })
    assert.deepStrictEqual(rematched.items.get(keys.k1), { name: "Named", locked: true })
    assert.deepStrictEqual(rematched.items.get(keys.k3), { connectAt: { "0": "bottomLeft" }, hidden: true })
  })

  it("makes keys and a flat tree without a sidecar, with the file's groups", () => {
    const map = {
      ...mapOf([at(0), at(1), at(2)]),
      editorState: { ...defaultEditorState(), groups: [{ members: [1, 2], name: "fromgame" }] }
    }
    const loaded = loadStructure(map, HASH, null)
    assert.lengthOf(loaded.ids, 3)
    assert.strictEqual(new Set(loaded.ids).size, 3)
    assert.deepStrictEqual(loaded.structure.tree.map((node) => node.kind), ["item", "group"])
    assert.isFalse(loaded.rematched)
  })

  // docs/PROJECTS.md § Sync, #112's done-when: an in-game edit of unrelated pieces keeps every entry for unchanged pieces.
  it("keeps every entry of unchanged pieces when the game changes others, and flags the rest", () => {
    const { keys, map, sidecar } = authored()
    const [first, second, third, fourth, fifth] = map.items
    const edited = mapOf([fourth!, nudged(fifth!, 500), first!, at(9000), second!, third!])
    const loaded = loadStructure(edited, OTHER_HASH, sidecar)

    assert.isTrue(loaded.rematched)
    assert.strictEqual(loaded.ids[0], keys.k3)
    assert.strictEqual(loaded.ids[2], keys.k0)
    assert.strictEqual(loaded.ids[4], keys.k1)
    assert.strictEqual(loaded.ids[5], keys.k2)
    // the moved piece's entry matched nothing; the moved piece and the new one get fresh keys
    assert.strictEqual(loaded.unmatched, 1)
    assert.isFalse(loaded.ids.includes(keys.k4))
    assert.strictEqual(new Set(loaded.ids).size, edited.items.length)

    assert.deepStrictEqual(loaded.structure.items.get(keys.k1), { name: "Named" })
    assert.deepStrictEqual(loaded.structure.items.get(keys.k2), { tags: ["tagged"] })
    assert.deepStrictEqual(loaded.structure.items.get(keys.k3), { connectAt: { "0": "bottomLeft" } })
    const groups = loaded.structure.tree.flatMap((node) => node.kind === "group" ? [node] : [])
    assert.deepStrictEqual(groups.map((g) => [g.name, g.tags, treeKeys(g.children)]), [
      ["Inner", ["a tag"], [keys.k1, keys.k2]],
      ["Other", [], [keys.k3]]
    ])
    // every item is in exactly one place
    assert.sameMembers([...treeKeys(loaded.structure.tree)], [...loaded.ids])
  })

  it("matches the nearest transform within the tolerance when none is exact", () => {
    const { keys, map, sidecar } = authored()
    const edited = mapOf(map.items.map((item) => nudged(item, 0.3)))
    const loaded = loadStructure(edited, OTHER_HASH, sidecar)
    assert.deepStrictEqual(loaded.ids, Object.values(keys))
    assert.strictEqual(loaded.unmatched, 0)
    assert.isTrue(loaded.rematched)
  })

  it("keeps every item of a game save in the same order, however far it moved", () => {
    const { keys, map, sidecar, structure } = authored()
    const moved = mapOf(map.items.map((item, index) => index === 1 ? nudged(item, 5000) : item))
    const loaded = loadGameStructure(moved, OTHER_HASH, sidecar)
    assert.deepStrictEqual(loaded.ids, Object.values(keys))
    assert.strictEqual(loaded.unmatched, 0)
    assert.deepStrictEqual(loaded.structure.tree, structure.tree)
    assert.deepStrictEqual(loaded.structure.items.get(keys.k1), { name: "Named" })
  })

  it("re-matches a game save without the same items in the same order, as any rewritten file", () => {
    const { keys, map, sidecar } = authored()
    const [first, , , fourth, fifth] = map.items
    const loaded = loadGameStructure(mapOf([first!, fourth!, fifth!]), OTHER_HASH, sidecar)
    assert.strictEqual(loaded.unmatched, 2)
    assert.deepStrictEqual(loaded.ids, [keys.k0, keys.k3, keys.k4])
    const other: Item = { ...at(100), actorToSpawn: "/Script/Engine.Blueprint'/Game/BP_Other.BP_Other_C'" }
    const swapped = loadGameStructure(
      mapOf(map.items.map((item, index) => index === 1 ? other : item)),
      OTHER_HASH,
      sidecar
    )
    assert.strictEqual(swapped.unmatched, 1)
    assert.isNull(loadGameStructure(map, OTHER_HASH, null).structure.items.get("") ?? null)
  })

  it("doesn't shift identities when a save deleted one item and added another of its class", () => {
    const { keys, map, sidecar } = authored()
    const [first, , third, fourth, fifth] = map.items
    const loaded = loadGameStructure(mapOf([first!, third!, fourth!, fifth!, at(900)]), OTHER_HASH, sidecar)
    assert.deepStrictEqual(loaded.ids.slice(0, 4), [keys.k0, keys.k2, keys.k3, keys.k4])
    assert.notInclude(loaded.ids, keys.k1)
    assert.isUndefined(loaded.structure.items.get(loaded.ids[4]!))
    assert.deepStrictEqual(loaded.structure.items.get(keys.k2), { tags: ["tagged"] })
    assert.strictEqual(loaded.unmatched, 1)
  })

  it("keeps twins apart when a save moved one of them", () => {
    const map = mapOf([at(5), at(5)])
    const { ids, structure } = structureOfMap(map)
    const sidecar = sidecarOf(map, ids, structure, HASH)
    assert.deepStrictEqual(loadGameStructure(mapOf([at(5000), at(5)]), OTHER_HASH, sidecar).ids, ids)
  })

  it("gives each of two close entries its nearest item", () => {
    const map = mapOf([at(0), at(0.5)])
    const { ids, structure } = structureOfMap(map)
    const sidecar = sidecarOf(map, ids, structure, HASH)
    const loaded = loadStructure(mapOf([at(0.6), at(0.1)]), OTHER_HASH, sidecar)
    assert.deepStrictEqual(loaded.ids, ids.toReversed())
  })

  it("doesn't match past the tolerance, or across classes", () => {
    const { map, sidecar } = authored()
    const far = loadStructure(mapOf(map.items.map((item) => nudged(item, 2))), OTHER_HASH, sidecar)
    assert.strictEqual(far.unmatched, 5)
    assert.deepStrictEqual(far.structure.tree.map((node) => node.kind), Array(5).fill("item"))
    const scaled = (item: Item): Item => ({
      ...item,
      itemTransform: { ...item.itemTransform, scale3D: { x: 2, y: 2, z: 2 } }
    })
    assert.strictEqual(loadStructure(mapOf(map.items.map(scaled)), OTHER_HASH, sidecar).unmatched, 5)
    const otherClass = (item: Item): Item => ({
      ...item,
      actorToSpawn: "/Script/Engine.Blueprint'/Game/BP_Other.BP_Other_C'"
    })
    assert.strictEqual(loadStructure(mapOf(map.items.map(otherClass)), OTHER_HASH, sidecar).unmatched, 5)
  })

  it("hands out stacked items of one fingerprint in document order", () => {
    const map = mapOf([at(5), at(5), at(5)])
    const { ids, structure } = structureOfMap(map)
    const sidecar = sidecarOf(map, ids, structure, HASH)
    const loaded = loadStructure(mapOf([at(5), at(5)]), OTHER_HASH, sidecar)
    assert.deepStrictEqual(loaded.ids, ids.slice(0, 2))
    assert.strictEqual(loaded.unmatched, 1)
  })

  it("drops a group whose items all went", () => {
    const { keys, map, sidecar } = authored()
    const [first, , , fourth, fifth] = map.items
    const loaded = loadStructure(mapOf([first!, fourth!, fifth!]), OTHER_HASH, sidecar)
    assert.deepStrictEqual(
      loaded.structure.tree.map((node) => node.kind === "group" ? node.name : node.key),
      [keys.k0, "Other", keys.k4]
    )
    assert.strictEqual(loaded.unmatched, 2)
  })

  it("falls back on fingerprints when the hash matches but the indices can't be right", () => {
    const { ids, map, sidecar } = authored()
    const first = ids[0]!
    const broken: MapSidecar = {
      ...sidecar,
      items: { ...sidecar.items, [first]: { ...sidecar.items[first]!, index: 99 } }
    }
    const loaded = loadStructure(map, HASH, broken)
    assert.deepStrictEqual(loaded.ids, ids)
    assert.isTrue(loaded.rematched)
  })

  it("repairs a tree that holds an item twice, misses one, or names one it doesn't have", () => {
    const { ids, map, sidecar } = authored()
    const [k0 = "", k1 = ""] = ids
    const broken: MapSidecar = {
      ...sidecar,
      tree: [
        { kind: "item", key: k0 },
        { kind: "item", key: k0 },
        { kind: "item", key: "ghost" },
        { kind: "group", id: "same", name: "A", tags: [], children: [{ kind: "item", key: k1 }] },
        { kind: "group", id: "same", name: "B", tags: [], children: [{ kind: "item", key: ids[2]! }] }
      ]
    }
    const { structure } = loadStructure(map, HASH, broken)
    assert.sameMembers([...treeKeys(structure.tree)], [...ids])
    assert.lengthOf(treeKeys(structure.tree), ids.length)
    const groupIds = structure.tree.flatMap((node) => node.kind === "group" ? [node.id] : [])
    assert.strictEqual(new Set(groupIds).size, 2)
  })

  it.each(listSamples().map((sample) => [sample.name, sample] as const))(
    "finds every item of %s again from fingerprints alone",
    (_name, sample) => {
      const map = decodeMap(readSample(sample))
      const { ids, structure } = structureOfMap(map)
      const loaded = loadStructure(map, OTHER_HASH, sidecarOf(map, ids, structure, HASH))
      assert.deepStrictEqual(loaded.ids, ids)
      assert.strictEqual(loaded.unmatched, 0)
    }
  )
})

describe("snap data in the sidecar", () => {
  const joint = (a: string, b: string) => ({ a: { item: a, end: 0 }, b: { item: b, end: 1 } })
  const plane = {
    kind: "plane",
    id: "plane1",
    name: "Landing",
    origin: { x: 0, y: 0, z: 100 },
    normal: { x: 0, y: 0, z: 1 },
    xAxis: { x: 1, y: 0, z: 0 },
    extent: 500,
    grid: false
  } as const
  const measurement = { id: "measure1", a: { x: 0, y: 0, z: 0 }, b: { x: 100, y: 0, z: 0 } }

  it("keeps a map's annotations and snap settings beside its pivots and chains, through a save and a rewrite", () => {
    const { ids, keys, map, structure } = authored()
    const annotations = { joints: [joint(keys.k0, keys.k1)], construction: [plane], measurements: [measurement] }
    const snap = { ...defaultSnapConfig, magnet: true, gridSize: 37 }
    const group = structure.tree.find((node) => node.kind === "group")
    if (group?.kind !== "group") return assert.fail("the map has no group")
    const world = { x: 1, y: 2, z: 3 }
    const authoredTrees = [
      structure,
      withGroupPivot(structure, group.id, { choice: "point", world }),
      withChain(structure, group.id, true)
    ].flatMap((one) => one ?? [])
    assert.lengthOf(authoredTrees, 3)
    for (const authoredTree of authoredTrees) {
      const sidecar = sidecarOf(map, ids, withAnnotations(authoredTree, annotations), HASH, snap)
      for (const hash of [HASH, OTHER_HASH]) {
        const loaded = loadStructure(map, hash, sidecar)
        assert.deepStrictEqual(loaded.structure.tree, authoredTree.tree, hash)
        assert.deepStrictEqual(loaded.structure.annotations, annotations, hash)
        assert.deepStrictEqual(loaded.snap, snap, hash)
      }
    }
  })

  it("reads snap settings saved while the magnet gated all of snapping as they behaved", () => {
    const { ids, map, structure } = authored()
    const saved = Schema.encodeSync(MapSidecar)(sidecarOf(map, ids, structure, HASH, defaultSnapConfig))
    const { magnet: _, ...current } = defaultSnapConfig
    const gated = (enabled: boolean) => ({
      ...saved,
      snap: {
        ...current,
        enabled,
        gridSize: 37,
        targets: { ...current.targets, grid: { ...current.targets.grid, enabled: true } }
      }
    })
    const snapOf = (enabled: boolean) => loadStructure(map, HASH, Schema.decodeSync(MapSidecar)(gated(enabled))).snap
    assert.deepStrictEqual(snapOf(false), { ...defaultSnapConfig, gridSize: 37 }, "off snapped nothing, grid included")
    const on = snapOf(true) ?? assert.fail("no snap settings")
    assert.isTrue(on.magnet)
    assert.isTrue(on.targets.grid.enabled)
  })

  it("writes neither while the map has none of its own", () => {
    const { sidecar } = authored()
    assert.isFalse("annotations" in sidecar)
    assert.isFalse("snap" in sidecar)
  })

  it("drops a joint when one of its items can't be found, and keeps what belongs to the map", () => {
    const { ids, keys, map, structure } = authored()
    const annotations = {
      joints: [joint(keys.k0, keys.k1), joint(keys.k3, keys.k4)],
      construction: [plane],
      measurements: []
    }
    const sidecar = sidecarOf(map, ids, withAnnotations(structure, annotations), HASH)
    const loaded = loadStructure(mapOf(map.items.slice(0, 4).map((item) => item)), OTHER_HASH, sidecar)
    assert.deepStrictEqual(loaded.structure.annotations?.joints, [joint(keys.k0, keys.k1)])
    assert.deepStrictEqual(loaded.structure.annotations?.construction, [plane])
  })
})

describe("a version the game saved", () => {
  const catalog = indexCatalog(catalogWithEnds())
  const piece = catalog.pieceByClass.values().next().value
  if (piece === undefined) throw new Error("the bundled catalog has no pieces")
  const track = (x: number) => itemFromPiece(piece, identityTransform({ x, y: 0, z: 0 }))
  const ids = ["left", "right", "away"]
  const joined = [{ a: { item: "right", end: 1 }, b: { item: "left", end: 0 } }]
  const map = mapOf([track(0), track(500), track(5000)])
  const tree = [
    { kind: "group", id: "g", name: "Group", tags: [], children: [itemNode("right"), itemNode("away")], chain: true },
    itemNode("left")
  ] as const
  const snap = { ...defaultSnapConfig, gridSize: 37 }
  const sidecar = sidecarOf(
    map,
    ids,
    withAnnotations({ tree, items: new Map() }, { joints: joined, construction: [], measurements: [] }),
    HASH,
    snap
  )

  it("keeps joints that still meet, its chains and its snap settings when the game moved something else", () => {
    const loaded = loadGameStructure(mapOf([track(0), track(500), track(7000)]), OTHER_HASH, sidecar, catalog)
    assert.deepStrictEqual(loaded.ids, ids)
    assert.deepStrictEqual(loaded.structure.tree, tree)
    assert.deepStrictEqual(loaded.structure.annotations?.joints, joined)
    assert.deepStrictEqual(loaded.snap, snap)
    assert.isTrue(loaded.rematched)
  })

  const pulledApart = mapOf([track(0), track(800), track(5000)])

  it("drops a joint whose item the game moved off the other end, and keeps the item's key", () => {
    const loaded = loadGameStructure(pulledApart, OTHER_HASH, sidecar, catalog)
    assert.deepStrictEqual(loaded.ids, ids)
    assert.isUndefined(loaded.structure.annotations)
    assert.deepStrictEqual(loaded.snap, snap)
  })

  it("keeps a joint it can't read the ends of, before the catalog has loaded", () => {
    assert.deepStrictEqual(loadGameStructure(pulledApart, OTHER_HASH, sidecar).structure.annotations?.joints, joined)
  })
})

describe("editor data across a round trip through the game", () => {
  /** `authored`, with k2 hidden, k3 locked and a Point pivot on g1. */
  const flagged = () => {
    const base = authored()
    let structure = withFlag(base.structure, [base.keys.k2], "hidden", true)!
    structure = withFlag(structure, [base.keys.k3], "locked", true)!
    structure = withGroupPivot(structure, "g1", { choice: "point", world: { x: 150, y: 50, z: 0 } })!
    return { ...base, structure, sidecar: sidecarOf(base.map, base.ids, structure, HASH) }
  }
  const groupOf = (structure: Structure, id: string): GroupNode => {
    const group = structure.tree.find((node) => node.kind === "group" && node.id === id)
    if (group?.kind !== "group") throw new Error(`no group ${id} at the root`)
    return group
  }
  /** A root node as the game's groups give it: a group's name and children, or an item. */
  const madeOf = (node: TreeNode | undefined) =>
    node?.kind === "group" ? { name: node.name, children: node.children } : node
  const withGroups = (map: MapFile, groups: ReadonlyArray<{ members: Array<number>; name: string }>): MapFile => ({
    ...map,
    editorState: { ...defaultEditorState(), groups: groups.map((group) => ({ ...group, frame: identityTransform() })) }
  })

  it("keeps a moved item's name, group, flags and pivot when the game also added one", () => {
    const { keys, map, sidecar, structure } = flagged()
    const items = map.items.map((item, index) => index === 1 || index === 2 || index === 3 ? nudged(item, 5000) : item)
    const loaded = loadGameStructure(mapOf([...items, at(900)]), OTHER_HASH, sidecar)
    assert.deepStrictEqual(loaded.ids.slice(0, 5), Object.values(keys))
    assert.strictEqual(loaded.unmatched, 0)
    assert.deepStrictEqual(loaded.structure.items.get(keys.k1), { name: "Named" })
    assert.deepStrictEqual(loaded.structure.items.get(keys.k2), { tags: ["tagged"], hidden: true })
    assert.deepStrictEqual(loaded.structure.items.get(keys.k3), { connectAt: { 0: "bottomLeft" }, locked: true })
    assert.deepStrictEqual(loaded.structure.tree.slice(0, 4), [
      structure.tree[0],
      { ...groupOf(structure, "g1"), pivot: { choice: "point", world: { x: 5150, y: 50, z: 0 } } },
      groupOf(structure, "g2"),
      structure.tree[3]
    ])
    assert.deepStrictEqual(loaded.structure.tree[4], itemNode(loaded.ids[5]!))
  })

  it("keeps the others' data when the game deleted one and moved another", () => {
    const { keys, map, sidecar } = flagged()
    const [, second, third, fourth, fifth] = map.items
    const loaded = loadGameStructure(mapOf([second!, nudged(third!, 3000), fourth!, fifth!]), OTHER_HASH, sidecar)
    assert.deepStrictEqual(loaded.ids, [keys.k1, keys.k2, keys.k3, keys.k4])
    assert.strictEqual(loaded.unmatched, 1)
    assert.deepStrictEqual(loaded.structure.items.get(keys.k2), { tags: ["tagged"], hidden: true })
  })

  it("matches by order only between the items it is sure of, and only within a class", () => {
    const { keys, map, sidecar } = authored()
    const other: Item = { ...at(100), actorToSpawn: "/Script/Engine.Blueprint'/Game/BP_Other.BP_Other_C'" }
    const [first, second, third, fourth, fifth] = map.items
    // the second item moved, one of another class came in before it, and one of its class at the end
    const loaded = loadGameStructure(
      mapOf([first!, other, nudged(second!, 2000), third!, fourth!, fifth!, at(7000)]),
      OTHER_HASH,
      sidecar
    )
    assert.deepStrictEqual(loaded.ids.slice(0, 6).filter((_, index) => index !== 1), Object.values(keys))
    assert.notInclude(Object.values(keys), loaded.ids[1])
    assert.notInclude(Object.values(keys), loaded.ids[6])
  })

  it("merges in the groups made in the game, and keeps those it exported", () => {
    const { keys, map, sidecar, structure } = flagged()
    const loaded = loadGameStructure(
      withGroups(mapOf(map.items.map((item, index) => index === 4 ? nudged(item, 10) : item)), [
        { members: [1, 2], name: "Inner" },
        { members: [0, 4], name: "Ends" }
      ]),
      OTHER_HASH,
      sidecar
    )
    const [ends, ...rest] = loaded.structure.tree
    assert.deepStrictEqual(madeOf(ends), { name: "Ends", children: [itemNode(keys.k0), itemNode(keys.k4)] })
    assert.deepStrictEqual(rest, [groupOf(structure, "g1"), groupOf(structure, "g2")])
  })

  it("wraps whole groups a game group took in, and takes out the items it took from a group", () => {
    const { keys, map, sidecar, structure } = flagged()
    const loaded = loadGameStructure(
      withGroups(map, [{ members: [0, 1], name: "" }, { members: [3, 4], name: "Tail" }]),
      OTHER_HASH,
      sidecar
    )
    assert.deepStrictEqual(loaded.ids, Object.values(keys))
    const [taken, g1, tail] = loaded.structure.tree
    assert.deepStrictEqual(madeOf(taken), { name: "Group", children: [itemNode(keys.k0), itemNode(keys.k1)] })
    assert.deepStrictEqual(g1, { ...groupOf(structure, "g1"), children: [itemNode(keys.k2)] })
    assert.deepStrictEqual(madeOf(tail), { name: "Tail", children: [groupOf(structure, "g2"), itemNode(keys.k4)] })
    assert.lengthOf(loaded.structure.tree, 3)
  })

  it("carries a group's Point pivot and turn by the turn and move its items made in the game, and only then", () => {
    const { map, sidecar } = flagged()
    // a quarter turn about z, about (100, 0, 0), then 1000 along y: (x, y) goes to (100 - y, x - 100 + 1000)
    const quarter = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
    const turned = (item: Item): Item => {
      const { x, y, z } = item.itemTransform.translation
      return {
        ...item,
        itemTransform: { ...item.itemTransform, rotation: quarter, translation: { x: 100 - y, y: x - 100 + 1000, z } }
      }
    }
    const g1Of = (items: ReadonlyArray<Item>) =>
      groupOf(loadGameStructure(mapOf(items), OTHER_HASH, sidecar).structure, "g1")
    const pivotOf = (items: ReadonlyArray<Item>) => g1Of(items).pivot
    const g1 = g1Of(map.items.map((item, index) => index === 1 || index === 2 ? turned(item) : item))
    const point = g1.pivot
    assert.strictEqual(point?.choice, "point")
    if (point?.choice === "point") {
      assert.closeTo(point.world.x, 50, 1e-6)
      assert.closeTo(point.world.y, 1050, 1e-6)
      assert.strictEqual(point.world.z, 0)
    }
    assert.closeTo(g1.rotation?.z ?? 0, Math.SQRT1_2, 1e-9)
    assert.closeTo(g1.rotation?.w ?? 0, Math.SQRT1_2, 1e-9)
    // moved without a turn: the point goes along, and the group keeps the world's axes
    const shifted = g1Of(map.items.map((item, index) => index === 1 || index === 2 ? nudged(item, 500) : item))
    assert.deepStrictEqual(shifted.pivot, { choice: "point", world: { x: 650, y: 50, z: 0 } })
    assert.isUndefined(shifted.rotation)
    // one member moved on its own: the point stays where it was frozen
    assert.deepStrictEqual(pivotOf(map.items.map((item, index) => index === 1 ? nudged(item, 500) : item)), {
      choice: "point",
      world: { x: 150, y: 50, z: 0 }
    })
  })
})
