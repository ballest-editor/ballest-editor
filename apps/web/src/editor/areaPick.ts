/**
 * What a box or lasso catches in one pane (docs/DESKTOP.md § Box and lasso select): each piece's meshes projected into
 * the pane's pixels and tested against the region (domain/areaSelect.ts). Select-through: what is behind other pieces
 * is caught, but only between the camera's near and far planes.
 *
 * Built for thousands of pieces. A piece's mesh boxes go first: a piece whose boxes miss the region is out, and one whose
 * boxes lie inside it is in, so only the pieces the region's edge crosses are read triangle by triangle. Nothing here
 * allocates per vertex.
 */
import * as THREE from "three"
import type { AreaMode, AreaRegion, Point2 } from "../domain/areaSelect"
import { traverseShown } from "./meshBatches"
import { isOutlinePart } from "./selectionOutline"
import { isMesh } from "./threeGuards"

/** A pane as the pick sees it: its camera and its size in pixels. */
export interface PickView {
  readonly camera: THREE.Camera
  readonly width: number
  readonly height: number
}

/** The eight corners of a box, as offsets into its min and max. */
const CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1]
]

const toClip = new THREE.Matrix4()

/** Projects points of one object (its matrixWorld) into a pane's pixels. */
class Projector {
  private e: ArrayLike<number> = toClip.elements
  private width = 1
  private height = 1
  /** The last point projected: x, y in pixels, and whether it lies between the near and far planes. */
  x = 0
  y = 0
  front = false

  /** Sets up for `matrixWorld`'s points under `view`'s camera. */
  aim(view: PickView, matrixWorld: THREE.Matrix4): void {
    toClip.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse).multiply(matrixWorld)
    this.e = toClip.elements
    this.width = view.width
    this.height = view.height
  }

  project(x: number, y: number, z: number): void {
    const e = this.e
    const cx = (e[0] ?? 0) * x + (e[4] ?? 0) * y + (e[8] ?? 0) * z + (e[12] ?? 0)
    const cy = (e[1] ?? 0) * x + (e[5] ?? 0) * y + (e[9] ?? 0) * z + (e[13] ?? 0)
    const cz = (e[2] ?? 0) * x + (e[6] ?? 0) * y + (e[10] ?? 0) * z + (e[14] ?? 0)
    const cw = (e[3] ?? 0) * x + (e[7] ?? 0) * y + (e[11] ?? 0) * z + (e[15] ?? 0)
    this.front = cw > 0 && cz >= -cw && cz <= cw
    const w = cw > 0 ? cw : 1
    this.x = ((cx / w + 1) / 2) * this.width
    this.y = ((1 - cy / w) / 2) * this.height
  }
}

/** One piece's meshes, found once per drag: a piece doesn't change while the box is dragged. */
interface Piece {
  readonly object: THREE.Object3D
  readonly meshes: ReadonlyArray<THREE.Mesh>
}

/** A piece's shown meshes, those its batch draws among them, and not the outlines over it. */
const meshesOf = (object: THREE.Object3D): ReadonlyArray<THREE.Mesh> => {
  const meshes: Array<THREE.Mesh> = []
  traverseShown(object, (child) => {
    if (isMesh(child) && !isOutlinePart(child)) meshes.push(child)
  })
  for (const mesh of meshes) if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox()
  return meshes
}

/** How a piece's boxes lie against the region: wholly out, wholly in, or across its edge (or behind the camera). */
type Broad = "out" | "in" | "across"

/**
 * Picks the pieces a region catches in one pane, for one drag: built at the press with the pieces that may be caught,
 * then asked once per frame while the region or the camera moves.
 */
export class AreaPicker {
  private readonly pieces = new Map<string, Piece | null>()
  private readonly projector = new Projector()
  private readonly corner = new THREE.Vector3()
  private readonly origin = new THREE.Vector3()

  private readonly objectOf: (key: string) => THREE.Object3D | undefined

  constructor(objectOf: (key: string) => THREE.Object3D | undefined) {
    this.objectOf = objectOf
  }

  private pieceOf(key: string): Piece | null {
    const known = this.pieces.get(key)
    if (known !== undefined) return known
    const object = this.objectOf(key)
    const piece = object === undefined ? null : { object, meshes: meshesOf(object) }
    this.pieces.set(key, piece)
    return piece
  }

