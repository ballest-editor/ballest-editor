import { describe, expect, it } from "@effect/vitest"
import * as THREE from "three"
import { ueToScene, ueToThreeVector } from "../../domain/coords"
import type { UeTransform } from "../../domain/coords"
import { applyGroupDelta } from "../../domain/groupTransform"
import { rotateVec } from "../../domain/ueMath"
import { dragDelta, type DragStart, type PointerSample } from "./drag"
import { GizmoObject, type GizmoSpace, SIZE, toolHandles } from "./handles"
import { axisParamFromRay, axisWorldDir, gameDirToWorld, planeHit, screenAngle } from "./math"

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const identity = {
  translation: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale3D: { x: 1, y: 1, z: 1 }
}

const frame = {
  origin: v3(100, 200, 300),
  worldPerPixel: 2,
  gameRotation: identity.rotation,
  space: "world" as const,
  cameraQuaternion: new THREE.Quaternion()
}

describe("gizmo math", () => {
  it("maps the game basis through coords: Z (blue) is world up", () => {
    expect(axisWorldDir("x").toArray()).toEqual([1, 0, 0])
    expect(axisWorldDir("y").toArray()).toEqual([0, 0, 1])
    expect(axisWorldDir("z").toArray()).toEqual([0, 1, 0])
    for (const axis of ["x", "y", "z"] as const) {
      const g = { x: +(axis === "x"), y: +(axis === "y"), z: +(axis === "z") }
      expect(axisWorldDir(axis).toArray()).toEqual(Object.values(ueToThreeVector(g)))
    }
  })

  it("rotates local axes with the item's game rotation", () => {
    const yaw90 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } // game X turns to game Y
    expect(rotateVec(yaw90, { x: 1, y: 0, z: 0 }).y).toBeCloseTo(1, 12)
    const local = axisWorldDir("x", yaw90)
    expect(local.distanceTo(gameDirToWorld({ x: 0, y: 1, z: 0 }))).toBeLessThan(1e-12)
  })

  it("projects a ray onto an axis line", () => {
    // axis = world X through origin; ray from (5, 10, 0) straight down hits x = 5
    expect(axisParamFromRay(v3(0, 0, 0), v3(1, 0, 0), v3(5, 10, 0), v3(0, -1, 0))).toBeCloseTo(5, 12)
    // skew ray: closest approach still at x = -3
    expect(axisParamFromRay(v3(0, 0, 0), v3(1, 0, 0), v3(-3, 4, 7), v3(0, -0.6, -0.8))).toBeCloseTo(-3, 12)
    expect(axisParamFromRay(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0), v3(1, 0, 0))).toBeUndefined() // parallel
  })

  it("intersects rays with planes", () => {
    const p = planeHit(v3(0, 2, 0), v3(0, 1, 0), v3(3, 10, -4), v3(0, -1, 0))!
    expect(p.toArray()).toEqual([3, 2, -4])
    expect(planeHit(v3(0, 2, 0), v3(0, 1, 0), v3(3, 10, -4), v3(0, 1, 0))).toBeUndefined() // pointing away
  })

  it("measures screen angles counter-clockwise with y down", () => {
    expect(screenAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(Math.PI / 2, 12)
    expect(screenAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(-Math.PI / 2, 12)
  })
})

describe("gizmo handles", () => {
  it("points the red arrow along the mapped game +X in world space (never flipped)", () => {
    const gizmo = new GizmoObject(toolHandles.translate)
    gizmo.update(frame, null, null)
    gizmo.updateMatrixWorld(true)
    for (const axis of ["x", "y", "z"] as const) {
      const arrow = gizmo.handle(`t-${axis}`)!.root
      const base = arrow.localToWorld(v3(0, 0, 0))
      const tip = arrow.localToWorld(v3(SIZE.axisLength, 0, 0))
      const dir = tip.sub(base).normalize()
      const g = { x: +(axis === "x"), y: +(axis === "y"), z: +(axis === "z") }
      expect(dir.distanceTo(gameDirToWorld(g))).toBeLessThan(1e-9)
      expect(base.toArray()).toEqual([100, 200, 300])
    }
    // the gizmo has no mirrored transform anywhere
    gizmo.traverse((o) => expect(o.matrixWorld.determinant()).toBeGreaterThan(0))
  })

  it("has one hit mesh per handle and highlights only the hovered one", () => {
    const gizmo = new GizmoObject(toolHandles.scale)
    expect(gizmo.hitMeshes.length).toBe(toolHandles.scale.length)
    gizmo.update(frame, "s-x", null)
    const colors = gizmo.handles.map((h) => h.materials[0]!.color.getHexString())
    const base = gizmo.handles.map((h) => h.baseColor.getHexString())
    expect(colors.filter((c, i) => c !== base[i])).toHaveLength(1)
    gizmo.update(frame, null, "s-y")
    expect(gizmo.handles.filter((h) => h.materials[0]!.opacity < 1)).toHaveLength(toolHandles.scale.length - 1)
  })
})

