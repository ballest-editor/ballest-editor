import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import type { MeshFace } from "../../domain/meshElements"
import { defaultSnapConfig } from "../../domain/snapConfig"
import { ORIGIN } from "../../domain/ueMath"
import { boxAt, cubeAt, loadPieces, meshOfBox } from "../../test/snapFixtures"
import { sceneRegistry } from "../sceneRegistry"
import { useEditor } from "../store"
import { snapItemsOf } from "./snapScene"
import { toThree } from "./snapView"
import { flushPairsOf, scaleStopsOf } from "./turnScale"

const at = { x: 100, y: 0, z: 0 }
const alongX = { x: 1, y: 0, z: 0 }
const selection = { base: { x: 1, y: 0, z: 0 }, box: boxAt(ORIGIN), ends: [], pivotPoint: ORIGIN }

const stopsAlongX = (...items: Parameters<typeof scaleStopsOf>[3]) =>
  scaleStopsOf(alongX, ORIGIN, selection.box, items).map((stop) => stop.at).toSorted((a, b) => a - b)

describe("what a turn and a scale stop on", () => {
  it("turns flush with a mesh's own faces, its box standing in until it has loaded", () => {
    const pairsOf = (mesh: ReturnType<typeof meshOfBox> | undefined) =>
      flushPairsOf(defaultSnapConfig, selection, [cubeAt("a", at, { mesh: () => mesh })], 10)
    const curved = { ...meshOfBox(boxAt(at)), faces: meshOfBox(boxAt(at)).faces.slice(0, 2) }
    assert.lengthOf(pairsOf(curved), 2)
    assert.lengthOf(pairsOf(undefined), 6)
  })

  it("scales up to a mesh's own faces, its box standing in until it has loaded", () => {
    const stopsOf = (faces: ReadonlyArray<MeshFace> | undefined) => stopsAlongX(cubeAt("a", at, { faces: () => faces }))
    assert.deepStrictEqual(stopsOf(meshOfBox(boxAt(at, 20)).faces), [80, 120])
    assert.deepStrictEqual(stopsOf([]), [])
    assert.deepStrictEqual(stopsOf(undefined), [50, 150])
  })

  it("only places what stands in the way of the scaled face", () => {
    const faces = () => assert.fail("a scale doesn't place a mesh it can't reach")
    const aside = cubeAt("a", { x: 100, y: 1000, z: 0 }, { faces })
    const above = cubeAt("b", { x: 100, y: 0, z: 1000 }, { faces })
    assert.deepStrictEqual(stopsAlongX(aside, above, cubeAt("c", at)), [50, 150])
  })

  it("reaches what the face meets off to one side of the pivot, and what's behind it", () => {
    assert.deepStrictEqual(stopsAlongX(cubeAt("a", { x: 100, y: 80, z: 0 })), [50, 150])
    assert.deepStrictEqual(stopsAlongX(cubeAt("a", { x: -100, y: 0, z: 0 })), [-150, -50])
  })

  it("pairs the selection's base face with each target face as flush, and its end with each end as a join", () => {
    const end = { ref: { item: "a", end: 0 }, position: at, forward: alongX, up: { x: 0, y: 0, z: 1 }, profile: "T" }
    const own = { ...end, ref: { item: "own", end: 0 }, position: { x: 50, y: 0, z: 0 } }
    const pairs = flushPairsOf(defaultSnapConfig, { ...selection, ends: [own] }, [
      cubeAt("a", at, { ends: [end] })
    ], 100)
    const [join, face] = pairs
    assert.strictEqual(join?.relation, "join")
    assert.deepStrictEqual(join?.source, [{ kind: "ring", role: "source", at: own.position }])
    assert.strictEqual(face?.relation, "flush")
    // the selection's face the pivot is on, out of +X
    assert.isTrue(face?.source[0]?.kind === "face" && face.source[0].corners.every(({ x }) => x === 50))
  })

  it("draws a scale stop's target face, the scaled face on it, and the flush glyph", () => {
    const stops = scaleStopsOf(alongX, ORIGIN, selection.box, [cubeAt("a", { x: 200, y: 0, z: 0 })])
    const near = stops.find((stop) => stop.at === 150)
    assert.strictEqual(near?.relation, "flush")
    const [target, scaled, glyph] = near?.marks ?? []
    assert.isTrue(target?.kind === "face" && target.role === "target")
    assert.isTrue(scaled?.kind === "face" && scaled.role === "source" && scaled.corners.every(({ x }) => x === 150))
    assert.deepInclude(glyph, { kind: "glyph", relation: "flush" })
  })

  it("reads a loaded item's faces from the scene, where it stands", () => {
    const [own = "", other = ""] = loadPieces([ORIGIN, { x: 1000, y: 0, z: 0 }])
    const [item] = snapItemsOf(useEditor.getState(), new Set([own]), 30)
    assert.isUndefined(item?.faces())
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100))
    mesh.position.copy(toThree({ x: 1000, y: 0, z: 0 }))
    mesh.updateMatrixWorld(true)
    sceneRegistry.objects.set(other, mesh)
    const [loaded] = snapItemsOf(useEditor.getState(), new Set([own]), 30)
    const centres = (loaded?.faces() ?? []).map(({ centre }) => centre.x).toSorted((a, b) => a - b)
    sceneRegistry.objects.delete(other)
    assert.lengthOf(centres, 6)
    assert.closeTo(centres[0] ?? 0, 950, 1e-3)
    assert.closeTo(centres[5] ?? 0, 1050, 1e-3)
  })
})
