/**
 * A group as a snap target (docs/SNAPPING.md § Groups): its box, which none of its items has, offered as a piece whose
 * mesh hasn't loaded offers its bounds. It has no mesh, faces or ends of its own, so every target reads the box: Mesh's
 * corners, face centres, and the faces and middle a constrained move stops at, a turn's and a scale's stops, and
 * Alignment's sides and centre. Only a face under the pointer it doesn't offer (`SnapItem.group`).
 */
import type { SnapItem } from "./snapFrame"
import { frameCornersOf, type GroupFrame } from "./units"

/** The group `key` called `name` as a target, its box standing as its frame (`groupFrameOf`) has it. */
export const groupSnapItem = (key: string, name: string, frame: GroupFrame): SnapItem => {
  const { halfExtents: h, origin, rotation } = frame
  const corners = frameCornersOf(frame)
  const min = corners.reduce(
    (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) }),
    origin
  )
  const max = corners.reduce(
    (a, b) => ({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) }),
    origin
  )
  return {
    key,
    name,
    box: { min, max },
    transform: { translation: origin, rotation, scale3D: { x: 1, y: 1, z: 1 } },
    bounds: { min: [-h.x, -h.y, -h.z], max: [h.x, h.y, h.z] },
    ends: [],
    mesh: () => undefined,
    faces: () => undefined,
    group: true
  }
}
