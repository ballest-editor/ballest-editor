import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import type { ComponentType, ReactNode } from "react"
import { selectionPrefabProblem, startSavePrefab } from "../editor/actions"
import { useEditor } from "../editor/store"

/**
 * Save selection as prefab… in a menu. While the game would refuse the selection whatever the name, it is off and its
 * tooltip gives the game's words. A disabled item takes no pointer, so the tooltip hangs on a wrapper. Mounted only
 * while its menu is open, so a selection isn't looked through on every change to the store.
 */
export function SavePrefabItem({ item: Item }: {
  readonly item: ComponentType<{
    readonly children: ReactNode
    readonly disabled: boolean
    readonly onClick: () => void
  }>
}) {
  const problem = useEditor(selectionPrefabProblem)
  const item = <Item disabled={problem !== undefined} onClick={startSavePrefab}>Save selection as prefab…</Item>
  return problem === undefined ? item : (
    <Tooltip>
      <TooltipTrigger render={<div />}>{item}</TooltipTrigger>
      <TooltipContent side="right">{problem}</TooltipContent>
    </Tooltip>
  )
}
