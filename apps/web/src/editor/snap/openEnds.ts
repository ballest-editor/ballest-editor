/** The open ends the snap overlay rings (docs/SNAPPING.md § Connectors), where the pieces show. */
import type { CatalogIndex } from "../../domain/Catalog"
import { endsOf, openEndsOf, type WorldEnd } from "../../domain/connectors"
import { editTransform } from "../../domain/editTransform"
import type { MarkRole } from "../../domain/snapFrame"
import type { SnapPrefs } from "../../domain/snapPrefs"
import type { Doc } from "../../domain/structure"
import { type EditorState, shownOf } from "../store"

type ShowOpenEnds = SnapPrefs["showOpenEnds"]

/** Every end in the map, where the document has them. */
export const endsInDoc = (doc: Doc, index: CatalogIndex | null): ReadonlyArray<WorldEnd> =>
  doc.map.items.flatMap((item, i) => {
    const key = doc.ids[i]
    return key === undefined
      ? []
      : endsOf(key, item, editTransform(item), index, doc.structure.items.get(key)?.connectAt)
  })

/** `docEnds` with those of the items in a drag's preview where the preview has them. */
const shownEnds = (
  { catalogIndex, doc, preview }: Pick<EditorState, "catalogIndex" | "doc" | "preview">,
  docEnds: ReadonlyArray<WorldEnd>
): ReadonlyArray<WorldEnd> => {
  if (preview === null || preview.size === 0) return docEnds
  const moved = [...preview].flatMap(([key, transform]) => {
    const item = doc.map.items[doc.ids.indexOf(key)]
    return item === undefined ? [] : endsOf(key, item, transform, catalogIndex, doc.structure.items.get(key)?.connectAt)
  })
  return [...docEnds.filter(({ ref }) => !preview.has(ref.item)), ...moved]
}

/** An open end to ring, and whose it is: the selection's in a drag, or another item's. */
export type RingedEnd = WorldEnd & { readonly role: MarkRole }

/**
 * The open ends to ring, as the pieces show: every one, none, or on hover the hovered item's and, in a drag, those of what
 * it carries and those near them it could join. What a drag carries is the source's, the rest the target's. A drag that
 * Connectors isn't snapping rings none, and a hidden piece's are never rung. The end a drag will join is the target's
 * mark, not one of these.
 */
export const ringedEnds = (
  s: Pick<EditorState, "catalogIndex" | "doc" | "preview" | "hoveredItem" | "dragSnap" | "isolation">,
  show: ShowOpenEnds,
  docEnds: ReadonlyArray<WorldEnd> = endsInDoc(s.doc, s.catalogIndex)
): ReadonlyArray<RingedEnd> => {
  const { dragSnap, hoveredItem, preview } = s
  if (show === "never" || dragSnap?.targets.includes("connectors") === false) return []
  // an end met by a hidden piece is still met: only the ringing leaves hidden pieces out
  const drawn = shownOf(s)
  const open = openEndsOf(shownEnds(s, docEnds)).filter((end) => drawn(end.ref.item))
  const near = (end: WorldEnd) =>
    dragSnap?.nearEnds.some(({ end: index, item }) => item === end.ref.item && index === end.ref.end) === true
  const shown = show === "always"
    ? open
    : open.filter((end) => end.ref.item === hoveredItem || preview?.has(end.ref.item) === true || near(end))
  return shown.map((end) => ({ ...end, role: preview?.has(end.ref.item) === true ? "source" : "target" }))
}
