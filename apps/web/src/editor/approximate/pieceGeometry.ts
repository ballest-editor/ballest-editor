/**
 * What the approximation preview draws a piece with: its catalog mesh as one geometry, or a stand-in of the same
 * shape, and the matrix and shade of each placement. Everything here is in the game's frame.
 */
import * as THREE from "three"
import { transformOfPlacement } from "../../domain/approximate/items"
import type { Placement, ShapeKind } from "../../domain/approximate/shapes"
import type { Tuple3 } from "../../domain/coords"
import { fixSceneWinding } from "../winding"
import { trianglesUnder } from "./meshTriangles"

export type Bounds = { readonly min: Tuple3; readonly max: Tuple3 }

/** A unit of three's shape, which stands along Y, standing along the game's Z. */
const upright = (geometry: THREE.BufferGeometry) => geometry.rotateX(Math.PI / 2)

/** Each shape filling the cube from -0.5 to 0.5, as its piece fills its bounds. */
const UNIT_SHAPES: Readonly<Record<ShapeKind, () => THREE.BufferGeometry>> = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.5, 24, 16),
  cylinder: () => upright(new THREE.CylinderGeometry(0.5, 0.5, 1, 16)),
  cone: () => upright(new THREE.ConeGeometry(0.5, 1, 24)),
  // Four sides, their corners on the X and Y axes like the piece's.
  pyramid: () => upright(new THREE.ConeGeometry(0.5, 1, 4)),
  // The top half of a sphere, turned so the dome points along +X.
  hemisphere: () =>
    new THREE.SphereGeometry(1, 24, 8, 0, 2 * Math.PI, 0, Math.PI / 2).rotateZ(-Math.PI / 2).translate(-0.5, 0, 0)
      .scale(1, 0.5, 0.5),
  // Each cap a quarter of the length.
  capsule: () => upright(new THREE.CapsuleGeometry(0.25, 0.5, 8, 24)).scale(2, 2, 1)
}

/** A stand-in for a shape's mesh, for a catalog without it and while it loads, filling `bounds`. */
export const standInGeometry = (kind: ShapeKind, { max, min }: Bounds): THREE.BufferGeometry =>
  UNIT_SHAPES[kind]()
    .scale(max[0] - min[0], max[1] - min[1], max[2] - min[2])
    .translate((max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2)

/** A glb's meshes as one geometry, in the game's frame as the glb is. */
export const glbGeometry = (scene: THREE.Object3D): THREE.BufferGeometry => {
  fixSceneWinding(scene)
  return new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(trianglesUnder(scene), 3))
}

/** The item matrix that makes a piece with local `bounds` fill `placement`, written to `out`. */
export const placementMatrix = (bounds: Bounds, placement: Placement, out: THREE.Matrix4): THREE.Matrix4 => {
  const { rotation, scale3D, translation } = transformOfPlacement(bounds, placement)
  return out.compose(
    new THREE.Vector3(translation.x, translation.y, translation.z),
    new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    new THREE.Vector3(scale3D.x, scale3D.y, scale3D.z)
  )
}

/** `base` a little lighter or darker for piece `n`, the same every run, so neighbours stand apart. */
export const shadeOf = (base: THREE.Color, n: number, out: THREE.Color): THREE.Color => {
  const hsl = base.getHSL({ h: 0, s: 0, l: 0 })
  // Scattered over -1 to 1: pieces next to each other in the order get unrelated shades.
  const scatter = (Math.sin(n * 12.9898) * 43758.5453) % 1
  return out.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + scatter * 0.18, 0.2, 0.85))
}
