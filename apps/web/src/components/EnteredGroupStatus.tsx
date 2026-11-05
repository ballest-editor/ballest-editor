import { IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Fragment, useMemo } from "react"
import { groupTrail } from "../domain/groupSelection"
import { groupNames, numberedNameText } from "../domain/structure"
import { useEditor } from "../editor/store"
import { Ordinal } from "./Ordinal"

/** In the status bar while a group is entered: where clicks reach, and the way out. */
export function EnteredGroupStatus() {
  const tree = useEditor((s) => s.doc.structure.tree)
  const enteredGroupId = useEditor((s) => s.enteredGroupId)
  const enterGroup = useEditor((s) => s.enterGroup)
  const names = useMemo(() => {
    const numbered = groupNames(tree)
    return groupTrail(tree, enteredGroupId).flatMap((group) => {
      const name = numbered.get(group.id)
      return name === undefined ? [] : [{ id: group.id, ...name }]
    })
  }, [tree, enteredGroupId])
  if (names.length === 0) return null
  return (
    <div
      className="flex min-w-0 items-center gap-1 text-muted-foreground"
      title={names.map(numberedNameText).join(" › ")}
    >
      <span className="truncate">
        In group {names.map(({ id, name, ordinal }, i) => (
          <Fragment key={id}>
            {i > 0 && " › "}
            <span className="text-foreground">{name}</span>
            {ordinal !== undefined && " "}
            <Ordinal value={ordinal} />
          </Fragment>
        ))}
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
