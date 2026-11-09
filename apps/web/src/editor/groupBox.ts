/**
 * The box around a whole group, so it reads as one unit where its items' outlines (selectionOutline.ts) read as pieces.
 * It is the box a group's frame is the centre of (`domain/itemBounds.ts`), axis-aligned in the scene. Its dashes stay a
 * steady length on screen at the box's distance, whatever the group's size.
 */
import * as THREE from "three"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js"
import { ueToThreeVector } from "../domain/coords"
import type { Box } from "../domain/itemBounds"

/** On screen, in pixels, at the box's distance. */
const DASH = 10
const GAP = 6
/** Pixels: a hair-thin box is lost on a busy floor, and WebGL's own lines are never thicker than one. */
const LINE_WIDTH = 2
/** The entered group's box stays in view without competing with what's selected inside it. */
const ENTERED_LOOK = { linewidth: 1.25, opacity: 0.55 }
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
const centre = new THREE.Vector3()
const start = new THREE.Vector3()
const end = new THREE.Vector3()

/** One group's box: put it in the scene, then `update` it each frame. Never raycast. */
export class GroupBox extends LineSegments2 {
  private readonly shown = new THREE.Box3()
  /** Written in place as the box moves: `setPositions` would leave a GPU buffer behind on every frame of a drag. */
  private readonly ends = new THREE.InstancedInterleavedBuffer(new Float32Array(EDGES.length * 6), 6, 1)
  private readonly lengths = new THREE.InstancedInterleavedBuffer(new Float32Array(EDGES.length * 2), 2, 1)

  constructor() {
    super(
      new LineSegmentsGeometry(),
      new LineMaterial({
        dashed: true,
        dashSize: DASH,
        gapSize: GAP,
        toneMapped: false,
        transparent: true,
        depthTest: false,
        depthWrite: false
      })
    )
    this.geometry.setAttribute("instanceStart", new THREE.InterleavedBufferAttribute(this.ends, 3, 0))
    this.geometry.setAttribute("instanceEnd", new THREE.InterleavedBufferAttribute(this.ends, 3, 3))
    this.geometry.setAttribute("instanceDistanceStart", new THREE.InterleavedBufferAttribute(this.lengths, 1, 0))
    this.geometry.setAttribute("instanceDistanceEnd", new THREE.InterleavedBufferAttribute(this.lengths, 1, 1))
    this.geometry.instanceCount = EDGES.length
    this.frustumCulled = false
    this.renderOrder = RENDER_ORDER
    this.raycast = () => {}
  }

  /** `entered` is the quiet look. */
  setLook(color: string, entered: boolean): void {
    this.material.color.set(color)
    this.material.linewidth = entered ? ENTERED_LOOK.linewidth : LINE_WIDTH
    this.material.opacity = entered ? ENTERED_LOOK.opacity : 1
  }

  /** Fits the box to `bounds` (none hides it) and its dashes to how `camera` sees it, `viewHeight` pixels tall. */
  update(bounds: Box | undefined, camera: THREE.Camera, viewHeight: number): void {
    this.visible = bounds !== undefined
    if (bounds === undefined) return
    const [min, max] = [ueToThreeVector(bounds.min), ueToThreeVector(bounds.max)]
    next.min.set(min.x, min.y, min.z)
    next.max.set(max.x, max.y, max.z)
    if (!next.equals(this.shown)) {
      this.shown.copy(next)
      this.fit()
    }
    if (camera instanceof THREE.PerspectiveCamera) {
      const distance = Math.max(camera.position.distanceTo(next.getCenter(centre)), 1)
      this.material.dashScale = viewHeight / (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    }
  }

  private fit(): void {
    const { min, max } = this.shown
    EDGES.forEach(([from, to], i) => {
      cornerOf(from, min, max, start)
      cornerOf(to, min, max, end)
      start.toArray(this.ends.array, i * 6)
      end.toArray(this.ends.array, i * 6 + 3)
      this.lengths.array[i * 2 + 1] = start.distanceTo(end)
    })
    this.ends.needsUpdate = true
    this.lengths.needsUpdate = true
  }

  override dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
