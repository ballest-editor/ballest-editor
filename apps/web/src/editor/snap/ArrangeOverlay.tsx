/**
 * The preview of the Align or Distribute button under the pointer (docs/SNAPPING.md § Align and distribute), in snapping's
 * colours (§ Snap indications): what moves in the source's violet, where each unit lands as a filled box with the face
 * that lines up, and that face where it starts; what they line up on in the target's amber, the active unit's face; and
 * the plane they meet on and the gaps Distribute makes equal as guides. Nothing moves until the button is pressed.
 */
import { useEffect, useMemo } from "react"
import { cornersOf } from "../../domain/snapRelation"
import { type BoxAxis, boxFace } from "../../domain/snapTools"
import { rotateVec, vecLerp } from "../../domain/ueMath"
import { arrangePlanOf } from "../actions"
import { useBeforePaneDraw } from "../PaneRenderer"
import { useEditor } from "../store"
import { SNAP_COLORS as COLORS } from "./snapGlyphs"
import { MarkLayer } from "./SnapOverlay"

/** How strongly each is filled: a landing box lightly, so the pieces read through it; the faces that line up more. */
const LANDING = 0.16
const FACE_FROM = 0.22
const FACE_TO = 0.45
const REFERENCE = 0.45
const PLANE = 0.05
/** Where a path ends, in pixels. */
const PATH_END = 8

const BOX_AXES: ReadonlyArray<BoxAxis> = ["x", "y", "z"]

export function ArrangeOverlay() {
  const op = useEditor((s) => s.arrangeHover)
  const doc = useEditor((s) => s.doc)
  const selectedIds = useEditor((s) => s.selectedIds)
  const space = useEditor((s) => s.gizmoSpace)
  const spacing = useEditor((s) => s.arrangeSpacing)
  const catalogIndex = useEditor((s) => s.catalogIndex)
  const units = useEditor((s) => s.settings.general.units)
  const layer = useMemo(() => new MarkLayer(), [])

  const plan = useMemo(
    () => op === null ? undefined : arrangePlanOf(useEditor.getState(), op),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the store values the plan is built from, read inside
    [op, doc, selectedIds, space, spacing, catalogIndex]
  )

  useEffect(() => {
    layer.reset()
    if (op === null || plan === undefined || plan.moving === 0) return
    const { frame, marks } = plan
    const world = (corners: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }>) =>
      corners.map((corner) => rotateVec(frame, corner))
    if (marks.plane !== undefined) {
      const plane = marks.plane
      layer.face(plane, COLORS.guide, PLANE)
      plane.forEach((corner, i) => layer.dashedLine(corner, plane[(i + 1) % plane.length] ?? corner, COLORS.guide))
    }
    for (const landing of marks.landings) {
      for (const axis of BOX_AXES) {
        for (const side of ["min", "max"] as const) {
          layer.face(world(boxFace(landing, axis, side)), COLORS.source, LANDING)
        }
      }
      layer.box(world(cornersOf(landing)), COLORS.source)
    }
    for (const { from, to } of marks.faces) {
      layer.face(from, COLORS.source, FACE_FROM, 1)
      layer.outline(from, COLORS.source, 1)
      layer.face(to, COLORS.source, FACE_TO, 1)
      layer.outline(to, COLORS.source, 1)
    }
    if (marks.reference !== undefined) {
      layer.face(marks.reference, COLORS.target, REFERENCE, 2)
      layer.outline(marks.reference, COLORS.target, 2)
    }
    for (const { from, to } of marks.paths) {
      layer.line(from, to, COLORS.source, 2)
      layer.dot(to, COLORS.source, PATH_END)
    }
    for (const { cm, from, to } of marks.dimensions) {
      layer.edge(from, to, COLORS.guide, 2)
      const length = Math.abs(cm)
      layer.label(vecLerp(from, to, 0.5), units === "m" ? `${(length / 100).toFixed(2)} m` : `${Math.round(length)} cm`)
    }
  }, [layer, op, plan, units])

  useBeforePaneDraw((pane) => layer.fit((point) => pane.worldPerPixelAt(point), pane.camera))
  useEffect(() => () => layer.reset(), [layer])
  return <primitive object={layer} />
}
