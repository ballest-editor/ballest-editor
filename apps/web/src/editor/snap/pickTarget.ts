/**
 * The one target picker (docs/SNAPPING.md § Tools built on the targets): what a hover or a click under the pointer finds,
 * by the same targets, priority and highlights as a drag. A pick is a drag of nothing: a base that sits under the pointer
 * with no move on it, so whatever the drag would have landed on is what it picks.
 */
import type { WorldEnd } from "../../domain/connectors"
import type { Vec3 } from "../../domain/coords"
import type { SnapConfig } from "../../domain/snapConfig"
import { rayOnPlane, type ScreenPoint, type SnapFrame, type SnapHit } from "../../domain/snapFrame"
import { resolveSnap } from "../../domain/snapResolve"
import { annotationsOf } from "../../domain/structure"
import { ORIGIN, vecAdd, vecScale } from "../../domain/ueMath"
import type { PaneCamera } from "../paneCameras"
import { editedKeys, type EditorState, pickableOf, type PickedTarget, type PickerRequest, snapConfigOf } from "../store"
import { snapCasts, snapItemsOf } from "./snapScene"
import { snapViewOf } from "./snapView"

const UP: Vec3 = { x: 0, y: 0, z: 1 }

/** How far along the ray the base sits when the ray misses the floor: on the pixel all the same. */
const FALLBACK_CM = 1000

const NO_END: WorldEnd = { ref: { item: "", end: 0 }, position: ORIGIN, forward: UP, up: UP, profile: "" }

/** What a pick can be: a tool's, or `anchor`, what tracking acquires: only a point of a piece. */
type Accepts = PickerRequest["accepts"] | "anchor"

/** The config a pick asks with: every target it can use on, nothing turned, and only what the tool takes. */
const pickingConfig = (config: SnapConfig, accepts: Accepts): SnapConfig => {
  const onlyFaces = accepts === "face" || accepts === "faceOrEnd"
  const anchor = accepts === "anchor"
  const { connectors, mesh } = config.targets
  return {
    ...config,
    magnet: true,
    targets: {
      ...config.targets,
      grid: { ...config.targets.grid, enabled: !onlyFaces && !anchor && config.targets.grid.enabled },
      construction: { enabled: !anchor && config.targets.construction.enabled },
      tracking: { ...config.targets.tracking, enabled: !anchor && config.targets.tracking.enabled },
      connectors: { ...connectors, enabled: accepts !== "face", matchRotation: false },
      mesh: {
        ...mesh,
        enabled: true,
        rotateToFace: "keep",
        offset: 0,
        elements: onlyFaces
          ? {
            boundsCorners: false,
            boundsFaceCentres: false,
            boundsFaces: true,
            vertices: false,
            sharpEdges: false,
            edgeMidpoints: false,
            faceCentres: false,
            faces: true
          }
          : mesh.elements
      },
      alignment: { ...config.targets.alignment, enabled: false }
    }
  }
}

/** The items a pick for `picker` goes through: none, or for a pick that must be pickable, what a click can't pick. */
export const pickerSkips = (s: EditorState, picker: PickerRequest): ReadonlySet<string> => {
  if (picker.pickable !== true) return new Set()
  const pickable = pickableOf(s)
  return new Set(s.doc.ids.filter((key) => !pickable(key)))
}

/** What's under `px`, as the tool `accepts` it. */
export const hitUnder = (
  s: EditorState,
  pane: PaneCamera,
  px: ScreenPoint,
  accepts: Accepts,
  except: ReadonlySet<string> = new Set()
): SnapHit | undefined => {
  const config = pickingConfig(snapConfigOf(s), accepts)
  const view = snapViewOf(pane)
  const items = snapItemsOf(s, except, config.targets.mesh.sharpAngle)
  const casts = snapCasts(items, pane, view)
  const ray = view.rayAt(px)
  const start = rayOnPlane(ray, { x: 0, y: 0, z: s.floorHeight }, UP) ??
    vecAdd(ray.origin, vecScale(ray.direction, FALLBACK_CM))
  const { construction, measurements } = annotationsOf(s.doc.structure)
  const frame: SnapFrame = {
    config,
    // Any end will do for a pick, and none is offered its twin.
    prefs: { ...s.settings.snapPrefs, profiles: "any", flipToFit: false },
    view,
    items,
    constraint: { kind: "surface", normal: UP },
    pointer: px,
    offset: ORIGIN,
    slip: { x: 0, y: 0 },
    bases: [{ start, label: "Pointer", end: { ...NO_END, position: start } }],
    box: { min: start, max: start },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    units: s.settings.general.units,
    tracked: s.tracked,
    construction,
    measurements,
    surfaceAt: casts.surfaceAt,
    occluded: casts.occluded
  }
  return resolveSnap(frame)
}

/** The point a resting pointer acquires, leaving out `moving`: not the selection's, which a drag would only meet itself on. */
export const anchorUnder = (
  s: EditorState,
  pane: PaneCamera,
  px: ScreenPoint,
  moving: ReadonlySet<string>
): SnapHit | undefined => {
  const hit = hitUnder(s, pane, px, "anchor", moving)
  // a point to go through, not a face, which is only ever under the pointer
  return hit?.rank === 0 && (hit.item === undefined || !editedKeys(s).includes(hit.item)) ? hit : undefined
}

/** A hit as a tool takes it. */
export const pickedOf = (s: EditorState, hit: SnapHit): PickedTarget => {
  const key = hit.meeting?.other
  const item = key === undefined ? hit.item : key.item
  const end = key === undefined ? undefined : endOf(s, key.item, key.end)
  const { held } = hit
  return {
    point: hit.landing,
    label: hit.label,
    ...(item !== undefined && { item }),
    ...(end !== undefined && { end, normal: end.forward }),
    ...(held.shape === "plane" && { normal: held.normal }),
    ...(held.shape === "line" && { direction: held.direction })
  }
}

const endOf = (s: EditorState, key: string, end: number): WorldEnd | undefined =>
  snapItemsOf(s, new Set(), snapConfigOf(s).targets.mesh.sharpAngle).find((item) => item.key === key)?.ends[end]
