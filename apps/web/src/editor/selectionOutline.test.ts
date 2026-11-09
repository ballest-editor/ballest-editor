import { describe, expect, it } from "@effect/vitest"
import * as THREE from "three"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { UE_TO_THREE_MATRIX, ueToScene } from "../domain/coords"
import { showsTarget } from "./paintTarget"
import { HIDDEN_OPACITY, LINE_WIDTH } from "./screenLines"
import {
  isOutlinePart,
  OUTLINE_COLORS,
  outlineOf,
  PAINT_HOVER_COLORS,
  SelectionOutline,
  setOutlineTheme
} from "./selectionOutline"
import { isMesh } from "./threeGuards"
import { VISUAL_KEY } from "./visuals"

/** A wedge (ramp) in UE local space: 400 long in X, 100 wide in Y, rising 0..30 cm in Z. */
const wedge = (): THREE.BufferGeometry => {
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(400, 0), new THREE.Vector2(400, 30)])
  // extruded along Z, then turned so the extrusion runs along UE Y
  return new THREE.ExtrudeGeometry(shape, { depth: 100, bevelEnabled: false }).rotateX(Math.PI / 2)
}

/** An item group like ItemObject builds: item transform -> mirror root -> UE-space mesh. */
const makeItem = (geometry: THREE.BufferGeometry) => {
  const half = (37 * Math.PI) / 360
  const t = ueToScene({
    translation: { x: 100, y: -50, z: 20 },
    rotation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) }, // 37 deg about game Z
    scale3D: { x: 1, y: 2, z: 0.5 }
  })
  const item = new THREE.Group()
  item.position.set(...t.position)
  item.quaternion.set(...t.quaternion)
  item.scale.set(...t.scale)
  const mirror = new THREE.Group()
  mirror.matrixAutoUpdate = false
  mirror.matrix.set(...UE_TO_THREE_MATRIX)
  const mesh = new THREE.Mesh(geometry)
  mesh.position.set(50, 0, 0)
  mirror.add(mesh)
  item.add(mirror)
  item.updateMatrixWorld(true)
  return { item, mesh }
}

/** A segment's two ends, `i`th of an outline's fat lines. */
const endsOf = (geometry: THREE.BufferGeometry, i: number): [THREE.Vector3, THREE.Vector3] => [
  new THREE.Vector3().fromBufferAttribute(geometry.getAttribute("instanceStart"), i),
  new THREE.Vector3().fromBufferAttribute(geometry.getAttribute("instanceEnd"), i)
]
const countOf = (geometry: THREE.BufferGeometry) => geometry.getAttribute("instanceStart").count

/** World-space endpoints of every drawn segment, rounded so they compare as strings. */
const segments = (line: THREE.Mesh): Array<string> => {
  const out: Array<string> = []
  for (let i = 0; i < countOf(line.geometry); i++) {
    const ends = endsOf(line.geometry, i).map((end) =>
      end.applyMatrix4(line.matrixWorld).toArray().map((n) => Math.round(n * 1000) / 1000).join(",")
    )
    out.push(ends.sort().join(" | "))
  }
  return out.sort()
}

/** The outline's lines: what shows, then what shows through. Fat lines are meshes, apart from the fills. */
const linesOf = (outline: THREE.Group) => outline.children.filter((c) => c instanceof LineSegments2)
const firstLine = (outline: THREE.Group): LineSegments2 => {
  const [line] = linesOf(outline)
  if (line === undefined) throw new Error("outline has no lines")
  return line
}
const lineMaterialOf = (line: LineSegments2 | undefined): LineMaterial => {
  const material = line?.material
  if (!(material instanceof LineMaterial)) throw new Error("not an outline line")
  return material
}

/**
 * The segments the shaders keep for an eye at `eye` (mesh-local): their facing tests, on the CPU. `hidden` is the pass
 * that shows through the scene, which keeps to the item's side toward the eye.
 */
const visibleFrom = (
  outline: THREE.BufferGeometry,
  eye: THREE.Vector3,
  hidden = false
): Array<[THREE.Vector3, THREE.Vector3]> => {
  const normalA = outline.getAttribute("faceNormalA")
  const normalB = outline.getAttribute("faceNormalB")
  const always = outline.getAttribute("edgeAlways")
  const kept: Array<[THREE.Vector3, THREE.Vector3]> = []
  for (let i = 0; i < countOf(outline); i++) {
    const [from, to] = endsOf(outline, i)
    const toEye = eye.clone().sub(from)
    const a = new THREE.Vector3().fromBufferAttribute(normalA, i).dot(toEye)
    const b = new THREE.Vector3().fromBufferAttribute(normalB, i).dot(toEye)
    const crease = always.getX(i) > 0.5
    const shown = hidden ? a * b <= 0 || (crease && Math.max(a, b) > 0) : crease || a * b <= 0
    if (shown) kept.push([from, to])
  }
  return kept
}

