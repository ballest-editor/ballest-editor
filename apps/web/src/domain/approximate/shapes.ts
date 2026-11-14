/**
 * The catalog pieces an approximation is made of, and where each is solid.
 *
 * A fitter sees every piece in a normalised box: the piece's catalog bounds mapped to [-1, 1] on each axis. A
 * placement's half extents along its own axes are then all there is to its size. The `inside` tests were read off the
 * pieces' meshes:
 *
 * - `BP_Prim_Cube`: a 1000 cm cube standing on its origin.
 * - `BP_GlossyRed_WholeSphere`: a sphere of 500 cm radius about its origin.
 * - `BP_Prim_Cylinder`: a 16-sided cylinder of 500 cm radius, 200 cm tall, standing on its origin.
 * - `MP_Cone`: a cone of 150 cm radius, 200 cm tall, apex up.
 * - `MP_Pyramid`: a four-sided pyramid, 200 cm tall, apex up. Its base corners are on the X and Y axes, so the base is
 *   a diamond, not a square along the axes.
 * - `BP_GlossyRed_HalfSphere`: half a sphere of 500 cm radius about the middle of its bounds, the flat face at
 *   x = -250 and the dome toward +X. A fitter holds it dome up, like the cone, so every pointed piece points along
 *   one axis; `catalogFrame` turns it back.
 * - `BP_GlossyRed_Capsule`: a capsule of 250 cm radius along Z about the middle of its bounds, 1000 cm long: a
 *   cylinder from z = -250 to 250 with half a sphere on each end. Scaling stretches the caps with the rest, so each
 *   cap is always a quarter of the length: a long capsule has long ends that look pointed, a squat one flat ends.
 */
import type { Quat4, Tuple3, Vec3 } from "../coords"
import { quatFromAxisAngle, quatMul } from "../ueMath"

export const shapeKinds = ["box", "sphere", "cylinder", "cone", "pyramid", "hemisphere", "capsule"] as const
export type ShapeKind = typeof shapeKinds[number]

interface ShapeSpec {
  /** The piece's class name in the catalog. */
  readonly className: string
  readonly label: string
  /** Whether the point (x, y, z) of the piece's normalised box is inside the piece. */
  readonly inside: (x: number, y: number, z: number) => boolean
  /** The catalog bounds the `inside` test was read from, for a catalog that has none. */
  readonly bounds: { readonly min: Tuple3; readonly max: Tuple3 }
}

export const SHAPES: Readonly<Record<ShapeKind, ShapeSpec>> = {
  box: {
    className: "BP_Prim_Cube",
    label: "Cube",
    inside: () => true,
    bounds: { min: [-500, -500, 0], max: [500, 500, 1000] }
  },
  sphere: {
    className: "BP_GlossyRed_WholeSphere",
    label: "Sphere",
    inside: (x, y, z) => x * x + y * y + z * z <= 1,
    bounds: { min: [-500, -500, -500], max: [500, 500, 500] }
  },
  cylinder: {
    className: "BP_Prim_Cylinder",
    label: "Cylinder",
    inside: (x, y) => x * x + y * y <= 1,
    bounds: { min: [-500, -500, 0], max: [500, 500, 200] }
  },
  cone: {
    className: "MP_Cone",
    label: "Cone",
    inside: (x, y, z) => {
      const radius = (1 - z) / 2
      return x * x + y * y <= radius * radius
    },
    bounds: { min: [-150, -150, 0], max: [150, 150, 200] }
  },
  pyramid: {
    className: "MP_Pyramid",
    label: "Pyramid",
    inside: (x, y, z) => Math.abs(x) + Math.abs(y) <= (1 - z) / 2,
    bounds: { min: [-250, -250, 0], max: [250, 250, 200] }
  },
  hemisphere: {
    className: "BP_GlossyRed_HalfSphere",
    label: "Half sphere",
    // Dome up: the flat face at z = -1 and the pole at z = 1, so it is as wide as it is tall.
    inside: (x, y, z) => x * x + y * y + ((z + 1) / 2) ** 2 <= 1,
    bounds: { min: [-250, -500, -500], max: [250, 500, 500] }
  },
  capsule: {
    className: "BP_GlossyRed_Capsule",
    label: "Capsule",
    // A cylinder over the middle half of the length, and a cap over the quarter at each end.
    inside: (x, y, z) => x * x + y * y + (2 * Math.max(0, Math.abs(z) - 0.5)) ** 2 <= 1,
    bounds: { min: [-250, -250, -500], max: [250, 250, 500] }
  }
}

/**
 * One piece of an approximation, in the game's frame (cm, Z up): the middle of its bounds, how far they reach along
 * each of the piece's own axes, and its turn.
 */
export interface Placement {
  readonly kind: ShapeKind
  readonly center: Vec3
  readonly half: Vec3
  readonly rotation: Quat4
}

export const IDENTITY_QUAT: Quat4 = { x: 0, y: 0, z: 0, w: 1 }

/** The quarter turn about Y that takes the half sphere's catalog +X, its dome, to the fitters' +Z. */
const DOME_UP = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, -Math.PI / 2)

/**
 * `placement` in the frame of its catalog piece, the frame `bounds` is in. Only the half sphere's differs: the
 * fitters hold it dome up, so its catalog X is their Z, its Y their Y, and its Z their -X.
 */
export const catalogFrame = (placement: Placement): Placement => {
  if (placement.kind !== "hemisphere") return placement
  const { x, y, z } = placement.half
  return { ...placement, half: { x: z, y, z: x }, rotation: quatMul(placement.rotation, DOME_UP) }
}
