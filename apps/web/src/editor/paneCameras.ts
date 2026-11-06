/**
 * The cameras behind the view panes (docs/DESKTOP.md § View panes): plain three.js state, because they change on every
 * pointer move. Each map tab has one `PaneCamera` per slot, so a tab keeps its views, and a slot keeps its own while a
 * smaller layout hides it. What a pane looks along and where it sits are the store's (`viewLayout`); this follows.
 */
import * as THREE from "three"
import { threeToUeVector, ueToThreeVector, type Vec3 } from "../domain/coords"
import {
  clampCmPerPixel,
  distanceForScale,
  nearestOrthoView,
  ORTHO_AXES,
  orthoFraming,
  orthoPlacementPoint,
  scaleForDistance,
  zoomAtPointer
} from "../domain/orthoView"
import { isOrthoView, type OrthoView, paneRectAt, paneRects, type ViewProjection } from "../domain/viewLayout"
import { gameDirToWorld, type Px, worldPerPixel } from "./gizmo/math"
import { useEditor } from "./store"

const layerOf = (layer: number): THREE.Layers => {
  const layers = new THREE.Layers()
  layers.set(layer)
  return layers
}

/** What only one kind of camera sees: the sky and floor grid, and the world grid. Layer 0 is everything else. */
const PERSPECTIVE_LAYER = 1
const ORTHOGRAPHIC_LAYER = 2
export const perspectiveOnly = layerOf(PERSPECTIVE_LAYER)
export const orthographicOnly = layerOf(ORTHOGRAPHIC_LAYER)

const NEAR = 5
const FAR = 2_000_000
/** An orthographic camera stands this far back, so the whole map is in front of it whatever it is centred on. */
const ORTHO_STANDOFF = FAR / 2
/** The pivot ahead of a perspective camera that has none in front of it. */
const ORBIT_DISTANCE = 1500
const FRAME_OFFSET = new THREE.Vector3(-1, 0.8, 1).normalize()
/** The least a focused pane shows (cm), so one small piece doesn't fill it. */
export const FOCUS_SPAN = 300
/** The same for a map with nothing in it, or nearly. */
const MAP_SPAN = 2000

const toVector = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z)
const uePoint = (v: THREE.Vector3): Vec3 => threeToUeVector({ x: v.x, y: v.y, z: v.z })

const scaleListeners = new Set<() => void>()

/** Calls `listener` when any pane's zoom changes (the panes' labels show it). */
export const onPaneScaleChange = (listener: () => void): () => void => {
  scaleListeners.add(listener)
  return () => void scaleListeners.delete(listener)
}

