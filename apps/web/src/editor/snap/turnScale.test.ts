import { assert, describe, it } from "@effect/vitest"
import * as THREE from "three"
import type { Vec3 } from "../../domain/coords"
import { identityTransform } from "../../domain/factory"
import type { MeshFace } from "../../domain/meshElements"
import type { SnapItem } from "../../domain/snapFrame"
import { cornersOf } from "../../domain/snapRelation"
import { ORIGIN, rotatorToQuat } from "../../domain/ueMath"
import { allSnapping, boxAt, cubeAt, endAlongX, loadPieces, meshOfBox } from "../../test/snapFixtures"
import { sceneRegistry } from "../sceneRegistry"
import { useEditor } from "../store"
import { snapItemsOf } from "./snapScene"
import { toThree } from "./snapView"
import { allTurnStopsOf, scaleStopsOf, turnStopsFrom, turnStopsOf } from "./turnScale"

const at = { x: 100, y: 0, z: 0 }
const alongX = { x: 1, y: 0, z: 0 }
const selection = { box: boxAt(ORIGIN) }

/** A turn about Z through `pivot` of the 100 cm cube at the origin. */
const turnOf = (pivot: Vec3, own: SnapItem = cubeAt("own", ORIGIN)) => ({
  axis: { x: 0, y: 0, z: 1 },
  pivot,
  rotation: own.transform.rotation,
  own: [own],
  ends: own.ends
})

/** Where the turn stops, in degrees to the hundredth, with what it says. */
const turnStops = (items: ReadonlyArray<SnapItem>, pivot: Vec3 = ORIGIN, rangeCm = 10, own?: SnapItem) =>
  turnStopsOf(allSnapping, turnOf(pivot, own), items, rangeCm).map(({ angle, label }) => [
    Math.round(angle * 18000 / Math.PI) / 100 + 0,
    label
  ])

const stopsAlongX = (...items: Parameters<typeof scaleStopsOf>[3]) =>
  scaleStopsOf(alongX, ORIGIN, selection.box, items).map((stop) => stop.at).toSorted((a, b) => a - b)

