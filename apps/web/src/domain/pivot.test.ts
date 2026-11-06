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
  const catalog = Schema.decodeSync(Schema.fromJsonString(Catalog))(fs.readFileSync(catalogPath, "utf8"))
  const index = indexCatalog(catalog)
  const decode = Schema.decodeSync(Schema.fromJsonString(MapFile))

  const measured = (className: string, choice: PivotChoice) => {
    const piece = catalog.pieces.find((p) => p.className === className)!
    const item = { ...playerStartItem(), actorToSpawn: piece.classPath, meshComponents: [] }
    return pivotFor(item, index, choice)?.localPosition
  }

  // The game's box for this bevel through `piece_measure`, with its origin at 0: x -909.81 to 863.81 unflipped.
  it("flips the bounds with the mesh, as the game does", () => {
    const piece = catalog.pieces.find((p) => p.className === "Bevel_Full_ShortUScoop_R")!
    const flipped = (...names: ReadonlyArray<string>) =>
      pivotBoundsOf({
        ...playerStartItem(),
        actorToSpawn: piece.classPath,
        meshComponents: [],
        boolProperties: names.map((propertyName) => ({ propertyName, propertyType: "bool", currentValue: true }))
      }, index)
    const along = (bounds: ReturnType<typeof flipped>) => [
      Math.round(bounds!.min[0]),
      Math.round(bounds!.max[0]),
      Math.round(bounds!.min[1]),
      Math.round(bounds!.max[1])
    ]
    assert.deepStrictEqual(along(flipped()), [-910, 864, -1122, 594])
    assert.deepStrictEqual(along(flipped("bMirror")), [-910, 864, -594, 1122])
    assert.deepStrictEqual(along(flipped("bMirrorX")), [-864, 910, -1122, 594])
    assert.deepStrictEqual(along(flipped("bMirror", "bMirrorX")), [-864, 910, -594, 1122])
  })

  // The game's own answers, read from its gizmo through each pivot button on 0.4.1.
  it("matches the game on the pieces the Main mesh doesn't describe", () => {
    const cases: ReadonlyArray<readonly [string, PivotChoice, readonly [number, number, number]]> = [
      ["MP_AirVent", "Center", [0, 0, 186.1875]],
      ["MP_AirVent", "Right", [0, 85.265, 186.1875]],
      ["MP_ActualCheckpoint_Disc", "Top", [0, 0, 286.3]],
      ["MP_ActualCheckpoint_Disc", "Back", [145, 0, 135.62]],
      ["MP_ActualCheckpoint_Strip", "Center", [0, 0, 87.89]],
      ["MP_ActualCheckpoint_Strip", "Right", [0, 253.5, 87.89]],
      ["BP_UGCCircuitDecal", "Back", [0.5, 0, 0]],
      ["BP_UGCCircuitDecal", "Top", [0, 0, 0.5]],
      ["BP_UGCShapeDecal", "Right", [0, 0.5, 0]],
      ["MP_LaserTerminal", "Center", [54.1729, 0, 0]],
      ["BP_Elevator", "Center", [0, 0, -0.0157]],
      ["BP_Elevator", "Top", [0, 0, 8.9602]]
    ]
    for (const [className, choice, [x, y, z]] of cases) {
      expectVec(measured(className, choice)!, { x, y, z }, 1)
    }
  })

  it("keeps every pivot of a raw light on its origin", () => {
    for (const className of ["MP_RawPointLight", "MP_RawSpotLight", "MP_RawRectLight"]) {
      for (const choice of PIVOT_CHOICES) expectVec(measured(className, choice)!, { x: 0, y: 0, z: 0 })
    }
  })

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
