import { AXIS_COLORS } from "../axisColors"
/**
 * Blender-style gizmo handles as plain three.js objects (testable without WebGL).
 *
 * A tool is a list of HandleSpecs; handles are independent, so a combined tool is just the
 * concatenation of lists. Visuals are built in "pixel" units along local +X (axis
 * handles), in the local XY plane (plane handles), or around local +Z (rings), and are
 * oriented every frame from world-space directions computed from the GAME basis via
 * coords.ts. The gizmo lives in plain world space (never under a mirror), is scaled to a
 * constant screen size, renders on top, and is grabbed through invisible fatter hit meshes.
 *
 * TODO(pivot-dot): render the selection-origin dot in perspective when the pivot sits on
 * a face, and draw a dotted line to it when the pivot is inside the selection's bounding
 * box.
 */
import * as THREE from "three"
import type { Quat4 } from "../../domain/coords"
import { isLine, isMesh } from "../threeGuards"
import { type Axis, axisWorldDir } from "./math"

export type HandleKind = "translateAxis" | "translatePlane" | "rotateAxis" | "rotateView" | "scaleAxis" | "scaleUniform"

export interface HandleSpec {
  readonly id: string
  readonly kind: HandleKind
  /** Axis for axis/ring handles; for plane handles, the plane's normal axis. */
  readonly axis?: Axis
}

export type GizmoTool = "translate" | "rotate" | "scale"

const axisSpecs = (kind: HandleKind, prefix: string): Array<HandleSpec> =>
  (["x", "y", "z"] as const).map((axis) => ({ id: `${prefix}-${axis}`, kind, axis }))

export const toolHandles: Readonly<Record<GizmoTool, ReadonlyArray<HandleSpec>>> = {
  translate: [...axisSpecs("translatePlane", "tp"), ...axisSpecs("translateAxis", "t")],
  rotate: [...axisSpecs("rotateAxis", "r"), { id: "r-view", kind: "rotateView" }],
  scale: [...axisSpecs("scaleAxis", "s"), { id: "s-uniform", kind: "scaleUniform" }]
}

const VIEW_COLOR = "#ffffff"
const HOVER_TINT = new THREE.Color("#fff3c4")
const RENDER_ORDER = 1000

/** Sizes in screen pixels. */
export const SIZE = {
  axisLength: 88,
  axisStart: 16,
  shaft: 1.1,
  coneLength: 16,
  coneRadius: 5,
  cube: 9,
  planeOffset: 30,
  plane: 12,
  ring: 78,
  viewRing: 94,
  ringTube: 1.2,
  uniform: 14,
  hitRadius: 7
} as const

const pairOf = (
  axis: Axis
): readonly [Axis, Axis] => (axis === "x" ? ["y", "z"] : axis === "y" ? ["z", "x"] : ["x", "y"])

export interface Handle {
  readonly spec: HandleSpec
  readonly root: THREE.Group
  readonly hits: ReadonlyArray<THREE.Mesh>
  readonly baseColor: THREE.Color
  readonly materials: ReadonlyArray<THREE.MeshBasicMaterial>
}

const visualMaterial = (color: THREE.Color) =>
  new THREE.MeshBasicMaterial({
    color: color.clone(),
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
    side: THREE.DoubleSide
  })

/** Never rendered, but raycastable (Mesh.raycast ignores material.visible). */
const hitMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })

const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
  const m = new THREE.Mesh(geometry, material)
  m.renderOrder = RENDER_ORDER
  return m
}

/** Cylinder from local x0 to x1 along +X. */
const alongX = (geometry: THREE.BufferGeometry, x0: number, x1: number) =>
  geometry.rotateZ(-Math.PI / 2).translate((x0 + x1) / 2, 0, 0)

const buildVisual = (
  spec: HandleSpec,
  material: THREE.MeshBasicMaterial
): { parts: Array<THREE.Mesh>; hits: Array<THREE.Mesh> } => {
  const S = SIZE
  switch (spec.kind) {
    case "translateAxis":
    case "scaleAxis": {
      const tip = spec.kind === "translateAxis"
        ? alongX(new THREE.ConeGeometry(S.coneRadius, S.coneLength, 20), S.axisLength, S.axisLength + S.coneLength)
        : new THREE.BoxGeometry(S.cube, S.cube, S.cube).translate(S.axisLength + S.cube / 2, 0, 0)
      const shaft = alongX(
        new THREE.CylinderGeometry(S.shaft, S.shaft, S.axisLength - S.axisStart, 8),
        S.axisStart,
        S.axisLength
      )
      const hit = alongX(
        new THREE.CylinderGeometry(S.hitRadius, S.hitRadius, S.axisLength + S.coneLength - S.axisStart, 8),
        S.axisStart,
        S.axisLength + S.coneLength
      )
      return { parts: [mesh(shaft, material), mesh(tip, material)], hits: [mesh(hit, hitMaterial)] }
    }
    case "translatePlane": {
      const center = S.planeOffset + S.plane / 2
      const square = new THREE.PlaneGeometry(S.plane, S.plane).translate(center, center, 0)
      const hit = new THREE.PlaneGeometry(S.plane + 6, S.plane + 6).translate(center, center, 0)
      return { parts: [mesh(square, material)], hits: [mesh(hit, hitMaterial)] }
    }
    case "rotateAxis":
    case "rotateView": {
      const radius = spec.kind === "rotateAxis" ? S.ring : S.viewRing
      const ring = new THREE.TorusGeometry(radius, S.ringTube, 6, 96)
      const hit = new THREE.TorusGeometry(radius, S.hitRadius, 6, 48)
      return { parts: [mesh(ring, material)], hits: [mesh(hit, hitMaterial)] }
    }
    case "scaleUniform": {
      const ring = new THREE.TorusGeometry(S.uniform, S.ringTube, 6, 48)
      const hit = new THREE.CircleGeometry(S.uniform + S.hitRadius, 24)
      return { parts: [mesh(ring, material)], hits: [mesh(hit, hitMaterial)] }
    }
  }
}

