import { IDENTITY_QUAT, type Placement, type ShapeKind } from "../domain/approximate/shapes"

type Triple = readonly [number, number, number]

/** A catalog shape standing upright: `kind` about `center` with half extents `half`, cm. */
export const upright = (kind: ShapeKind, center: Triple, half: Triple): Placement => turned(kind, center, half)

/** The same, turned by `rotation`. */
export const turned = (kind: ShapeKind, center: Triple, half: Triple, rotation = IDENTITY_QUAT): Placement => ({
  kind,
  center: { x: center[0], y: center[1], z: center[2] },
  half: { x: half[0], y: half[1], z: half[2] },
  rotation
})
