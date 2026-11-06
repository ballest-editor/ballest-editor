import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { hasCatalog, listSamples, readCatalog, readSample } from "../test/samples"
import { expectVec } from "../test/vec"
import { indexCatalog } from "./Catalog"
import { defaultEditorState, identityTransform, newMapFile, playerStartItem } from "./factory"
import { gameGroupNameOf, structureFromGame, withGameGroups } from "./gameGroups"
import { gameLoadProblems } from "./limits"
import { type Item, ItemTransform, MapFile } from "./MapFile"
import type { GroupNode, TreeNode } from "./MapSidecar"
import { structureOfMap } from "./sidecar"
import { flatStructure, freshKeys, treeKeys, withGroup } from "./structure"
import { rotatorToQuat } from "./ueMath"

const decodeMap = Schema.decodeUnknownSync(Schema.fromJsonString(MapFile))
const decodeFrame = Schema.decodeUnknownSync(ItemTransform)

/** The groups `withGameGroups` gives `map`. */
const gameGroupsOf = (...args: Parameters<typeof withGameGroups>) => withGameGroups(...args).editorState?.groups ?? []

const item = (key: string): TreeNode => ({ kind: "item", key })
const group = (name: string, ...children: ReadonlyArray<TreeNode>): GroupNode => ({
  kind: "group",
  id: `id${name.replace(/\W/g, "")}`,
  name,
  tags: [],
  children
})

const start = playerStartItem()
const at = (x: number, y = 0, z = 0): Item => ({ ...start, itemTransform: identityTransform({ x, y, z }) })
/** A map of a player start and an item at each x. */
const mapWith = (...xs: ReadonlyArray<number>): MapFile => {
  const map = newMapFile({ displayName: "Test", creatorName: "me", createdAt: "" })
  return { ...map, items: [start, ...xs.map((x) => at(x))] }
}

/** Every item index is in at most one group, and each group passes the game's rules. */
const assertValid = (map: MapFile) => {
  assert.deepStrictEqual(gameLoadProblems(map).filter((p) => /[Gg]roup/.test(p)), [])
  const members = map.editorState?.groups.flatMap((g) => g.members) ?? []
  assert.strictEqual(new Set(members).size, members.length)
}

describe("gameGroupNameOf", () => {
  it("keeps letters and digits, at most 64", () => {
    assert.strictEqual(gameGroupNameOf("Group 1"), "Group1")
    assert.strictEqual(gameGroupNameOf("Rampe à droite!"), "Rampedroite")
    assert.strictEqual(gameGroupNameOf("---"), "")
    assert.strictEqual(gameGroupNameOf("a".repeat(70)), "a".repeat(64))
  })
})