/** A drag start plus the one item it moves (at the origin, so it is its own pivot). */
type TestDrag = DragStart & { readonly transform: UeTransform }

describe("gizmo drags (game space)", () => {
  const camera = v3(0, 1000, 1000)
  const pointer = (target: THREE.Vector3, px = { x: 0, y: 0 }) => ({
    rayOrigin: camera.clone(),
    rayDir: target.clone().sub(camera).normalize(),
    px
  })
  const start = (
    id: string,
    transform = identity,
    px = { x: 10, y: 0 },
    space: GizmoSpace = "world"
  ): TestDrag => ({
    spec: [...toolHandles.translate, ...toolHandles.rotate, ...toolHandles.scale].find((s) => s.id === id)!,
    space,
    frameRotation: transform.rotation,
    transform,
    originWorld: v3(0, 0, 0),
    originPx: { x: 0, y: 0 },
    toCamera: camera.clone().normalize(),
    pointer: { ...pointer(v3(0, 0, 0)), px }
  })

  /** The drag applied to the start's item (snapped to `gridSize` cm when given). */
  const dragTransform = (s: TestDrag, now: PointerSample, gridSize?: number) => {
    const delta = dragDelta(
      s,
      now,
      gridSize === undefined ? undefined : { size: gridSize, pivot: s.transform.translation }
    )
    return delta === undefined ? undefined : applyGroupDelta(s.transform, s.transform.translation, delta)
  }

  it("translates along game X by the pointer's projection on the axis", () => {
    const out = dragTransform(start("t-x"), pointer(v3(250, 0, 0)))!
    expect(out.translation.x).toBeCloseTo(250, 9)
    expect(out.translation.y).toBeCloseTo(0, 9)
    expect(out.translation.z).toBeCloseTo(0, 9)
  })

  it("translates along game Z (world up)", () => {
    // Pointer aimed at a point 300 above the origin moves the item up 300 game cm.
    const out = dragTransform(start("t-z"), pointer(v3(0, 300, 0)))!
    expect(out.translation.z).toBeCloseTo(300, 6)
    expect(Math.abs(out.translation.x) + Math.abs(out.translation.y)).toBeLessThan(1e-6)
  })

  it("translates in the game XY (ground) plane", () => {
    const target = ueToScene({ ...identity, translation: { x: 120, y: -40, z: 0 } }).position
    const out = dragTransform(start("tp-z"), pointer(v3(...target)))!
    expect(out.translation.x).toBeCloseTo(120, 9)
    expect(out.translation.y).toBeCloseTo(-40, 9)
    expect(out.translation.z).toBeCloseTo(0, 9)
  })

  it("snaps the moved axes to the world grid and leaves the others alone", () => {
    const off = { ...identity, translation: { x: 3, y: 7, z: 11 } }
    const axis = dragTransform(start("t-x", off), pointer(v3(243, 0, 0)), 25)!
    expect(axis.translation).toEqual({ x: 250, y: 7, z: 11 })
    const target = ueToScene({ ...identity, translation: { x: 123, y: -38, z: 0 } }).position
    const plane = dragTransform(start("tp-z", off), pointer(v3(...target)), 10)!
    expect(plane.translation).toEqual({ x: 130, y: -30, z: 11 })
    // rotation drags ignore the grid
    const s = { ...start("r-z", off), toCamera: v3(0, 1, 0) }
    expect(dragTransform(s, { ...pointer(v3(0, 0, 0)), px: { x: 0, y: -10 } }, 100)!.translation).toEqual(
      off.translation
    )
  })

  it("rotates about game Z: a quarter turn counter-clockwise seen from above is -90 deg game yaw", () => {
    // camera above: Z axis points at the viewer
    const s = { ...start("r-z"), toCamera: v3(0, 1, 0) }
    const out = dragTransform(s, { ...pointer(v3(0, 0, 0)), px: { x: 0, y: -10 } })!
    // game yaw is clockwise seen from above (left-handed), so CCW on screen = negative yaw
    expect(out.rotation.z).toBeCloseTo(-Math.SQRT1_2, 9)
    expect(out.rotation.w).toBeCloseTo(Math.SQRT1_2, 9)
    // and that turns game +X toward game -Y
    expect(rotateVec(out.rotation, { x: 1, y: 0, z: 0 }).y).toBeCloseTo(-1, 9)
  })

  it("scales one local axis by the distance ratio, and uniformly from the centre handle", () => {
    const out = dragTransform(start("s-x", identity), pointer(v3(1, 0, 0)))
    expect(out).toBeUndefined() // start pointer at the origin: no reference distance
    const s0 = { ...start("s-x"), pointer: pointer(v3(100, 0, 0)) }
    const scaled = dragTransform(s0, pointer(v3(250, 0, 0)))!.scale3D
    expect(scaled.x).toBeCloseTo(2.5, 9)
    expect([scaled.y, scaled.z]).toEqual([1, 1])
    const u = start("s-uniform", identity, { x: 20, y: 0 })
    expect(dragTransform(u, { ...pointer(v3(0, 0, 0)), px: { x: 0, y: 30 } })!.scale3D).toEqual({
      x: 1.5,
      y: 1.5,
      z: 1.5
    })
  })

  describe("local vs world space", () => {
    // game X turns to game Y
    const yaw90 = { ...identity, rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } }
    const gameY = gameDirToWorld({ x: 0, y: 1, z: 0 })

    it("translates along the item's own X in local space, world X in world space", () => {
      const target = gameY.clone().multiplyScalar(250)
      const local = dragTransform(start("t-x", yaw90, undefined, "local"), pointer(target))!
      expect(local.translation.y).toBeCloseTo(250, 6)
      expect(local.translation.x).toBeCloseTo(0, 6)
      const world = dragTransform(start("t-x", yaw90, undefined, "world"), pointer(v3(250, 0, 0)))!
      expect(world.translation.x).toBeCloseTo(250, 6)
      expect(world.translation.y).toBeCloseTo(0, 6)
    })

    it("snaps local-space moves to whole grid steps along the item's own axes", () => {
      // 30 deg yaw: local X is off every world axis, so only the distance can be snapped
      const yaw30 = {
        ...identity,
        translation: { x: 3, y: 7, z: 11 },
        rotation: { x: 0, y: 0, z: Math.sin(Math.PI / 12), w: Math.cos(Math.PI / 12) }
      }
      const localX = gameDirToWorld({ x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6), z: 0 })
      const out = dragTransform(start("t-x", yaw30, undefined, "local"), pointer(localX.multiplyScalar(137)), 50)!
      expect(out.translation.x).toBeCloseTo(3 + 150 * Math.cos(Math.PI / 6), 6)
      expect(out.translation.y).toBeCloseTo(7 + 150 * Math.sin(Math.PI / 6), 6)
      expect(out.translation.z).toBeCloseTo(11, 9)
    })

    it("rotates about the item's own axes in local space", () => {
      // a quarter turn about local X (= game Y here) leaves game Y fixed
      const s = { ...start("r-x", yaw90, undefined, "local"), toCamera: gameY.clone() }
      const out = dragTransform(s, { ...pointer(v3(0, 0, 0)), px: { x: 0, y: -10 } })!
      const y = rotateVec(out.rotation, { x: 1, y: 0, z: 0 })
      expect(y.y).toBeCloseTo(1, 9)
      // the same drag in world space turns about game X instead, moving the item's X off game Y
      const w = { ...start("r-x", yaw90, undefined, "world"), toCamera: axisWorldDir("x") }
      const outWorld = dragTransform(w, { ...pointer(v3(0, 0, 0)), px: { x: 0, y: -10 } })!
      expect(Math.abs(rotateVec(outWorld.rotation, { x: 1, y: 0, z: 0 }).y)).toBeLessThan(1e-9)
    })

    it("scales the local axis nearest a world-space handle", () => {
      const s0 = { ...start("s-x", yaw90, undefined, "world"), pointer: pointer(v3(100, 0, 0)) }
      // world X is the item's local Y after the yaw
      const world = dragTransform(s0, pointer(v3(250, 0, 0)))!.scale3D
      expect(world.y).toBeCloseTo(2.5, 9)
      expect([world.x, world.z]).toEqual([1, 1])
      const l0 = { ...start("s-x", yaw90, undefined, "local"), pointer: pointer(gameY.clone().multiplyScalar(100)) }
      const local = dragTransform(l0, pointer(gameY.clone().multiplyScalar(250)))!.scale3D
      expect(local.x).toBeCloseTo(2.5, 9)
      expect([local.y, local.z]).toEqual([1, 1])
    })

    it("orients the handles by the item's rotation only in local space", () => {
      const gizmo = new GizmoObject(toolHandles.translate)
      const arrowDir = (space: GizmoSpace) => {
        gizmo.update({ ...frame, gameRotation: yaw90.rotation, space }, null, null)
        gizmo.updateMatrixWorld(true)
        const arrow = gizmo.handle("t-x")!.root
        return arrow.localToWorld(v3(SIZE.axisLength, 0, 0)).sub(arrow.localToWorld(v3(0, 0, 0))).normalize()
      }
      expect(arrowDir("local").distanceTo(gameY)).toBeLessThan(1e-9)
      expect(arrowDir("world").distanceTo(axisWorldDir("x"))).toBeLessThan(1e-9)
    })
  })
})
