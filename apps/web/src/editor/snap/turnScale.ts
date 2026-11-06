/**
 * What a turn and a scale can meet (docs/SNAPPING.md § Affect), worked out once when the drag starts: nothing else moves
 * until it ends. A turn stops with the base face flush on a neighbour's, or the piece's end facing another; a scale stops
 * the scaled face on a neighbour's box.
 */
import type { WorldEnd } from "../../domain/connectors"
import type { Quat4, UeTransform, Vec3 } from "../../domain/coords"
import type { Box } from "../../domain/itemBounds"
import { localToWorld, type PivotChoice } from "../../domain/pivot"
import type { SnapConfig } from "../../domain/snapConfig"
import type { SnapItem, SnapMark } from "../../domain/snapFrame"
import type { FlushPair, ScaleStop } from "../../domain/snapRotate"
import { rotateVec, vecDistance, vecDot, vecLength, vecNormalize, vecSub } from "../../domain/ueMath"

/** The way out of the face each pivot sits on; Default and Center aren't on one. */
const FACE_NORMALS: Partial<Readonly<Record<PivotChoice, Vec3>>> = {
  Bottom: { x: 0, y: 0, z: -1 },
  Top: { x: 0, y: 0, z: 1 },
  Left: { x: 0, y: -1, z: 0 },
  Right: { x: 0, y: 1, z: 0 },
  Back: { x: 1, y: 0, z: 0 },
  Front: { x: -1, y: 0, z: 0 }
}

const isPivotChoice = (choice: string): choice is PivotChoice => Object.hasOwn(FACE_NORMALS, choice)

/** The way out of the face a pivot `choice` sits on, for axes `rotation`; undefined off every face. */
export const faceNormalOf = (choice: string, rotation: Quat4): Vec3 | undefined => {
  const local = isPivotChoice(choice) ? FACE_NORMALS[choice] : undefined
  return local === undefined ? undefined : rotateVec(rotation, local)
}

/** Each face of an item's box: where it is and which way it faces. */
const boundsFacesOf = ({ bounds, transform }: SnapItem) => {
  if (bounds === undefined) return []
  const [x0, y0, z0] = bounds.min
  const [x1, y1, z1] = bounds.max
  const middle = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 }
  const face = (point: Vec3, normal: Vec3) => ({
    centre: localToWorld(transform, point),
    normal: rotateVec(transform.rotation, normal),
    corners: cornersOf(transform, bounds, normal)
  })
  return [
    face({ ...middle, x: x1 }, { x: 1, y: 0, z: 0 }),
    face({ ...middle, x: x0 }, { x: -1, y: 0, z: 0 }),
    face({ ...middle, y: y1 }, { x: 0, y: 1, z: 0 }),
    face({ ...middle, y: y0 }, { x: 0, y: -1, z: 0 }),
    face({ ...middle, z: z1 }, { x: 0, y: 0, z: 1 }),
    face({ ...middle, z: z0 }, { x: 0, y: 0, z: -1 })
  ]
}

/** The four corners of the face of local `bounds` that looks along the unit axis `normal`. */
const cornersOf = (
  transform: UeTransform,
  { max, min }: NonNullable<SnapItem["bounds"]>,
  normal: Vec3
): ReadonlyArray<Vec3> => {
  const pick = (i: 0 | 1 | 2, n: number, other: number) =>
    n !== 0 ? (n > 0 ? max[i] : min[i]) : other === 0 ? min[i] : max[i]
  const quad = [[0, 0], [1, 0], [1, 1], [0, 1]] as const
  return quad.map(([a, b]) => {
    const point = normal.x !== 0
      ? { x: pick(0, normal.x, 0), y: a === 0 ? min[1] : max[1], z: b === 0 ? min[2] : max[2] }
      : normal.y !== 0
      ? { x: a === 0 ? min[0] : max[0], y: pick(1, normal.y, 0), z: b === 0 ? min[2] : max[2] }
      : { x: a === 0 ? min[0] : max[0], y: b === 0 ? min[1] : max[1], z: pick(2, normal.z, 0) }
    return localToWorld(transform, point)
  })
}

const touches = (a: Box, b: Box, by: number) =>
  a.min.x - by <= b.max.x && a.max.x + by >= b.min.x &&
  a.min.y - by <= b.max.y && a.max.y + by >= b.min.y &&
  a.min.z - by <= b.max.z && a.max.z + by >= b.min.z

/** What can stop a turn of the selection about `pivotPoint`, from the Mesh and Connectors targets that are on. */
export const flushPairsOf = (
  config: SnapConfig,
  { base, box, ends, pivotPoint }: {
    /** The way out of the face the pivot is on, if it is on one. */
    readonly base: Vec3 | undefined
    readonly box: Box
    readonly ends: ReadonlyArray<WorldEnd>
    readonly pivotPoint: Vec3
  },
  items: ReadonlyArray<SnapItem>,
  rangeCm: number
): ReadonlyArray<FlushPair> => {
  const reach = vecLength(vecSub(box.max, box.min)) / 2 + rangeCm
  const near = items.filter((item) => touches(box, item.box, reach))
  const faces = config.targets.mesh.enabled && base !== undefined
    ? near.flatMap((item) =>
      (item.mesh()?.faces ?? boundsFacesOf(item)).map((face): FlushPair => ({
        normal: base,
        target: face.normal,
        label: `Face of ${item.name}`,
        marks: [{ kind: "face", corners: face.corners }]
      }))
    )
    : []
  const meetings = config.targets.connectors.enabled
    ? ends.flatMap((own) => {
      const out = vecDistance(own.position, pivotPoint)
      return near.flatMap((item) =>
        item.ends.flatMap((other): ReadonlyArray<FlushPair> =>
          Math.abs(vecDistance(other.position, pivotPoint) - out) > rangeCm ? [] : [{
            normal: own.forward,
            target: other.forward,
            label: `End of ${item.name}`,
            marks: [{ kind: "ring", at: other.position }]
          }]
        )
      )
    })
    : []
  return [...meetings, ...faces]
}

/**
 * The faces of `items`' boxes square to `axis`, as stops at their distance from `pivotPoint`. Boxes, as a stop can be
 * anywhere along the axis, and placing every mesh in the map to find them would stall the drag's start.
 */
export const scaleStopsOf = (
  axis: Vec3,
  pivotPoint: Vec3,
  items: ReadonlyArray<SnapItem>
): ReadonlyArray<ScaleStop> =>
  items.flatMap((item) =>
    boundsFacesOf(item).flatMap((face): ReadonlyArray<ScaleStop> =>
      Math.abs(vecDot(face.normal, axis)) < 0.999
        ? []
        : [{
          at: vecDot(vecSub(face.centre, pivotPoint), axis),
          label: `Face of ${item.name}`,
          marks: [{ kind: "face", corners: face.corners }] satisfies ReadonlyArray<SnapMark>
        }]
    )
  )

/** How far `box` reaches from `pivotPoint` along the unit `axis`, on the side that axis points to. */
export const reachAlong = (box: Box, pivotPoint: Vec3, axis: Vec3): number => {
  const unit = vecNormalize(axis)
  const corners = [box.min.x, box.max.x].flatMap((x) =>
    [box.min.y, box.max.y].flatMap((y) => [box.min.z, box.max.z].map((z) => ({ x, y, z })))
  )
  return Math.max(...corners.map((corner) => vecDot(vecSub(corner, pivotPoint), unit)))
}