// The frames `GroupSelection` made (docs/qa/groups-prefabs.md § The frame the game makes).
describe.skipIf(!hasCatalog)("a group's frame against the game", () => {
  const parsed = readCatalog()
  const catalog = indexCatalog(parsed)
  const piece = (
    className: string,
    translation: { readonly x: number; readonly y: number; readonly z: number },
    yaw = 0,
    [x, y, z]: readonly [number, number, number] = [1, 1, 1]
  ): Item => ({
    ...start,
    actorToSpawn: parsed.pieces.find((p) => p.className === className)!.classPath,
    meshComponents: [],
    itemTransform: {
      rotation: { ...rotatorToQuat({ pitch: 0, yaw, roll: 0 }) },
      translation,
      scale3D: { x, y, z }
    }
  })
  const frameOf = (...items: ReadonlyArray<Item>) => {
    const keys = items.map((_, n) => `k${n}`)
    const map = { ...mapWith(), items }
    return decodeFrame(gameGroupsOf(map, keys, [group("G", ...keys.map(item))], catalog)[0]?.frame)
  }
  const cubes = [{ x: 0, y: 0, z: 5000 }, { x: 1000, y: 0, z: 5000 }, { x: 200, y: 900, z: 5600 }]

  it("centres three cubes on their bounds, not on their origins", () => {
    const frame = frameOf(...cubes.map((origin) => piece("BP_Prim_Cube", origin)))
    assert.deepStrictEqual(frame, identityTransform({ x: 500, y: 450, z: 5800 }))
  })

  it("counts the corners of turned and scaled cubes", () => {
    const frame = frameOf(
      piece("BP_Prim_Cube", cubes[0]!, 30, [2, 2, 2]),
      piece("BP_Prim_Cube", cubes[1]!, 60),
      piece("BP_Prim_Cube", cubes[2]!, 0, [1, 3, 1])
    )
    expectVec(frame.translation, { x: 158.494, y: 516.987, z: 6000 }, 3)
  })

  it("takes a piece with no Main mesh by its visible components", () => {
    const frame = frameOf(
      piece("BP_Prim_Cube", { x: 100, y: 200, z: 5000 }, 30, [2, 1, 1]),
      piece("MP_AirVent", { x: 3100, y: 200, z: 5100 }),
      piece("BP_Ramp_Curve_Short1", { x: 1100, y: 2200, z: 6000 }, -90)
    )
    expectVec(frame.translation, { x: 1092.612, y: 864.873, z: 5572.327 }, 3)
  })

  it("falls back to a piece's translation when the catalog doesn't know it", () => {
    const lost = { ...piece("BP_Prim_Cube", { x: 40, y: 0, z: 0 }), actorToSpawn: "/Game/Test/Gone.Gone_C" }
    assert.deepStrictEqual(frameOf(lost).translation, { x: 40, y: 0, z: 0 })
  })
})

describe("withGameGroups' groups", () => {
  const ids = ["k0", "k1", "k2", "k3", "k4"]
  const map = mapWith(10, 20, 30, 50)

  it("makes one group per outermost tree group, with every item under it", () => {
    const tree = [
      item("k0"),
      group("Outer one", group("Inner", item("k3"), group("Deep", item("k1"))), item("k2")),
      item("k4")
    ]
    const groups = gameGroupsOf(map, ids, tree, null)
    assert.deepStrictEqual(groups, [{
      members: [1, 2, 3],
      name: "Outerone",
      frame: identityTransform({ x: 20, y: 0, z: 0 })
    }])
    assertValid(withGameGroups(map, ids, tree, null))
  })

  it("takes the frame's translation at the centre of the members' box", () => {
    const spread = { ...map, items: [start, at(10, 100, -4), at(30, 0, 8)] }
    assert.deepStrictEqual(
      gameGroupsOf(spread, ["k0", "k1", "k2"], [group("G", item("k1"), item("k2"))], null)[0]?.frame,
      identityTransform({ x: 20, y: 50, z: 2 })
    )
  })

  it("leaves out a group with no item anywhere under it", () => {
    const tree = [group("Empty"), group("Nested empty", group("Inner")), group("Full", item("k1"))]
    assert.deepStrictEqual(gameGroupsOf(map, ids, tree, null).map((g) => g.name), ["Full"])
    assertValid(withGameGroups(map, ids, tree, null))
  })

  it("gives a name with no letters or digits an empty one", () => {
    assert.deepStrictEqual(gameGroupsOf(map, ids, [group("!!!", item("k1"))], null).map((g) => g.name), [""])
  })

  it("keeps a map with no groups as it is, and adds an editorState only for groups", () => {
    const flat = flatStructure(ids).tree
    assert.strictEqual(withGameGroups(map, ids, flat, null), map)
    const { editorState: _none, ...bare } = map
    assert.isUndefined(withGameGroups(bare, ids, flat, null).editorState)
    assert.isDefined(withGameGroups(bare, ids, [group("G", item("k1"))], null).editorState)
    const old = { ...map, editorState: { ...defaultEditorState(), groups: [{ members: [1] }] } }
    assert.deepStrictEqual(withGameGroups(old, ids, flat, null).editorState?.groups, [])
  })

  // Every shape of nesting, from a fixed seed: what comes out is always a list the game loads.
  it("always projects nested trees to groups the game loads", () => {
    let seed = 42
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    const count = 40
    const keys = freshKeys(count)
    const big = mapWith(...keys.slice(1).map((_, i) => i * 7))
    for (let round = 0; round < 200; round++) {
      let n = 0
      const nodes = (depth: number): ReadonlyArray<TreeNode> =>
        Array.from({ length: 1 + next(4) }, (): ReadonlyArray<TreeNode> => {
          if (depth < 6 && next(3) === 0) return [group(`g${round}x${next(10000)}`, ...nodes(depth + 1))]
          return n < count ? [item(keys[n++]!)] : []
        }).flat()
      const tree = nodes(0)
      const rest = keys.slice(n).map(item)
      const projected = withGameGroups(big, keys, [...tree, ...rest], null)
      assertValid(projected)
      const under = tree.flatMap((node) => node.kind === "group" ? treeKeys(node.children) : [])
      assert.strictEqual(projected.editorState?.groups.flatMap((g) => g.members).length ?? 0, under.length)
    }
  })

  it.each(listSamples().map((sample) => [sample.name, sample] as const))(
    "projects groups made in %s to a valid list",
    (_name, sample) => {
      const sampleMap = decodeMap(readSample(sample))
      const { ids: keys, structure } = structureOfMap(sampleMap)
      // nested halves, with a tail left loose
      const half = Math.floor(keys.length / 2)
      const inner = withGroup(structure, keys.slice(0, half), "inner", "Inner half")
      const outer = inner === undefined ? structure : withGroup(inner, keys.slice(half, half + 1), "outer") ?? inner
      const projected = withGameGroups(sampleMap, keys, outer.tree, null)
      assertValid(projected)
      const members = projected.editorState?.groups.flatMap((g) => g.members) ?? []
      assert.isAtMost(members.length, sampleMap.items.length)
      assert.isAtLeast(projected.editorState?.groups.length ?? 0, 1)
    }
  )
})