/** One slot's view of a map: both its cameras, and which is in use. */
export class PaneCamera {
  readonly perspective = new THREE.PerspectiveCamera(60, 1, NEAR, FAR)
  readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, NEAR, FAR)
  /** The perspective camera's orbit pivot; what an orthographic view is centred on. */
  readonly target = new THREE.Vector3()
  projection: ViewProjection = "perspective"
  /** The orthographic zoom: resizing a pane shows more or less, it doesn't zoom. */
  cmPerPixel = 2
  width = 1
  height = 1
  /** Not framed yet: done the first time the pane is on screen, when its size is known. */
  needsFraming = true

  constructor() {
    this.perspective.position.set(1500, 1200, 1500)
    this.perspective.layers.enable(PERSPECTIVE_LAYER)
    this.orthographic.layers.enable(ORTHOGRAPHIC_LAYER)
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.view === undefined ? this.perspective : this.orthographic
  }

  get view(): OrthoView | undefined {
    return isOrthoView(this.projection) ? this.projection : undefined
  }

  /** Follows the pane's size and the FOV setting (a constant vertical FOV, so the width shows more or less). */
  resize(width: number, height: number, verticalFov: number): void {
    if (width === this.width && height === this.height && verticalFov === this.perspective.fov) return
    this.width = width
    this.height = height
    this.perspective.aspect = width / Math.max(height, 1)
    this.perspective.fov = verticalFov
    this.perspective.updateProjectionMatrix()
    this.placeOrthographic()
  }

  /** Changes what the pane looks along, keeping the point it looks at and the size it shows it at. */
  setProjection(next: ViewProjection): void {
    if (next === this.projection) return
    const { perspective, orthographic } = this
    if (!isOrthoView(next)) {
      this.projection = next
      perspective.quaternion.copy(orthographic.quaternion)
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(perspective.quaternion)
      const distance = distanceForScale(this.cmPerPixel, this.height, perspective.fov)
      perspective.position.copy(this.target).addScaledVector(back, distance)
      return
    }
    if (this.view === undefined) this.setScale(scaleForDistance(this.keepPivotAhead(), this.height, perspective.fov))
    this.projection = next
    this.placeOrthographic()
  }

  /** Puts the pivot ahead of the perspective camera if it's behind it, and answers how far along the view it is. */
  keepPivotAhead(): number {
    const { position } = this.perspective
    const forward = this.perspective.getWorldDirection(new THREE.Vector3())
    const ahead = this.target.clone().sub(position).dot(forward)
    if (ahead > 0) return ahead
    this.target.copy(position).addScaledVector(forward, ORBIT_DISTANCE)
    return ORBIT_DISTANCE
  }

  nearestView(): OrthoView {
    const direction = this.camera.getWorldDirection(new THREE.Vector3())
    return nearestOrthoView(uePoint(direction))
  }

  /** Slides an orthographic view along the screen (cm). */
  slide(right: number, up: number): void {
    const { view } = this
    if (view === undefined) return
    const axes = ORTHO_AXES[view]
    this.target.addScaledVector(gameDirToWorld(axes.right), right).addScaledVector(gameDirToWorld(axes.up), up)
    this.placeOrthographic()
  }

  /** Zooms an orthographic view by `factor` about a point in the pane (pixels from its top left, y down). */
  zoomOrthographic(factor: number, at: Px): void {
    const zoom = zoomAtPointer(this.cmPerPixel, factor, { x: at.x - this.width / 2, y: this.height / 2 - at.y })
    this.setScale(zoom.cmPerPixel)
    this.slide(zoom.right, zoom.up)
  }

  /** Frames a box (world space). */
  frame(box: THREE.Box3, minimumSpan: number): void {
    const { view } = this
    if (view === undefined) {
      const sphere = box.getBoundingSphere(new THREE.Sphere())
      const forward = this.perspective.getWorldDirection(new THREE.Vector3())
      this.target.copy(sphere.center)
      this.perspective.position.copy(sphere.center).addScaledVector(
        forward,
        -Math.max(sphere.radius * 2.5, minimumSpan)
      )
      return
    }
    const bounds = { min: uePoint(box.min), max: uePoint(box.max) }
    const { center, cmPerPixel } = orthoFraming(bounds, view, this.width, this.height, minimumSpan)
    this.target.copy(toVector(ueToThreeVector(center)))
    this.setScale(cmPerPixel)
    this.placeOrthographic()
  }

  /** Frames the whole map, from the three-quarter view a map opens on in perspective. */
  frameMap(box: THREE.Box3): void {
    if (this.view !== undefined) {
      this.frame(box, MAP_SPAN)
      return
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const radius = Math.max(sphere.radius, 1000)
    this.target.copy(sphere.center)
    this.perspective.position.copy(sphere.center).addScaledVector(FRAME_OFFSET, radius * 1.6)
    this.perspective.lookAt(sphere.center)
  }

  /** World units per pixel at `point`, for the gizmo's constant size on screen. */
  worldPerPixelAt(point: THREE.Vector3): number {
    return this.view === undefined ? worldPerPixel(this.perspective, point, this.height) : this.cmPerPixel
  }

  /** The unit vector from `point` toward the camera: the same everywhere in an orthographic view. */
  toCameraFrom(point: THREE.Vector3): THREE.Vector3 {
    const { view } = this
    return view === undefined
      ? this.perspective.position.clone().sub(point).normalize()
      : gameDirToWorld(ORTHO_AXES[view].forward).negate()
  }

  /** Where a palette piece goes (game space), `undefined` in perspective, which aims along its centre ray. */
  orthographicPlacement(floor: number): Vec3 | undefined {
    const { view } = this
    return view === undefined ? undefined : orthoPlacementPoint(uePoint(this.target), view, floor)
  }

  private setScale(cmPerPixel: number): void {
    const next = clampCmPerPixel(cmPerPixel)
    if (next === this.cmPerPixel) return
    this.cmPerPixel = next
    for (const listener of scaleListeners) listener()
  }

  /** Stands the orthographic camera off its centre, looking along the view at the zoom's extent. */
  private placeOrthographic(): void {
    const { orthographic: camera, view } = this
    camera.left = -(this.width / 2) * this.cmPerPixel
    camera.right = (this.width / 2) * this.cmPerPixel
    camera.top = (this.height / 2) * this.cmPerPixel
    camera.bottom = -(this.height / 2) * this.cmPerPixel
    camera.updateProjectionMatrix()
    if (view === undefined) return
    const axes = ORTHO_AXES[view]
    camera.up.copy(gameDirToWorld(axes.up))
    camera.position.copy(this.target).addScaledVector(gameDirToWorld(axes.forward), -ORTHO_STANDOFF)
    camera.lookAt(this.target)
    camera.updateMatrixWorld()
  }
}

