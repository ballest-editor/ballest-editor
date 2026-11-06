import { IconArrowLeft, IconX } from "@tabler/icons-react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "@workspace/ui/components/breadcrumb"
import { Button } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { Fragment, useMemo } from "react"
import { groupTrail } from "../domain/groupSelection"
import { formatBinding } from "../domain/Keybinds"
import { groupNames, numberedNameText } from "../domain/structure"
import { useEditor } from "../editor/store"
import { Ordinal } from "./Ordinal"

/** The groups from the root down to the entered one, named as the Outline names them; empty when none is entered. */
const useEnteredTrail = () => {
  const tree = useEditor((s) => s.doc.structure.tree)
  const enteredGroupId = useEditor((s) => s.enteredGroupId)
  return useMemo(() => {
    const numbered = groupNames(tree)
    return groupTrail(tree, enteredGroupId).flatMap((group) => {
      const name = numbered.get(group.id)
      return name === undefined ? [] : [{ id: group.id, ...name }]
    })
  }, [tree, enteredGroupId])
}

/** At the top of the Outline while a group is entered: where clicks reach, and the way back up. */
export function EnteredGroupBreadcrumb() {
  const trail = useEnteredTrail()
  const enterGroup = useEditor((s) => s.enterGroup)
  const deselect = useEditor((s) => s.deselect)
  const binding = useEditor((s) => s.keybinds.deselect[0])
  if (trail.length === 0) return null
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b px-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-fg-secondary"
              aria-label="Up one level"
              onClick={() => deselect()}
            />
          }
        >
          <IconArrowLeft />
        </TooltipTrigger>
        <TooltipContent>
          Up one level
          {binding !== undefined && <Kbd>{formatBinding(binding)}</Kbd>}
        </TooltipContent>
      </Tooltip>
      <Breadcrumb className="min-w-0 flex-1" title={trail.map(numberedNameText).join(" › ")}>
        <BreadcrumbList className="flex-nowrap gap-1">
          <BreadcrumbItem className="shrink-0">
            <BreadcrumbLink render={<button type="button" />} onClick={() => enterGroup(null)}>Root</BreadcrumbLink>
          </BreadcrumbItem>
          {trail.map(({ id, name, ordinal }, i) => (
            <Fragment key={id}>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                {i === trail.length - 1
                  ? <BreadcrumbPage className="min-w-0 truncate">{name}</BreadcrumbPage>
                  : (
                    <BreadcrumbLink
                      render={<button type="button" />}
                      className="min-w-0 truncate"
                      onClick={() => enterGroup(id)}
                    >
                      {name}
                    </BreadcrumbLink>
                  )}
                <Ordinal value={ordinal} />
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  )
}

/** In the status bar while a group is entered: where clicks reach, and the way out. */
export function EnteredGroupStatus() {
  const names = useEnteredTrail()
  const enterGroup = useEditor((s) => s.enterGroup)
  if (names.length === 0) return null
  return (
    <div
      className="flex min-w-0 items-center gap-1 text-fg-secondary"
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
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Leave the group"
              onClick={() => enterGroup(null)}
            />
          }
        >
          <IconX />
        </TooltipTrigger>
        <TooltipContent>Leave the group</TooltipContent>
      </Tooltip>
    </div>
  )
}
