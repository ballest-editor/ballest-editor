/** The open ends the snap overlay rings (docs/SNAPPING.md § What a drag looks like), where the pieces show. */
import type { CatalogIndex } from "../../domain/Catalog"
import { endsOf, openEndsOf, type WorldEnd } from "../../domain/connectors"
import { editTransform } from "../../domain/editTransform"
import type { SnapConfig } from "../../domain/snapConfig"
import type { Doc } from "../../domain/structure"
import type { EditorState } from "../store"

type ShowOpenEnds = SnapConfig["targets"]["connectors"]["showOpenEnds"]

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

/**
 * The open ends to ring, as the pieces show: every one, none, or on hover the hovered item's and, in a drag, those of what
 * it carries, the ends about to join. The end a drag will join is the target's mark, not one of these.
 */
export const ringedEnds = (
  s: Pick<EditorState, "catalogIndex" | "doc" | "preview" | "hoveredItem">,
  show: ShowOpenEnds,
  docEnds: ReadonlyArray<WorldEnd> = endsInDoc(s.doc, s.catalogIndex)
): ReadonlyArray<WorldEnd> => {
  if (show === "never") return []
  const open = openEndsOf(shownEnds(s, docEnds))
  if (show === "always") return open
  const { hoveredItem, preview } = s
  return open.filter(({ ref }) => ref.item === hoveredItem || preview?.has(ref.item) === true)
}
