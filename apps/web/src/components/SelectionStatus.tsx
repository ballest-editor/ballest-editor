import { useMemo } from "react"
import { selectionSummaryOf } from "../domain/groupSelection"
import { nodeNamesOf, useEditor } from "../editor/store"
import { Ordinal } from "./Ordinal"

/** At the left of the status bar: what is selected, named as the Outline names it. Nothing with nothing selected. */
export function SelectionStatus() {
  const doc = useEditor((s) => s.doc)
  const selectedIds = useEditor((s) => s.selectedIds)
  const catalog = useEditor((s) => s.catalogIndex)
  const summary = useMemo(
    () => selectionSummaryOf(doc.structure.tree, selectedIds, nodeNamesOf({ doc, catalogIndex: catalog })),
    [doc, selectedIds, catalog]
  )
  if (summary === null) return null
  return (
    <span className="min-w-0 truncate text-fg-secondary">
      {summary.name}
      {summary.ordinal !== undefined && " "}
      <Ordinal value={summary.ordinal} />
    </span>
  )
}
