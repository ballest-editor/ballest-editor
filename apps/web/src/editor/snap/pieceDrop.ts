/**
 * A piece on its way out of the palette (docs/SNAPPING.md § Placement from the palette): a drag like any other, with its
 * base at the piece's Bottom pivot, or its first end with Connectors on, sitting under the pointer.
 */
import type { CatalogPiece } from "../../domain/Catalog"
import { endsOf } from "../../domain/connectors"
import type { Vec3 } from "../../domain/coords"
import { itemFromPiece, placementTransform } from "../../domain/factory"
import { applyGroupDelta } from "../../domain/groupTransform"
import { placedBoxOf } from "../../domain/itemBounds"
import type { ItemTransform } from "../../domain/MapFile"
import { localToWorld, pivotFor } from "../../domain/pivot"
import type { ScreenPoint, SnapFrame, SnapHit, SnapItem } from "../../domain/snapFrame"
import { shownMarks } from "../../domain/snapRelation"
import { moveOf, resolveSnap } from "../../domain/snapResolve"
import { selectionBases } from "../../domain/snapTools"
import { annotationsOf, type Doc } from "../../domain/structure"
import { ORIGIN, vecSub } from "../../domain/ueMath"
import { placeSnapped } from "../actions/placement"
import type { PaneCamera } from "../paneCameras"
import { type EditorState, snapConfigOf, type TransformOptions, useEditor } from "../store"
import { endSnapDisplay, feedbackOf, setFeedback } from "./moveSession"
import { snapMarks } from "./snapMarks"
import { snapCasts, snapItemsOf } from "./snapScene"
import { snapViewOf } from "./snapView"

/** Targets are worked out once for the document in view: a drag asks on every event, and it can't change under one. */
let targets: { readonly doc: Doc; readonly items: ReadonlyArray<SnapItem> } | undefined

const targetsOf = (s: EditorState, sharpAngle: number) => {
  if (targets?.doc !== s.doc) targets = { doc: s.doc, items: snapItemsOf(s, new Set(), sharpAngle) }
  return targets.items
}

export interface SnappedDrop {
  readonly transform: ItemTransform
  readonly hit: SnapHit
  readonly options: TransformOptions
}

/** Where `piece` lands with the pointer at `free`; undefined when snapping is off, and it lands as it would have. */
export const snappedDrop = (
  s: EditorState,
  piece: CatalogPiece,
  pane: PaneCamera,
  px: ScreenPoint,
  free: Vec3,
  invert: boolean
): SnappedDrop | undefined => {
  const config = snapConfigOf(s)
  if (config.enabled === invert) return undefined
  const transform = placementTransform(piece, ORIGIN)
  const item = itemFromPiece(piece, transform)
  const pivot = localToWorld(transform, pivotFor(item, s.catalogIndex, "Bottom")?.localPosition ?? ORIGIN)
  const box = placedBoxOf([{ item, transform }], s.catalogIndex) ?? { min: pivot, max: pivot }
  const ends = endsOf("new", item, transform, s.catalogIndex).slice(0, 1)
  const bases = selectionBases({ ...config, base: "pivot" }, { pivot, box, ends })
  const [base] = bases
  if (base === undefined) return undefined
  const view = snapViewOf(pane)
  const items = targetsOf(s, config.targets.mesh.sharpAngle)
  const casts = snapCasts(items, pane, view)
  const { construction, measurements } = annotationsOf(s.doc.structure)
  const frame: SnapFrame = {
    config,
    prefs: s.settings.snapPrefs,
    view,
    items,
    constraint: { kind: "surface", normal: { x: 0, y: 0, z: 1 } },
    pointer: px,
    offset: vecSub(free, base.start),
    slip: { x: 0, y: 0 },
    bases,
    box,
    rotation: transform.rotation,
    units: s.settings.general.units,
    tracked: s.tracked,
    construction,
    measurements,
    surfaceAt: casts.surfaceAt,
    occluded: casts.occluded
  }
  const hit = resolveSnap(frame)
  if (hit === undefined) return undefined
  const { about, offset, rotation } = moveOf(hit)
  const delta = rotation === undefined
    ? { kind: "translate", offset } as const
    : { kind: "rigid", rotation, about, offset } as const
  const placed = applyGroupDelta(transform, ORIGIN, delta)
  return {
    transform: { ...transform, translation: { ...placed.translation }, rotation: { ...placed.rotation } },
    hit,
    options: { connected: hit.meeting !== undefined }
  }
}

/**
 * Lands `piece` dropped with the pointer at `free`: where snapping puts it, else `otherwise` places it. The acquired tracking
 * points go once it has, as after a drag's landing.
 */
export const landDrop = (
  piece: CatalogPiece,
  pane: PaneCamera,
  px: ScreenPoint,
  free: Vec3,
  invert: boolean,
  otherwise: () => void
): void => {
  const snapped = snappedDrop(useEditor.getState(), piece, pane, px, free, invert)
  endSnapDisplay()
  if (snapped !== undefined) placeSnapped(piece, snapped.transform, snapped.options)
  else otherwise()
  useEditor.getState().clearTracked()
}

/** Shows where a drop would land. */
export const showDrop = (drop: SnappedDrop | undefined): void => {
  snapMarks.set(drop === undefined ? [] : shownMarks(drop.hit), undefined)
  setFeedback(feedbackOf(drop?.hit))
}