describe("selection outline", () => {
  it("draws a ramp's own edges, not its bounding box, from any side", () => {
    // a triangular prism has 9 edges, all creases; its bounding box would have 12
    const outline = outlineOf(wedge())
    expect(countOf(outline)).toBe(9)
    expect(visibleFrom(outline, new THREE.Vector3(1000, 500, -300))).toHaveLength(9)
    expect(visibleFrom(outline, new THREE.Vector3(-1000, -500, 300))).toHaveLength(9)
  })

  it("draws a smooth surface's silhouette as seen from the eye", () => {
    // a sphere has no creases: from far out on +X its outline is the ring around the X axis
    const radius = 100
    const outline = outlineOf(new THREE.SphereGeometry(radius, 48, 24))
    const kept = visibleFrom(outline, new THREE.Vector3(100_000, 0, 0))
    expect(kept.length).toBeGreaterThan(40)
    for (const [from, to] of kept) {
      for (const end of [from, to]) {
        expect(Math.abs(end.x)).toBeLessThan(radius * 0.1)
        expect(Math.hypot(end.y, end.z)).toBeGreaterThan(radius * 0.99)
      }
    }
    // and from +Y the ring turns with the eye
    for (const [from] of visibleFrom(outline, new THREE.Vector3(0, 100_000, 0))) {
      expect(Math.abs(from.y)).toBeLessThan(radius * 0.1)
    }
  })

  it("shows through the scene only on its side toward the eye", () => {
    // from far out on +X, the box's own front face: its 4 edges, not the 8 its other faces close behind it
    const box = outlineOf(new THREE.BoxGeometry(10, 20, 30))
    const eye = new THREE.Vector3(1000, 0, 0)
    expect(visibleFrom(box, eye)).toHaveLength(12)
    const through = visibleFrom(box, eye, true)
    expect(through).toHaveLength(4)
    for (const [from, to] of through) expect([from.x, to.x]).toEqual([5, 5])
    // a sphere shows its silhouette through, as it draws it in the open
    const sphere = outlineOf(new THREE.SphereGeometry(100, 48, 24))
    const far = new THREE.Vector3(100_000, 0, 0)
    expect(visibleFrom(sphere, far, true)).toEqual(visibleFrom(sphere, far))
  })

  it("welds glb seams: a box split per face still has only its 12 edges", () => {
    // BoxGeometry duplicates every corner per face, like a glb with hard normals
    const box = new THREE.BoxGeometry(10, 20, 30)
    expect(countOf(outlineOf(box))).toBe(12)
  })

  it("lands every edge on the mesh in world space, through the item's transform", () => {
    const { item, mesh } = makeItem(wedge())
    const outline = new SelectionOutline()
    item.add(outline)
    outline.update(item)
    outline.updateMatrixWorld(true)
    expect(outline.visible).toBe(true)
    // the lines, and the same lines again for what shows through
    expect(outline.children).toHaveLength(2)
    expect(linesOf(outline)[1]?.geometry).toBe(linesOf(outline)[0]?.geometry)
    const line = firstLine(outline)
    const expected = new THREE.Mesh(outlineOf(mesh.geometry))
    expected.matrixWorld.copy(mesh.matrixWorld)
    expect(segments(line)).toEqual(segments(expected))
  })

  it("follows meshes as they load and leave, and is never raycast", () => {
    const { item, mesh } = makeItem(wedge())
    const outline = new SelectionOutline()
    item.add(outline)
    outline.update(item)
    const second = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10))
    mesh.parent!.add(second)
    outline.update(item)
    expect(outline.children).toHaveLength(4)
    outline.update(item) // idempotent: the outline's own lines are not meshes
    expect(outline.children).toHaveLength(4)
    second.removeFromParent()
    mesh.removeFromParent()
    outline.update(item)
    expect(outline.children).toHaveLength(0)
    expect(outline.visible).toBe(false)

    item.add(mesh)
    outline.update(item)
    // a ray straight through a drawn vertex still hits nothing
    const line = firstLine(outline)
    line.updateMatrixWorld(true)
    const [vertex] = endsOf(line.geometry, 0)
    vertex.applyMatrix4(line.matrixWorld)
    const ray = new THREE.Raycaster(vertex.clone().add(new THREE.Vector3(0, 1000, 0)), new THREE.Vector3(0, -1, 0))
    expect(ray.intersectObject(outline, true)).toHaveLength(0)
  })

  it("draws the active item apart from the rest of the selection, in either theme", () => {
    const { item } = makeItem(wedge())
    const outline = new SelectionOutline()
    item.add(outline)
    outline.update(item)
    const colorsOf = () => linesOf(outline).map((line) => `#${lineMaterialOf(line).color.getHexString()}`)
    expect(colorsOf()).toEqual([OUTLINE_COLORS.dark.selected, OUTLINE_COLORS.dark.selected])
    outline.update(item, true)
    expect(colorsOf()).toEqual([OUTLINE_COLORS.dark.active, OUTLINE_COLORS.dark.active])
    setOutlineTheme(false)
    expect(colorsOf()).toEqual([OUTLINE_COLORS.light.active, OUTLINE_COLORS.light.active])
    outline.update(item, false)
    expect(colorsOf()).toEqual([OUTLINE_COLORS.light.selected, OUTLINE_COLORS.light.selected])
    setOutlineTheme(true)
    expect(colorsOf()).toEqual([OUTLINE_COLORS.dark.selected, OUTLINE_COLORS.dark.selected])
  })

  it("draws what the scene hides lighter, where the scene is nearer", () => {
    const { item } = makeItem(wedge())
    const outline = new SelectionOutline()
    item.add(outline)
    outline.update(item)
    const [shown, hidden] = linesOf(outline).map(lineMaterialOf)
    expect([shown?.depthFunc, shown?.transparent]).toEqual([THREE.LessEqualDepth, false])
    expect([hidden?.depthFunc, hidden?.depthWrite, hidden?.transparent]).toEqual([THREE.GreaterDepth, false, true])
    expect(hidden?.opacity).toBe(HIDDEN_OPACITY)
    // what shows through is lighter than what shows, and the same colour
    expect([shown?.linewidth, hidden?.linewidth]).toEqual([LINE_WIDTH.outline, LINE_WIDTH.light])
    expect(hidden?.color.getHexString()).toBe(shown?.color.getHexString())
  })

  it("outlines the hover in the pointer's colour, only where it shows, and unshaded", () => {
    const { item } = makeItem(wedge())
    const outline = new SelectionOutline()
    item.add(outline)
    outline.update(item)
    outline.updateHover(item)
    expect(outline.children).toHaveLength(1)
    const hover = lineMaterialOf(linesOf(outline)[0])
    expect(`#${hover.color.getHexString()}`).toBe(PAINT_HOVER_COLORS.dark.paint)
    // lighter than the selection's, which it would become
    expect(hover.linewidth).toBe(LINE_WIDTH.light)
  })

  it("marks its lines as no part of the item, though fat lines are meshes", () => {
    const { item, mesh } = makeItem(wedge())
    const outline = new SelectionOutline()
    item.add(outline)
    outline.update(item)
    const meshes: Array<THREE.Object3D> = []
    item.traverse((object) => {
      if (isMesh(object) && !isOutlinePart(object)) meshes.push(object)
    })
    expect(meshes).toEqual([mesh])
  })

  describe("the paint tool's hover", () => {
    /** An item as ItemObject builds it, mirrored or not: visual `m0` holding a primitive per slot, slot 1 two-sided. */
    const paintable = (mirrored = false) => {
      const { item, mesh } = makeItem(wedge())
      item.userData = { itemId: "a" }
      if (mirrored) mesh.scale.set(-1, 1, 1) // as ItemObject mirrors a piece: its source mesh at a negative scale
      const visual = mesh.parent!
      visual.userData = { [VISUAL_KEY]: "m0" }
      mesh.geometry.userData = { ueMaterialIndex: 0 }
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(10, 10, 10),
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
      )
      glass.geometry.userData = { ueMaterialIndex: 1 }
      visual.add(glass)
      item.updateMatrixWorld(true)
      const outline = new SelectionOutline()
      item.add(outline)
      return { item, outline, slots: [mesh, glass] as const }
    }
    const fillsOf = (outline: THREE.Group) =>
      outline.children.filter((c): c is THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> =>
        isMesh(c) && !(c instanceof LineSegments2)
      )
    const spotAt = (slot: number) => ({ itemId: "a", visual: "m0", slot })

    it("shades the target's faces under its outline: the slot's primitives, or every mesh for the whole piece", () => {
      const { item, outline, slots } = paintable()
      outline.updatePaintHover(item, showsTarget({ spot: spotAt(1), whole: false }), false)
      expect(fillsOf(outline).map((fill) => fill.geometry)).toEqual([slots[1].geometry])
      expect(linesOf(outline)).toHaveLength(1)
      outline.updatePaintHover(item, showsTarget({ spot: spotAt(1), whole: true }), false)
      expect(fillsOf(outline).map((fill) => fill.geometry)).toEqual(slots.map((mesh) => mesh.geometry))
      // the selection's outline has no fill, and leaves none behind
      outline.update(item)
      expect(fillsOf(outline)).toHaveLength(0)
      expect(linesOf(outline)).toHaveLength(4)
    })

    it("lies on the mesh's faces, mirrored with it, translucent over them, and is never raycast", () => {
      const signs = [false, true].map((mirrored) => {
        const { item, outline, slots } = paintable(mirrored)
        outline.updatePaintHover(item, showsTarget({ spot: spotAt(0), whole: false }), false)
        outline.updateMatrixWorld(true)
        const [fill] = fillsOf(outline)
        expect(fill?.matrixWorld.toArray().map((n) => Math.round(n * 1e6) / 1e6)).toEqual(
          slots[0].matrixWorld.toArray().map((n) => Math.round(n * 1e6) / 1e6)
        )

        expect([fill!.material.transparent, fill!.material.depthWrite, fill!.material.side]).toEqual([
          true,
          false,
          THREE.FrontSide
        ])
        // a ray straight down through the mesh hits it, and not its fill
        const centre = new THREE.Box3().setFromObject(slots[0]).getCenter(new THREE.Vector3())
        const ray = new THREE.Raycaster(centre.clone().setY(10_000), new THREE.Vector3(0, -1, 0))
        expect(ray.intersectObject(slots[0])).not.toHaveLength(0)
        expect(ray.intersectObject(outline, true)).toHaveLength(0)
        return Math.sign(fill!.matrixWorld.determinant())
      })
      // the determinant's sign is what the renderer picks the front faces by: a mirror flips the fill's as the mesh's
      expect(signs[0]).toBe(-signs[1]!)
    })

    it("is two-sided where the mesh is, and red where the game takes no paint, in either theme", () => {
      const { item, outline } = paintable()
      const look = () => fillsOf(outline).map(({ material: m }) => [`#${m.color.getHexString()}`, m.opacity, m.side])
      outline.updatePaintHover(item, () => true, false)
      expect(look()).toEqual([
        [PAINT_HOVER_COLORS.dark.paint, PAINT_HOVER_COLORS.dark.fill, THREE.FrontSide],
        [PAINT_HOVER_COLORS.dark.paint, PAINT_HOVER_COLORS.dark.fill, THREE.DoubleSide]
      ])
      outline.updatePaintHover(item, () => true, true)
      expect(look().map(([color]) => color)).toEqual([PAINT_HOVER_COLORS.dark.blocked, PAINT_HOVER_COLORS.dark.blocked])
      setOutlineTheme(false)
      expect(look()[0]).toEqual([PAINT_HOVER_COLORS.light.blocked, PAINT_HOVER_COLORS.light.fill, THREE.FrontSide])
      outline.updatePaintHover(item, () => true, false)
      expect(look()[1]).toEqual([PAINT_HOVER_COLORS.light.paint, PAINT_HOVER_COLORS.light.fill, THREE.DoubleSide])
      setOutlineTheme(true)
    })

    it("is never outlined or shaded itself, by its own outline or the selection's", () => {
      const { item, outline } = paintable()
      const selection = new SelectionOutline()
      item.add(selection)
      outline.updatePaintHover(item, () => true, false)
      selection.update(item)
      outline.updatePaintHover(item, () => true, false)
      expect(selection.children).toHaveLength(4)
      expect(fillsOf(outline)).toHaveLength(2)
      expect(linesOf(outline)).toHaveLength(2)
    })
  })

  it("caches edges per geometry and frees them with it", () => {
    const geometry = wedge()
    const edges = outlineOf(geometry)
    expect(outlineOf(geometry)).toBe(edges)
    geometry.dispose()
    expect(outlineOf(geometry)).not.toBe(edges)
  })
})
