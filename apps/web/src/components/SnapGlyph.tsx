import type { SnapRelation } from "../domain/snapFrame"
import { GLYPHS, RELATION_NAMES } from "../editor/snap/snapGlyphs"

/**
 * A snap's kind as a small icon, the same glyph the scene draws beside the landing (docs/SNAPPING.md § Snap indications),
 * in the text's colour.
 */
export function SnapGlyph({ relation }: { readonly relation: SnapRelation }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      role="img"
      aria-label={RELATION_NAMES[relation]}
      data-snap-glyph={relation}
    >
      {GLYPHS[relation].map((stroke) => {
        if ("line" in stroke) {
          const [x1, y1, x2, y2] = stroke.line
          return <line key={`line ${stroke.line.join()}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        }
        if ("circle" in stroke) {
          const [cx, cy, r] = stroke.circle
          return <circle key={`circle ${stroke.circle.join()}`} cx={cx} cy={cy} r={r} />
        }
        const [cx, cy, r] = stroke.dot
        return <circle key={`dot ${stroke.dot.join()}`} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
      })}
    </svg>
  )
}
