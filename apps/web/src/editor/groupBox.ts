/**
 * The box around a whole group, so it reads as one unit where its items' outlines (selectionOutline.ts) read as pieces.
 * It is the group's frame (`groupFrameOf`), drawn exactly, with nothing added round it: the box around its items square
 * to the group's own turn. Every edge is dashed corner to corner in a short dash of its own, finer than the hidden one
 * (screenLines.ts), so it doesn't read as a piece or as something behind one. Two looks: a selected group's, in the
 * selection's colour, and the entered group's, thinner and faint in no hue: where the work is, and nothing to act on.
 */
import * as THREE from "three"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js"
import { ueToThreeVector } from "../domain/coords"
import { quatDot, sameVec } from "../domain/ueMath"
import { frameCornersOf, type GroupFrame } from "../domain/units"
import { type Dash, LINE_WIDTH, lineMaterial, screenDashes } from "./screenLines"

/** The entered group's box stays in view without competing with what's selected inside it. */
const ENTERED_LOOK = { linewidth: LINE_WIDTH.light, opacity: 0.5 }
/** A group box's dash, in CSS pixels: shorter and more frequent than the hidden one. */
export const GROUP_DASH: Dash = { on: 3, off: 3 }
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

const sameFrame = (a: GroupFrame, b: GroupFrame) =>
  sameVec(a.origin, b.origin) && sameVec(a.halfExtents, b.halfExtents) && quatDot(a.rotation, b.rotation) === 1

/** One group's box: put it in the scene, then `update` it each frame. Never raycast. */
export class GroupBox extends LineSegments2 {
  private shown: GroupFrame | undefined
  /** Written in place as the box moves: `setPositions` would leave a GPU buffer behind on every frame of a drag. */
  private readonly ends = new THREE.InstancedInterleavedBuffer(new Float32Array(EDGES.length * 6), 6, 1)

  constructor() {
    super(
      new LineSegmentsGeometry(),
      lineMaterial(
        { linewidth: LINE_WIDTH.outline, transparent: true, depthTest: false, depthWrite: false },
        [screenDashes(undefined, GROUP_DASH)],
        "group-box"
      )
    )
    this.geometry.setAttribute("instanceStart", new THREE.InterleavedBufferAttribute(this.ends, 3, 0))
    this.geometry.setAttribute("instanceEnd", new THREE.InterleavedBufferAttribute(this.ends, 3, 3))
    this.geometry.instanceCount = EDGES.length
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

  /** Fits the box to `frame`, turned as it is (none hides it). */
  update(frame: GroupFrame | undefined): void {
    this.visible = frame !== undefined
    if (frame === undefined || (this.shown !== undefined && sameFrame(frame, this.shown))) return
    this.shown = frame
    this.fit(frame)
  }

  private fit(frame: GroupFrame): void {
    const corners = frameCornersOf(frame).map(ueToThreeVector)
    EDGES.forEach(([from, to], i) => {
      const a = corners[from]
      const b = corners[to]
      if (a === undefined || b === undefined) return
      this.ends.array.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6)
    })
    this.ends.needsUpdate = true
  }

  override dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
