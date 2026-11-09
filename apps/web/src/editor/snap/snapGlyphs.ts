/**
 * The snap indication language (docs/SNAPPING.md § Snap indications): a colour for each side of a snap, and a glyph
 * for each kind. The scene draws a glyph beside the landing and the label draws the same one before its words, both from
 * the strokes here, in a 24-unit box with y down as an icon's.
 */
import type { MarkRole, SnapRelation } from "../../domain/snapFrame"
import { SCENE_ROLES } from "../sceneColors"

/**
 * What snapping draws in the scene, by what each thing is, in the scene's roles (`SCENE_ROLES`, sceneColors.ts): the
 * selection's side in its amber, what it lands on in the pointer's cyan, what it is measured by in violet.
 */
export const SNAP_COLORS = {
  /** What the selection landed on. */
  target: SCENE_ROLES.dark.pointer,
  /** The part of the selection that landed. */
  source: SCENE_ROLES.dark.selected,
  /** The base, while nothing is in range. */
  base: "#ffffff",
  /** A side's whole box, about the faces of it that snapped. */
  box: "#b4bac2",
  /** A plane or line inferred from the scene: alignment, a tracking line off the axes. */
  guide: SCENE_ROLES.dark.reference,
  /** The map's own construction planes and lines. */
  construction: SCENE_ROLES.dark.reference,
  /** A measured length, a dimension's line. */
  measurement: "#ffffff"
} as const

export const roleColor = (role: MarkRole): string => SNAP_COLORS[role]

export type GlyphStroke =
  | { readonly line: readonly [number, number, number, number] }
  | { readonly circle: readonly [number, number, number] }
  | { readonly dot: readonly [number, number, number] }

/** A glyph's words, for the label's icon and the docs. */
export const RELATION_NAMES: Readonly<Record<SnapRelation, string>> = {
  coincident: "Coincident",
  onEdge: "On edge",
  midpoint: "Midpoint",
  centre: "Center",
  onFace: "On face",
  flush: "Flush",
  tangent: "Tangent",
  perpendicular: "Perpendicular",
  aligned: "Aligned",
  inLine: "In line",
  intersection: "Intersection",
  join: "Join",
  grid: "Grid",
  gap: "Gap"
}

const line = (x1: number, y1: number, x2: number, y2: number): GlyphStroke => ({ line: [x1, y1, x2, y2] })

/** Each kind of snap's glyph. */
export const GLYPHS: Readonly<Record<SnapRelation, ReadonlyArray<GlyphStroke>>> = {
  coincident: [{ dot: [12, 12, 4.5] }],
  onEdge: [line(3, 12, 21, 12), line(3, 8, 3, 16), line(21, 8, 21, 16), { dot: [12, 12, 3] }],
  midpoint: [line(12, 5, 20, 19), line(20, 19, 4, 19), line(4, 19, 12, 5)],
  centre: [{ circle: [12, 12, 8] }, line(12, 3, 12, 21), line(3, 12, 21, 12)],
  onFace: [line(5, 5, 19, 5), line(19, 5, 19, 19), line(19, 19, 5, 19), line(5, 19, 5, 5), { dot: [12, 12, 2.5] }],
  flush: [line(4, 9, 20, 9), line(4, 15, 20, 15)],
  tangent: [{ circle: [12, 9, 6] }, line(3, 15, 21, 15)],
  perpendicular: [line(4, 19, 20, 19), line(12, 19, 12, 4), line(12, 15, 16, 15), line(16, 15, 16, 19)],
  aligned: [line(6, 19, 12, 5), line(12, 19, 18, 5)],
  inLine: [line(2, 12, 6, 12), line(10, 12, 14, 12), line(18, 12, 22, 12)],
  intersection: [line(5, 5, 19, 19), line(19, 5, 5, 19)],
  join: [{ circle: [8, 12, 5] }, line(13, 12, 21, 12), line(17, 8, 21, 12), line(17, 16, 21, 12)],
  grid: [line(8, 4, 8, 20), line(16, 4, 16, 20), line(4, 8, 20, 8), line(4, 16, 20, 16)],
  gap: [
    line(4, 6, 4, 18),
    line(20, 6, 20, 18),
    line(4, 12, 20, 12),
    line(4, 12, 8, 9),
    line(4, 12, 8, 15),
    line(20, 12, 16, 9),
    line(20, 12, 16, 15)
  ]
}

/** How many straight pieces make a circle. */
const CIRCLE_SEGMENTS = 24

/** A glyph's lines and circles as straight segments, for what can only draw those. */
export const glyphSegments = (
  strokes: ReadonlyArray<GlyphStroke>
): ReadonlyArray<readonly [number, number, number, number]> =>
  strokes.flatMap((stroke) => {
    if ("line" in stroke) return [stroke.line]
    if ("dot" in stroke) return []
    const [cx, cy, r] = stroke.circle
    const at = (i: number) => {
      const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2
      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as const
    }
    return Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => [...at(i), ...at(i + 1)] as const)
  })