  /** Where the piece's origin is on screen; undefined when it is off the camera's depth range or not in the scene. */
  screenOrigin(key: string, view: PickView): Point2 | undefined {
    const piece = this.pieceOf(key)
    if (piece === null) return undefined
    this.origin.setFromMatrixPosition(piece.object.matrixWorld)
    this.projector.aim(view, IDENTITY)
    this.projector.project(this.origin.x, this.origin.y, this.origin.z)
    return this.projector.front ? { x: this.projector.x, y: this.projector.y } : undefined
  }

  /** Whether the piece at `key` is caught: wholly inside the region, or touching it. */
  caught(key: string, view: PickView, region: AreaRegion, mode: AreaMode): boolean {
    const piece = this.pieceOf(key)
    if (piece === null) return false
    if (piece.meshes.length === 0) {
      // nothing drawn to test (a light, a piece still loading): its origin stands for it
      const at = this.screenOrigin(key, view)
      return at !== undefined && region.contains(at.x, at.y)
    }
    const broad = this.broad(piece, view, region)
    if (broad !== "across") return broad === "in"
    return mode === "inside" ? this.wholeInside(piece, view, region) : this.touches(piece, view, region)
  }

  private broad(piece: Piece, view: PickView, region: AreaRegion): Broad {
    const p = this.projector
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let inside = true
    for (const mesh of piece.meshes) {
      const box = mesh.geometry.boundingBox
      if (box === null) return "across"
      p.aim(view, mesh.matrixWorld)
      for (const [i, j, k] of CORNERS) {
        this.corner.set(i ? box.max.x : box.min.x, j ? box.max.y : box.min.y, k ? box.max.z : box.min.z)
        p.project(this.corner.x, this.corner.y, this.corner.z)
        if (!p.front) return "across"
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
        if (inside && !region.contains(p.x, p.y)) inside = false
      }
    }
    if (!region.overlapsBounds(minX, minY, maxX, maxY)) return "out"
    return inside ? "in" : "across"
  }

  /**
   * Projects `mesh`'s vertices into `screen` (x, y, and 1 where in front of the camera), stopping at the first that
   * `stop` says settles the question. True when one did.
   */
  private projectMesh(
    mesh: THREE.Mesh,
    view: PickView,
    screen: Float32Array,
    stop: (p: Projector) => boolean
  ): boolean {
    const p = this.projector
    const position = mesh.geometry.getAttribute("position")
    p.aim(view, mesh.matrixWorld)
    for (let v = 0; v < position.count; v++) {
      p.project(position.getX(v), position.getY(v), position.getZ(v))
      if (stop(p)) return true
      screen[3 * v] = p.x
      screen[3 * v + 1] = p.y
      screen[3 * v + 2] = p.front ? 1 : 0
    }
    return false
  }

  /** Every vertex in front of the camera and inside the region. */
  private wholeInside(piece: Piece, view: PickView, region: AreaRegion): boolean {
    const outside = (p: Projector) => !p.front || !region.contains(p.x, p.y)
    return piece.meshes.every((mesh) =>
      !this.projectMesh(mesh, view, scratchFor(mesh.geometry.getAttribute("position").count * 3), outside)
    )
  }

  /** Any vertex inside the region, else any triangle that touches it. A triangle reaching behind the camera is skipped. */
  private touches(piece: Piece, view: PickView, region: AreaRegion): boolean {
    const inside = (p: Projector) => p.front && region.contains(p.x, p.y)
    for (const mesh of piece.meshes) {
      const position = mesh.geometry.getAttribute("position")
      const index = mesh.geometry.getIndex()
      const screen = scratchFor(position.count * 3)
      if (this.projectMesh(mesh, view, screen, inside)) return true
      const corners = index === null ? position.count : index.count
      for (let t = 0; t + 2 < corners; t += 3) {
        const a = 3 * (index === null ? t : index.getX(t))
        const b = 3 * (index === null ? t + 1 : index.getX(t + 1))
        const c = 3 * (index === null ? t + 2 : index.getX(t + 2))
        if (screen[a + 2] === 0 || screen[b + 2] === 0 || screen[c + 2] === 0) continue
        if (
          region.touchesTriangle(
            screen[a] ?? 0,
            screen[a + 1] ?? 0,
            screen[b] ?? 0,
            screen[b + 1] ?? 0,
            screen[c] ?? 0,
            screen[c + 1] ?? 0
          )
        ) return true
      }
    }
    return false
  }
}

const IDENTITY = new THREE.Matrix4()

let scratch = new Float32Array(3 * 1024)

/** A buffer of at least `length`, kept between calls: a mesh's vertices on screen. */
const scratchFor = (length: number): Float32Array => {
  if (scratch.length < length) scratch = new Float32Array(Math.max(length, scratch.length * 2))
  return scratch
}
