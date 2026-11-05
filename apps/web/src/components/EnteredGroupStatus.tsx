import { IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { useMemo } from "react"
import { groupTrail } from "../domain/groupSelection"
import { useEditor } from "../editor/store"

/** In the status bar while a group is entered: where clicks reach, and the way out. */
export function EnteredGroupStatus() {
  const tree = useEditor((s) => s.doc.structure.tree)
  const enteredGroupId = useEditor((s) => s.enteredGroupId)
  const enterGroup = useEditor((s) => s.enterGroup)
  const trail = useMemo(() => groupTrail(tree, enteredGroupId), [tree, enteredGroupId])
  if (trail.length === 0) return null
  const names = trail.map((group) => group.name).join(" › ")
  return (
    <div className="flex min-w-0 items-center gap-1 text-muted-foreground" title={names}>
      <span className="truncate">
        In group <span className="text-foreground">{names}</span>
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Leave the group"
        title="Leave the group"
        onClick={() => enterGroup(null)}
      >
        <IconX />
      </Button>
    </div>
  )
}