describe("what a turn and a scale stop on", () => {
  it("stops a turn where it first touches a neighbour each way, and square to the grid", () => {
    // a corner 70.7 cm out swings onto the face 10 cm off at 13.05°; past that the turn is inside the neighbour
    const stops = turnStops([cubeAt("a", { x: 110, y: 0, z: 0 })])
    assert.deepStrictEqual(stops, [
      [-90, "Square to the grid"],
      [-13.05, "Touching Cube"],
      [0, "Flush with Cube"],
      [13.05, "Touching Cube"],
      [90, "Square to the grid"],
      [180, "Square to the grid"]
    ])
  })

  it("offers no touch with a neighbour it touches or overlaps at the start, and keeps its flush stops all the way round", () => {
    // sharing part of a face, a corner of the neighbour comes onto the turning face at 53°: they touched all along
    for (const there of [{ x: 100, y: 60, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 80, y: 0, z: 0 }]) {
      const stops = turnStops([cubeAt("a", there)])
      assert.notInclude(stops.map(([, label]) => label), "Touching Cube", `a neighbour at ${there.x}, ${there.y}`)
    }
    const sharing = turnStops([cubeAt("a", { x: 100, y: 0, z: 0 })])
    assert.includeDeepMembers(sharing, [[0, "Flush with Cube"], [90, "Flush with Cube"], [-90, "Flush with Cube"]])
  })

  it("lines up with a neighbour's axes and the grid's, short of the touch", () => {
    const turned = {
      ...identityTransform({ x: 0, y: 300, z: 0 }),
      rotation: rotatorToQuat({ pitch: 0, roll: 0, yaw: 30 })
    }
    const stops = turnStops([cubeAt("a", { x: 0, y: 300, z: 0 }, { transform: turned })], { x: 0, y: 0, z: 0 }, 200)
    assert.includeDeepMembers(stops, [[30, "Aligned with Cube on X and Y"], [-60, "Square to Cube"], [
      90,
      "Square to the grid"
    ]])
  })

  it("names a face swung flush onto another, over the touch", () => {
    // a door hung on its edge at (50, 50) closes onto a wall whose face is at x = 150
    const stops = turnStops([cubeAt("a", { x: 200, y: 0, z: 0 })], { x: 50, y: 50, z: 0 })
    assert.deepInclude(stops, [90, "Flush with Cube"])
  })

  it("meets a mesh with its own corners and faces once it has loaded", () => {
    // the mesh is smaller than the bounds, its near face 20 cm off: the corner reaches it later than the box's
    const mesh = meshOfBox(boxAt({ x: 110, y: 0, z: 0 }, 40))
    const stops = turnStops([cubeAt("a", { x: 110, y: 0, z: 0 }, { mesh: () => mesh, faces: () => mesh.faces })])
    assert.deepInclude(stops, [36.87, "Touching Cube"])
    assert.notDeepInclude(stops, [13.05, "Touching Cube"])
  })

  it("brings an end onto an end in range", () => {
    const own = cubeAt("own", ORIGIN, { ends: [endAlongX("own", 0, 50, 1)] })
    const other = cubeAt("a", { x: 0, y: 160, z: 0 }, { ends: [endAlongX("a", 0, 0, 1)] })
    const end = { ...endAlongX("a", 0, 0, 1), position: { x: 0, y: 50, z: 0 }, forward: { x: 0, y: -1, z: 0 } }
    const stops = turnStops([{ ...other, ends: [end] }], ORIGIN, 10, own)
    assert.deepInclude(stops, [90, "End of Cube"])
  })

  it("leaves out what the targets that are off would stop on", () => {
    const off = (target: "mesh" | "grid" | "alignment") => ({
      ...allSnapping,
      targets: { ...allSnapping.targets, [target]: { ...allSnapping.targets[target], enabled: false } }
    })
    const near = [cubeAt("a", { x: 110, y: 0, z: 0 })]
    const kinds = (config: typeof allSnapping) =>
      new Set(turnStopsOf(config, turnOf(ORIGIN), near, 10).map(({ kind }) => kind))
    assert.isFalse(kinds(off("mesh")).has("touch"))
    assert.isFalse(kinds(off("grid")).has("grid"))
    assert.isFalse(kinds(off("alignment")).has("aligned"))
    assert.deepStrictEqual([...kinds({ ...allSnapping, magnet: false })], ["grid"], "the grid alone without the magnet")
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

  it("draws both boxes, a stop's target, the selection's side where the turn puts it, and the glyph", () => {
    const stops = turnStopsOf(allSnapping, turnOf(ORIGIN), [cubeAt("a", { x: 110, y: 0, z: 0 })], 10)
    const touch = stops.find((stop) => stop.kind === "touch" && stop.angle > 0)
    assert.strictEqual(touch?.from, "mesh")
    assert.strictEqual(touch?.relation, "onFace")
    const [targetBox, ownBox, target, source, glyph] = touch?.marks ?? []
    assert.deepStrictEqual(targetBox, {
      kind: "box",
      role: "target",
      corners: cornersOf(boxAt({ x: 110, y: 0, z: 0 }))
    })
    // the selection's box turned as far as the touch: a corner of it is on the neighbour's near face
    assert.isTrue(ownBox?.kind === "box" && ownBox.role === "source")
    const reach = ownBox?.kind === "box" ? Math.max(...ownBox.corners.map(({ x }) => x)) : 0
    assert.closeTo(reach, 60, 1e-6)
    assert.isTrue(target?.kind === "face" && target.role === "target")
    assert.isTrue(source?.kind === "dot" && source.role === "source")
    assert.deepInclude(glyph, { kind: "glyph", relation: "onFace" })
    const square = stops.find((stop) => stop.kind === "grid")
    assert.strictEqual(square?.from, "grid")
    assert.strictEqual(square?.relation, "grid")
  })

  it("keeps the stops of the targets asked for, a held key's", () => {
    const all = allTurnStopsOf(allSnapping, turnOf(ORIGIN), [cubeAt("a", { x: 110, y: 0, z: 0 })], 10)
    assert.deepStrictEqual([...new Set(turnStopsFrom(all, ["grid"]).map(({ kind }) => kind))], ["grid"])
    assert.isFalse(turnStopsFrom(all, ["mesh"]).some(({ kind }) => kind === "grid"))
  })

  it("draws a scale stop's target face, the scaled face on it, and the flush glyph", () => {
    const stops = scaleStopsOf(alongX, ORIGIN, selection.box, [cubeAt("a", { x: 200, y: 0, z: 0 })])
    const near = stops.find((stop) => stop.at === 150)
    assert.strictEqual(near?.relation, "flush")
    const [targetBox, stretched, target, scaled, glyph] = near?.marks ?? []
    assert.deepInclude(targetBox, { kind: "box", role: "target" })
    // the selection's box stretched to the stop, its near side where it was
    const xs = stretched?.kind === "box" ? stretched.corners.map(({ x }) => x) : []
    assert.deepStrictEqual([Math.min(...xs), Math.max(...xs)], [selection.box.min.x, 150])
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
