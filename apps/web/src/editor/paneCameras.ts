/**
 * The cameras behind the view panes (docs/DESKTOP.md § View panes): plain three.js state, because they change on every
 * pointer move. Each map tab has one `PaneCamera` per slot, so a tab keeps its views, and a slot keeps its own while a
 * smaller layout hides it. What a pane looks along and where it sits are the store's (`viewLayout`); this follows.
 */
import * as THREE from "three"
import { threeToUeVector, ueToThreeVector, type Vec3 } from "../domain/coords"
import { DEFAULT_PLAYER_START } from "../domain/level"
import {
  clampCmPerPixel,
  distanceForScale,
  mixFov,
  nearestOrthoView,
  ORTHO_AXES,
  orthoAxesOf,
  orthoFraming,
  orthoPlacementPoint,
  scaleForDistance,
  zoomAtPointer
} from "../domain/orthoView"
import { placeDistanceFor, type PlacementView } from "../domain/placement"
import type { ScreenAxes } from "../domain/viewGizmo"
import {
  isOrthoView,
  type OrthoView,
  type PaneChange,
  paneRectAt,
  paneRects,
  type ViewProjection,
  type ViewRoll
} from "../domain/viewLayout"
import { gameDirToWorld, type Px, worldPerPixel } from "./gizmo/math"
import { shownOf, useEditor } from "./store"

const layerOf = (layer: number): THREE.Layers => {
  const layers = new THREE.Layers()
  layers.set(layer)
  return layers
}

/** What only one kind of camera sees: the sky, the floor grid, and the world grid. Layer 0 is everything else. */
const PERSPECTIVE_LAYER = 1
const ORTHOGRAPHIC_LAYER = 2
const FLOOR_GRID_LAYER = 3
export const perspectiveOnly = layerOf(PERSPECTIVE_LAYER)
export const orthographicOnly = layerOf(ORTHOGRAPHIC_LAYER)
export const floorGridOnly = layerOf(FLOOR_GRID_LAYER)

const NEAR = 5
const FAR = 2_000_000
/** An orthographic camera stands this far back, so the whole map is in front of it whatever it is centred on. */
const ORTHO_STANDOFF = FAR / 2
/** The pivot ahead of a perspective camera that has none in front of it. */
const ORBIT_DISTANCE = 1500
const FRAME_OFFSET = new THREE.Vector3(-1, 0.8, 1).normalize()
/** How long a pane takes to change what it looks along (ms), before Settings › Appearance scales it. */
export const VIEW_TWEEN_MS = 150
/** The field of view an orthographic view eases to or from: narrow enough that the last frame's step can't be seen. */
const FLAT_FOV = 5
/** The least a focused pane shows (cm), so one small piece doesn't fill it. */
export const FOCUS_SPAN = 300
/** The same for a map with nothing in it, or nearly. */
const MAP_SPAN = 2000

/** Just short of straight up or down, where turning about the world's up would spin the picture. */
export const clampPitch = (pitch: number): number =>
  THREE.MathUtils.clamp(pitch, -Math.PI / 2 + 0.001, Math.PI / 2 - 0.001)

const toVector = (v: Vec3) => new THREE.Vector3(v.x, v.y, v.z)
const uePoint = (v: THREE.Vector3): Vec3 => threeToUeVector({ x: v.x, y: v.y, z: v.z })

/** A view as the eye takes it: what it centres on, how it is turned, the size it shows that at, and how flat it is. */
interface ViewPose {
  readonly centre: THREE.Vector3
  readonly quaternion: THREE.Quaternion
  readonly cmPerPixel: number
  readonly fov: number
}

const mixPoses = (from: ViewPose, to: ViewPose, t: number): ViewPose => ({
  centre: from.centre.clone().lerp(to.centre, t),
  quaternion: from.quaternion.clone().slerp(to.quaternion, t),
  cmPerPixel: from.cmPerPixel * (to.cmPerPixel / from.cmPerPixel) ** t,
  fov: mixFov(from.fov, to.fov, t)
})

