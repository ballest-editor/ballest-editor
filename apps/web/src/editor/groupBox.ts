/**
 * The box around a whole group, so it reads as one unit where its items' outlines (selectionOutline.ts) read as pieces.
 * It is the box a group's frame is the centre of (`domain/itemBounds.ts`), axis-aligned in the scene, marked by its
 * corners, as brackets, as 3ds Max marks a selection: a whole box would cross the group's items and its neighbours' with
 * lines that belong to neither, and a dashed one means hidden (screenLines.ts). Two looks: a selected group's, in the
 * selection's colour, and the entered group's, thinner and faint in no hue: where the work is, and nothing to act on.
 */
import * as THREE from "three"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js"
import { ueToThreeVector } from "../domain/coords"
import type { Box } from "../domain/itemBounds"
import { LINE_WIDTH, lineMaterial } from "./screenLines"

/** The entered group's corners stay in view without competing with what's selected inside it. */
const ENTERED_LOOK = { linewidth: LINE_WIDTH.light, opacity: 0.5 }
/**
 * How far a bracket reaches along its edge from the corner: a share of the edge, and no more than a share of the box's
 * middle size, so a long, flat group's brackets stay corners and don't run half along it.
 */
export const BRACKET = { ofEdge: 0.25, ofMiddle: 0.35 } as const
/** Over the scene and its outlines, under the gizmo. */
const RENDER_ORDER = 500

/** The corners each of the box's 12 edges joins; a corner's bits say which of min and max it takes on x, y and z. */
const EDGES = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7]
] as const

const cornerOf = (corner: number, min: THREE.Vector3, max: THREE.Vector3, target: THREE.Vector3) =>
  target.set(corner & 1 ? max.x : min.x, corner & 2 ? max.y : min.y, corner & 4 ? max.z : min.z)

const next = new THREE.Box3()
const size = new THREE.Vector3()
const start = new THREE.Vector3()
const end = new THREE.Vector3()
const reach = new THREE.Vector3()

/** One group's corners: put it in the scene, then `update` it each frame. Never raycast. */
export class GroupBox extends LineSegments2 {
  private readonly shown = new THREE.Box3()
  /** Written in place as the box moves: `setPositions` would leave a GPU buffer behind on every frame of a drag. */
  private readonly ends = new THREE.InstancedInterleavedBuffer(new Float32Array(EDGES.length * 12), 6, 1)

  constructor() {
    super(
      new LineSegmentsGeometry(),
      lineMaterial({ linewidth: LINE_WIDTH.outline, transparent: true, depthTest: false, depthWrite: false })
    )
    this.geometry.setAttribute("instanceStart", new THREE.InterleavedBufferAttribute(this.ends, 3, 0))
    this.geometry.setAttribute("instanceEnd", new THREE.InterleavedBufferAttribute(this.ends, 3, 3))
    this.geometry.instanceCount = EDGES.length * 2
    this.frustumCulled = false
    this.renderOrder = RENDER_ORDER
    this.raycast = () => {}
  }

  /** `entered` is the entered group's look, else a selected group's. */
  setLook(color: string, entered: boolean): void {
    this.material.color.set(color)
    this.material.linewidth = entered ? ENTERED_LOOK.linewidth : LINE_WIDTH.outline
    this.material.opacity = entered ? ENTERED_LOOK.opacity : 1
  }

  /** Fits the corners to `bounds` (none hides them). */
  update(bounds: Box | undefined): void {
    this.visible = bounds !== undefined
    if (bounds === undefined) return
    const [min, max] = [ueToThreeVector(bounds.min), ueToThreeVector(bounds.max)]
    next.min.set(min.x, min.y, min.z)
    next.max.set(max.x, max.y, max.z)
    if (next.equals(this.shown)) return
    this.shown.copy(next)
    this.fit()
  }

  private fit(): void {
    const { min, max } = this.shown
    const sides = this.shown.getSize(size).toArray().sort((a, b) => a - b)
    const most = sides[1] * BRACKET.ofMiddle
    EDGES.forEach(([from, to], i) => {
      cornerOf(from, min, max, start)
      cornerOf(to, min, max, end)
      const length = start.distanceTo(end)
      const share = length === 0 ? 0 : Math.min(BRACKET.ofEdge, most / length)
      start.toArray(this.ends.array, i * 12)
      reach.copy(start).lerp(end, share).toArray(this.ends.array, i * 12 + 3)
      reach.copy(end).lerp(start, share).toArray(this.ends.array, i * 12 + 6)
      end.toArray(this.ends.array, i * 12 + 9)
    })
    this.ends.needsUpdate = true
  }

  override dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