describe("structureFromGame", () => {
  const ids = ["k0", "k1", "k2", "k3", "k4"]
  const withGroups = (groups: ReadonlyArray<{ members: ReadonlyArray<number>; name?: string }>): MapFile => ({
    ...mapWith(10, 20, 30, 40),
    editorState: { ...defaultEditorState(), groups }
  })
  const shape = (tree: ReadonlyArray<TreeNode>): ReadonlyArray<unknown> =>
    tree.map((node) => node.kind === "item" ? node.key : [node.name, shape(node.children)])

  it("makes a tree group of each game group, where its first member is", () => {
    const map = withGroups([{ members: [3, 1], name: "first" }, { members: [4] }])
    assert.deepStrictEqual(shape(structureFromGame(map, ids).tree), [
      "k0",
      ["first", ["k3", "k1"]],
      "k2",
      ["Group", ["k4"]]
    ])
  })

  it("is flat for a map with no groups", () => {
    assert.deepStrictEqual(shape(structureFromGame(mapWith(1), ["k0", "k1"]).tree), ["k0", "k1"])
    const { editorState: _none, ...bare } = mapWith(1)
    assert.deepStrictEqual(shape(structureFromGame(bare, ["k0", "k1"]).tree), ["k0", "k1"])
  })

  it("keeps every item in one place when the file breaks the game's rules", () => {
    const map = withGroups([{ members: [1, 1, 2, 99] }, { members: [2, 3] }, { members: [99] }])
    const { tree } = structureFromGame(map, ids)
    assert.deepStrictEqual(shape(tree), ["k0", ["Group", ["k1", "k2"]], ["Group", ["k3"]], "k4"])
    assert.sameMembers([...treeKeys(tree)], ids)
  })

  it("comes back the same through the projection", () => {
    const map = withGroups([{ members: [1, 2], name: "one" }, { members: [4], name: "two" }])
    const projected = gameGroupsOf(map, ids, structureFromGame(map, ids).tree, null)
    assert.deepStrictEqual(projected.map((g) => [g.members, g.name]), [[[1, 2], "one"], [[4], "two"]])
  })
})