/** One slot's view of a map: both its cameras, and which is in use. */
export class PaneCamera {
  readonly perspective = new THREE.PerspectiveCamera(60, 1, NEAR, FAR)
  readonly orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, NEAR, FAR)
  /**
   * What draws the pane while it eases to a new view. The two above are already there, so picking and the gizmo never
   * wait on the picture. It sees the map and the grid of the view it's heading for, so the grid never drops out; the
   * dome stands around the perspective camera, so it's left out.
   */
  private readonly tweenCamera = new THREE.PerspectiveCamera(60, 1, NEAR, FAR)
  /** Where the picture is on its way to the view; `undefined` when it's there. */
  private tween: { readonly from: ViewPose; shown: ViewPose; startedAt: number | undefined } | undefined
  /** The perspective camera's orbit pivot; what an orthographic view is centred on. */
  readonly target = new THREE.Vector3()
  projection: ViewProjection = "perspective"
  /** How far an orthographic view's picture is rolled; 0 in perspective. */
  roll: ViewRoll = 0
  /** The orthographic zoom: resizing a pane shows more or less, it doesn't zoom. */
  cmPerPixel = 2
  width = 1
  height = 1
  /** Not framed yet: done the first time the pane is on screen, when its size is known. */
  needsFraming = true

  constructor() {
    this.perspective.position.set(1500, 1200, 1500)
    this.perspective.layers.enable(PERSPECTIVE_LAYER)
    this.perspective.layers.enable(FLOOR_GRID_LAYER)
    this.orthographic.layers.enable(ORTHOGRAPHIC_LAYER)
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.view === undefined ? this.perspective : this.orthographic
  }

  get view(): OrthoView | undefined {
    return isOrthoView(this.projection) ? this.projection : undefined
  }

  /** What the pane draws with: `camera`, but for the moments it eases to a new view. */
  get drawCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.tween === undefined ? this.camera : this.tweenCamera
  }

  /** Whether the picture is still on its way to the view. */
  get easing(): boolean {
    return this.tween !== undefined
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

  /**
   * Changes what the pane looks along, or how far an orthographic view is rolled, keeping the point it looks at and the
   * size it shows it at. The cameras are there at once and the picture eases after them (`stepTween`), unless the pane
   * hasn't been shown yet or `ease` says not to. Perspective is always level: a rolled view opens into it upright.
   */
  setProjection(next: ViewProjection, ease = true, roll: ViewRoll = 0): void {
    if (next === this.projection && roll === this.roll) return
    const from = this.tween?.shown ?? this.pose()
    if (ease && !this.needsFraming) this.tween = { from, shown: from, startedAt: undefined }
    const { perspective, orthographic, tweenCamera } = this
    tweenCamera.layers.set(0)
    tweenCamera.layers.enable(isOrthoView(next) ? ORTHOGRAPHIC_LAYER : FLOOR_GRID_LAYER)
    if (!isOrthoView(next)) {
      this.projection = next
      this.roll = 0
      // looking straight down or up, three.js gives the roll to the yaw, so a rolled top view keeps its heading
      const level = new THREE.Euler().setFromQuaternion(orthographic.quaternion, "YXZ")
      perspective.quaternion.setFromEuler(level.set(level.x, level.y, 0))
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(perspective.quaternion)
      const distance = distanceForScale(this.cmPerPixel, this.height, perspective.fov)
      perspective.position.copy(this.target).addScaledVector(back, distance)
      return
    }
    if (this.view === undefined) this.setScale(scaleForDistance(this.keepPivotAhead(), this.height, perspective.fov))
    this.projection = next
    this.roll = roll
    this.placeOrthographic()
  }

  /**
   * Takes the store's view for the pane. Arriving at an orthographic view from perspective frames the map, as a pane
   * first shown there does, because a perspective pane's zoom is only how far off its pivot happens to be. Between
   * orthographic views the zoom stays. The picture eases to all of it.
   */
  followProjection(next: ViewProjection, roll: ViewRoll = 0): void {
    const framing = this.view === undefined && isOrthoView(next)
    this.setProjection(next, true, roll)
    if (framing) this.frameMap(mapBox())
  }

  /**
   * Moves the picture along its way to the view, `durationMs` from when it first steps; a change of view eases out like
   * the chrome does (docs/design/ui-system.md § Motion). It heads for where the pane is now, so a drag or a wheel notch
   * on the way isn't lost.
   */
  stepTween(now: number, durationMs: number): void {
    const { tween } = this
    if (tween === undefined) return
    tween.startedAt ??= now
    const t = durationMs > 0 ? (now - tween.startedAt) / durationMs : 1
    if (t >= 1) {
      this.tween = undefined
      return
    }
    tween.shown = mixPoses(tween.from, this.pose(), 1 - (1 - t) ** 3)
    const { centre, quaternion, cmPerPixel, fov } = tween.shown
    const camera = this.tweenCamera
    const distance = distanceForScale(cmPerPixel, this.height, fov)
    camera.fov = fov
    camera.aspect = this.width / Math.max(this.height, 1)
    camera.far = FAR + distance // a flat view stands well back, however far out the pane is zoomed
    camera.updateProjectionMatrix()
    camera.quaternion.copy(quaternion)
    camera.position.copy(centre).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion), distance)
  }

  /**
   * Turns the pane about its pivot by `yaw` around the world's up and `pitch` around the screen's right (radians), for a
   * drag on the axis gizmo. An orthographic view opens into perspective where it stands, with no easing: the picture
   * stays with the pointer. The pivot keeps its place in the picture, off centre or not, so a drag starts without a jump.
   */
  orbit(yaw: number, pitch: number): void {
    if (this.view !== undefined) this.setProjection("perspective", false)
    this.keepPivotAhead()
    const { perspective: camera, target } = this
    const before = camera.quaternion.clone()
    const { x, y } = new THREE.Euler().setFromQuaternion(before, "YXZ")
    camera.quaternion.setFromEuler(new THREE.Euler(clampPitch(x + pitch), y + yaw, 0, "YXZ"))
    const turn = before.invert().premultiply(camera.quaternion)
    camera.position.sub(target).applyQuaternion(turn).add(target)
  }

  /** Which way the pane's picture runs in the game's axes, as it's drawn now. */
  screenAxes(): ScreenAxes {
    const { quaternion } = this.drawCamera
    const axis = (x: number, y: number, z: number) => uePoint(new THREE.Vector3(x, y, z).applyQuaternion(quaternion))
    return { right: axis(1, 0, 0), up: axis(0, 1, 0), toward: axis(0, 0, 1) }
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
    const axes = orthoAxesOf(view, this.roll)
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
    const { center, cmPerPixel } = orthoFraming(bounds, view, this.width, this.height, minimumSpan, this.roll)
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

  /**
   * Where a palette piece goes (game space) for a point in the view, by default its centre; `undefined` in perspective,
   * which aims along a ray.
   */
  orthographicPlacement(floor: number, at: THREE.Vector3 = this.target): Vec3 | undefined {
    const { view } = this
    return view === undefined ? undefined : orthoPlacementPoint(uePoint(at), view, floor)
  }

  /** How far from the perspective camera a piece with this footprint may land: `base`, or further to fit a big one. */
  placeDistance(footprint: number, base: number): number {
    const { aspect, fov } = this.perspective
    const vertical = THREE.MathUtils.degToRad(fov)
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect)
    return placeDistanceFor(footprint, Math.min(vertical, horizontal), base)
  }

  /** Where this pane looks from and how it is turned, for laying out placements. */
  placementView(): PlacementView {
    const { camera } = this
    camera.updateMatrixWorld()
    const axis = (x: number, y: number) => uePoint(new THREE.Vector3(x, y, 0).applyQuaternion(camera.quaternion))
    return {
      position: uePoint(camera.position),
      right: axis(1, 0),
      up: axis(0, 1),
      project: (point) => {
        const { x, y, z } = toVector(ueToThreeVector(point)).project(camera)
        return { x, y, z }
      }
    }
  }

  /** The view as it stands. */
  private pose(): ViewPose {
    const { perspective, orthographic, cmPerPixel } = this
    if (this.view !== undefined) {
      return {
        centre: this.target.clone(),
        quaternion: orthographic.quaternion.clone(),
        cmPerPixel,
        fov: FLAT_FOV
      }
    }
    const ahead = this.keepPivotAhead()
    return {
      centre: perspective.position.clone().addScaledVector(perspective.getWorldDirection(new THREE.Vector3()), ahead),
      quaternion: perspective.quaternion.clone(),
      cmPerPixel: scaleForDistance(ahead, this.height, perspective.fov),
      fov: perspective.fov
    }
  }

  private setScale(cmPerPixel: number): void {
    this.cmPerPixel = clampCmPerPixel(cmPerPixel)
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
    const axes = orthoAxesOf(view, this.roll)
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

/** Splits or closes panes in the current tab: each pane that stays keeps its camera as well as its view. */
export const changePanes = (change: PaneChange): void => {
  const { tabId, applyPaneChange } = useEditor.getState()
  const panes = paneCamerasOf(tabId)
  tabs.set(tabId, change.order.flatMap((slot) => panes[slot] ?? []))
  applyPaneChange(change)
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

/**
 * The whole map as drawn, from item translations so it works before meshes load. With no items, a stretch of floor at the default
 * start, where a definition's frame is: what a new prefab's first pieces go down around.
 */
export const mapBox = (): THREE.Box3 => {
  const s = useEditor.getState()
  const { doc, floorHeight } = s
  const shown = shownOf(s)
  // what is drawn, as Blender's View All; a map with nothing drawn frames all of it, so the view isn't left nowhere
  const framed = doc.map.items.filter((_, i) => shown(doc.ids[i] ?? ""))
  const box = new THREE.Box3()
  for (const item of framed.length > 0 ? framed : doc.map.items) {
    box.expandByPoint(toVector(ueToThreeVector(item.itemTransform.translation)))
  }
  if (box.isEmpty()) {
    box.setFromCenterAndSize(
      toVector(ueToThreeVector({ ...DEFAULT_PLAYER_START, z: floorHeight })),
      new THREE.Vector3(1000, 0, 1000)
    )
  }
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
