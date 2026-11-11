/**
 * The box around a whole group, so it reads as one unit where its items' outlines (selectionOutline.ts) read as pieces.
 * It is the group's frame (`groupFrameOf`): the box around its items square to the group's own turn, marked by its
 * corners, as brackets, as 3ds Max marks a selection: a whole box would cross the group's items and its neighbours' with
 * lines that belong to neither, and a dashed one means hidden (screenLines.ts). Two looks: a selected group's, in the
 * selection's colour, and the entered group's, thinner and faint in no hue: where the work is, and nothing to act on.
 */
import * as THREE from "three"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js"
import { ueToThreeVector } from "../domain/coords"
import { quatDot, sameVec } from "../domain/ueMath"
import { frameCornersOf, type GroupFrame } from "../domain/units"
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

const start = new THREE.Vector3()
const end = new THREE.Vector3()
const reach = new THREE.Vector3()

const sameFrame = (a: GroupFrame, b: GroupFrame) =>
  sameVec(a.origin, b.origin) && sameVec(a.halfExtents, b.halfExtents) && quatDot(a.rotation, b.rotation) === 1

/** One group's corners: put it in the scene, then `update` it each frame. Never raycast. */
export class GroupBox extends LineSegments2 {
  private shown: GroupFrame | undefined
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

  /** Fits the corners to `frame`, turned as it is (none hides them). */
  update(frame: GroupFrame | undefined): void {
    this.visible = frame !== undefined
    if (frame === undefined || (this.shown !== undefined && sameFrame(frame, this.shown))) return
    this.shown = frame
    this.fit(frame)
  }

  private fit(frame: GroupFrame): void {
    const corners = frameCornersOf(frame).map((corner) => {
      const { x, y, z } = ueToThreeVector(corner)
      return new THREE.Vector3(x, y, z)
    })
    const { x, y, z } = frame.halfExtents
    const sides = [x, y, z].map((half) => 2 * half).sort((a, b) => a - b)
    const most = (sides[1] ?? 0) * BRACKET.ofMiddle
    EDGES.forEach(([from, to], i) => {
      start.copy(corners[from] ?? start)
      end.copy(corners[to] ?? end)
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
