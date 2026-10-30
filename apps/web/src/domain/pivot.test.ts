import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { listSamples, readSample, repoRoot } from "../test/samples"
import { expectVec } from "../test/vec"
import { Catalog, indexCatalog } from "./Catalog"
import { addItem, copyItems, pasteItems, setPivots } from "./edits"
import { identityTransform, newMapFile, playerStartItem } from "./factory"
import { MapFile } from "./MapFile"
import {
  DEFAULT_PIVOT,
  localToWorld,
  PIVOT_CHOICES,
  pivotAt,
  pivotBoundsOf,
  type PivotChoice,
  pivotFor,
  pivotPointOnBounds
} from "./pivot"

const isChoice = (c: string): c is PivotChoice => (PIVOT_CHOICES as ReadonlyArray<string>).includes(c)

describe("pivot points", () => {
  const bounds = { min: [-250, -100, 0], max: [250, 300, 100] } as const

  it("puts each choice at the centre of the bounds or of one face", () => {
    const points = Object.fromEntries(PIVOT_CHOICES.map((c) => [c, pivotPointOnBounds(bounds, c)]))
    assert.deepStrictEqual(points, {
      Default: { x: 0, y: 0, z: 0 },
      Center: { x: 0, y: 100, z: 50 },
      Bottom: { x: 0, y: 100, z: 0 },
      Top: { x: 0, y: 100, z: 100 },
      Left: { x: 0, y: -100, z: 50 },
      Right: { x: 0, y: 300, z: 50 },
      Back: { x: 250, y: 100, z: 50 },
      Front: { x: -250, y: 100, z: 50 }
    })
  })

  it("maps a local point through scale, rotation and translation", () => {
    const yaw90 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } // game X turns to game Y
    const t = { translation: { x: 10, y: 20, z: 30 }, rotation: yaw90, scale3D: { x: 2, y: 1, z: 3 } }
    expectVec(localToWorld(t, { x: 5, y: 0, z: 1 }), { x: 10, y: 30, z: 33 })
  })
})

describe("setPivots", () => {
  const base = () => {
    let map = newMapFile({ displayName: "A", creatorName: "B", createdAt: "" })
    for (let i = 1; i < 4; i++) {
      map = addItem(map, { ...playerStartItem(), itemTransform: identityTransform({ x: i, y: 0, z: 0 }) })
    }
    return map
  }
  const top = { choice: "Top", localPosition: { x: 0, y: 0, z: 100 } }

  it("sets, replaces and keeps entries sorted by item index", () => {
    let map = setPivots(base(), [[3, top], [1, top]])
    assert.deepStrictEqual(map.editorState!.pivots.map((p) => p.itemIndex), [1, 3])
    map = setPivots(map, [[2, top], [3, { choice: "Bottom", localPosition: { x: 0, y: 0, z: 0 } }]])
    assert.deepStrictEqual(map.editorState!.pivots.map((p) => [p.itemIndex, p.pivot.choice]), [
      [1, "Top"],
      [2, "Top"],
      [3, "Bottom"]
    ])
    assert.deepStrictEqual(pivotAt(map, 2), top)
  })

  it("drops the entry for Default, and skips indices outside the map", () => {
    const map = setPivots(setPivots(base(), [[1, top], [2, top]]), [[1, DEFAULT_PIVOT], [9, top]])
    assert.deepStrictEqual(map.editorState!.pivots.map((p) => p.itemIndex), [2])
    assert.deepStrictEqual(pivotAt(map, 1), DEFAULT_PIVOT)
    assert.deepStrictEqual(pivotAt(map, 0), DEFAULT_PIVOT)
  })

  it("pastes pivots sorted by item index, whatever order they were copied in", () => {
    const map = setPivots(base(), [[1, top], [3, { ...top, choice: "Bottom" }]])
    const pasted = pasteItems(map, copyItems(map, [3, 1]))
    const n = map.items.length
    assert.deepStrictEqual(pasted.editorState!.pivots.map((p) => [p.itemIndex, p.pivot.choice]), [
      [1, "Top"],
      [3, "Bottom"],
      [n, "Bottom"],
      [n + 1, "Top"]
    ])
  })

  it("adds editorState to a map that has none (an imported .ballmap)", () => {
    const { editorState: _, ...ballmap } = base()
    const map = setPivots(ballmap, [[1, top]])
    assert.deepStrictEqual(map.editorState?.pivots, [{ itemIndex: 1, pivot: top }])
    assert.strictEqual(map.editorState?.version, 1)
    // and the result is a valid map file
    Schema.decodeSync(MapFile)(map)
  })
})

const catalogPath = path.join(repoRoot, "assets", "catalog.json")

describe.skipIf(!fs.existsSync(catalogPath))("pivots in samples/", () => {
  const index = indexCatalog(Schema.decodeSync(Schema.fromJsonString(Catalog))(fs.readFileSync(catalogPath, "utf8")))
  const decode = Schema.decodeSync(Schema.fromJsonString(MapFile))

  it("match the choice's point on the piece's bounds, as the game computes it", () => {
    let checked = 0
    for (const sample of listSamples()) {
      const map = decode(readSample(sample))
      for (const { itemIndex, pivot } of map.editorState?.pivots ?? []) {
        const item = map.items[itemIndex]!
        assert.isTrue(isChoice(pivot.choice), pivot.choice)
        if (!isChoice(pivot.choice) || pivotBoundsOf(item, index) === undefined) continue
        expectVec(pivotFor(item, index, pivot.choice)!.localPosition, pivot.localPosition, 3)
        checked++
      }
    }
    assert.isAbove(checked, 40)
  })
})