export const makeHandle = (spec: HandleSpec): Handle => {
  const baseColor = new THREE.Color(spec.axis === undefined ? VIEW_COLOR : AXIS_COLORS[spec.axis])
  const material = visualMaterial(baseColor)
  const { parts, hits } = buildVisual(spec, material)
  const root = new THREE.Group()
  root.name = spec.id
  for (const part of [...parts, ...hits]) {
    part.userData["handleId"] = spec.id
    root.add(part)
  }
  return { spec, root, hits, baseColor, materials: [material] }
}

/** Everything a handle needs to place itself this frame. */
export interface GizmoFrame {
  /** World position of the selection origin. */
  readonly origin: THREE.Vector3
  readonly worldPerPixel: number
  /** The item's rotation in game space (for local-axis handles). */
  readonly gameRotation: Quat4
  readonly cameraQuaternion: THREE.Quaternion
}

const X = new THREE.Vector3(1, 0, 0)
const Z = new THREE.Vector3(0, 0, 1)

/** World direction a handle acts along (its axis, ring normal, or plane normal). */
export const handleWorldDir = (spec: HandleSpec, gameRotation: Quat4): THREE.Vector3 | undefined => {
  if (spec.axis === undefined) return undefined
  return spec.kind === "scaleAxis" ? axisWorldDir(spec.axis, gameRotation) : axisWorldDir(spec.axis)
}

export const orientHandle = (handle: Handle, frame: GizmoFrame): void => {
  const { spec, root } = handle
  switch (spec.kind) {
    case "translateAxis":
    case "scaleAxis": {
      const dir = handleWorldDir(spec, frame.gameRotation)
      if (dir !== undefined) root.quaternion.setFromUnitVectors(X, dir)
      return
    }
    case "rotateAxis": {
      const dir = handleWorldDir(spec, frame.gameRotation)
      if (dir !== undefined) root.quaternion.setFromUnitVectors(Z, dir)
      return
    }
    case "translatePlane": {
      if (spec.axis === undefined) return
      const [a, b] = pairOf(spec.axis)
      const u = axisWorldDir(a)
      const v = axisWorldDir(b)
      // proper rotation (no mirror): third column is u x v
      root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, u.clone().cross(v)))
      return
    }
    case "rotateView":
    case "scaleUniform":
      root.quaternion.copy(frame.cameraQuaternion) // face the camera
      return
  }
}

export type HandleState = "idle" | "hover" | "active" | "dimmed"

export const styleHandle = (handle: Handle, state: HandleState): void => {
  for (const material of handle.materials) {
    material.color.copy(handle.baseColor)
    if (state === "hover" || state === "active") material.color.lerp(HOVER_TINT, 0.7)
    material.opacity = state === "dimmed" ? 0.25 : 1
  }
}

/**
 * The gizmo for one tool: `body` holds the handles (positioned at the origin, scaled to
 * pixels); `guide` is an unscaled world-space line along the active axis while dragging.
 */
export class GizmoObject extends THREE.Group {
  readonly handles: ReadonlyArray<Handle>
  readonly body = new THREE.Group()
  readonly guide: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private readonly guidePositions = new THREE.BufferAttribute(new Float32Array(6), 3)

  constructor(specs: ReadonlyArray<HandleSpec>) {
    super()
    this.handles = specs.map(makeHandle)
    for (const h of this.handles) this.body.add(h.root)
    this.add(this.body)
    const geometry = new THREE.BufferGeometry().setAttribute("position", this.guidePositions)
    this.guide = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: "#ffffff",
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.6,
        toneMapped: false
      })
    )
    this.guide.renderOrder = RENDER_ORDER - 1
    this.guide.frustumCulled = false
    this.guide.visible = false
    this.add(this.guide)
  }

  get hitMeshes(): ReadonlyArray<THREE.Mesh> {
    return this.handles.flatMap((h) => h.hits)
  }

  handle(id: string | null): Handle | undefined {
    return id === null ? undefined : this.handles.find((h) => h.spec.id === id)
  }

  update(frame: GizmoFrame, hovered: string | null, active: string | null): void {
    this.body.position.copy(frame.origin)
    this.body.scale.setScalar(frame.worldPerPixel)
    for (const h of this.handles) {
      orientHandle(h, frame)
      const state: HandleState = active !== null
        ? (h.spec.id === active ? "active" : "dimmed")
        : h.spec.id === hovered
        ? "hover"
        : "idle"
      styleHandle(h, state)
    }
    this.body.updateMatrixWorld(true)
  }

  /** Shows a guide line through `origin` along `dir` (world), or hides it. */
  setGuide(origin: THREE.Vector3 | undefined, dir: THREE.Vector3 | undefined, color?: THREE.Color): void {
    if (origin === undefined || dir === undefined) {
      this.guide.visible = false
      return
    }
    const far = 1e6
    const positions = this.guidePositions
    positions.setXYZ(0, origin.x - dir.x * far, origin.y - dir.y * far, origin.z - dir.z * far)
    positions.setXYZ(1, origin.x + dir.x * far, origin.y + dir.y * far, origin.z + dir.z * far)
    positions.needsUpdate = true
    if (color !== undefined) this.guide.material.color.copy(color)
    this.guide.visible = true
  }

  override dispose(): void {
    this.traverse((o) => {
      if (isMesh(o) || isLine(o)) o.geometry.dispose()
    })
    for (const h of this.handles) for (const m of h.materials) m.dispose()
    this.guide.material.dispose()
    super.dispose()
  }
}
