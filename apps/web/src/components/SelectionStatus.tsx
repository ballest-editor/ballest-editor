import { useMemo } from "react"
import { selectionSummaryOf } from "../domain/groupSelection"
import { nodeNamesOf, useEditor } from "../editor/store"
import { Ordinal } from "./Ordinal"

/** At the left of the status bar: what is selected, named as the Outline names it. Nothing with nothing selected. */
export function SelectionStatus() {
  const doc = useEditor((s) => s.doc)
  const selectedIds = useEditor((s) => s.selectedIds)
  const enteredGroupId = useEditor((s) => s.enteredGroupId)
  const catalog = useEditor((s) => s.catalogIndex)
  // the names change with the map, not the selection: a click doesn't name every item again
  const names = useMemo(() => nodeNamesOf({ doc, catalogIndex: catalog }), [doc, catalog])
  const summary = useMemo(
    () => selectionSummaryOf(doc.structure.tree, selectedIds, enteredGroupId, names),
    [doc, selectedIds, enteredGroupId, names]
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