const tabs = new Map<string, ReadonlyArray<PaneCamera>>()

/** Tab `tabId`'s cameras, by slot; a tab not seen yet gets fresh ones, which frame the map when they first show. */
export const paneCamerasOf = (tabId: string): ReadonlyArray<PaneCamera> => {
  const known = tabs.get(tabId)
  if (known !== undefined) return known
  const panes = Array.from({ length: 4 }, () => new PaneCamera())
  tabs.set(tabId, panes)
  return panes
}

export const forgetClosedTabs = (open: ReadonlyArray<string>): void => {
  for (const tabId of tabs.keys()) if (!open.includes(tabId)) tabs.delete(tabId)
}

export const paneCameraAt = (slot: number): PaneCamera => {
  const pane = paneCamerasOf(useEditor.getState().tabId)[slot]
  if (pane === undefined) throw new RangeError(`No pane in slot ${slot}`)
  return pane
}

/** The active pane's camera state: what the fly keys, Focus selection and Frame all act on. */
export const activePaneCamera = (): PaneCamera => paneCameraAt(useEditor.getState().activePane)

/** The whole map, from item translations so it works before meshes load; a stretch of floor when there are no items. */
export const mapBox = (): THREE.Box3 => {
  const { doc, floorHeight } = useEditor.getState()
  const box = new THREE.Box3()
  for (const item of doc.map.items) box.expandByPoint(toVector(ueToThreeVector(item.itemTransform.translation)))
  if (box.isEmpty()) box.set(new THREE.Vector3(-500, floorHeight, -500), new THREE.Vector3(500, floorHeight, 500))
  return box
}

/** A pointer over the viewport, placed in its pane. */
export interface PanePointer {
  readonly slot: number
  readonly pane: PaneCamera
  /** Pixels from the pane's top left (y down). */
  readonly px: Px
  /** The pointer in the pane's normalised device coordinates, for a raycaster. */
  readonly ndc: THREE.Vector2
}

/**
 * Where a pointer event falls among the panes on `canvas`. `pinned` keeps a drag in the pane it started in, wherever the
 * pointer has gone since.
 */
export const panePointer = (
  canvas: HTMLElement,
  e: { readonly clientX: number; readonly clientY: number },
  pinned?: number
): PanePointer => {
  const box = canvas.getBoundingClientRect()
  const { viewLayout } = useEditor.getState()
  const rects = paneRects(viewLayout, box.width, box.height)
  const x = e.clientX - box.left
  const y = e.clientY - box.top
  const rect = rects.find((r) => r.slot === pinned) ?? paneRectAt(rects, x, y)
  const px = { x: x - rect.x, y: y - rect.y }
  return {
    slot: rect.slot,
    pane: paneCameraAt(rect.slot),
    px,
    ndc: new THREE.Vector2((px.x / rect.width) * 2 - 1, -(px.y / rect.height) * 2 + 1)
  }
}
