import { IconDots } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@workspace/ui/components/dropdown-menu"
import type { DockviewGroupPanel, IDockviewPanel } from "dockview-react"
import { DOCUMENTS_PANEL } from "../../domain/dockLayout"
import {
  canCollapseGroup,
  collapseGroup,
  expandGroup,
  popOutPanel,
  resetDockLayout,
  useGroupFold,
  usePanelCheck,
  useViewMenuPanels
} from "./dockControl"

function PanelItem({ id, title }: { readonly id: string; readonly title: string }) {
  return <DropdownMenuCheckboxItem {...usePanelCheck(id)}>{title}</DropdownMenuCheckboxItem>
}

interface GroupMenuProps {
  readonly group: DockviewGroupPanel
  readonly activePanel: IDockviewPanel | undefined
}

/** Mounted only while the menu is open, so what it reads of the dock is current. */
function GroupMenuItems({ group, activePanel }: GroupMenuProps) {
  const panels = useViewMenuPanels()
  const folded = useGroupFold(group) !== undefined
  return (
    <>
      {panels.map(({ id, title }) => <PanelItem key={id} id={id} title={title} />)}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={activePanel === undefined || activePanel.id === DOCUMENTS_PANEL}
        onClick={() => activePanel !== undefined && popOutPanel(activePanel)}
      >
        Pop out
      </DropdownMenuItem>
      {folded
        ? <DropdownMenuItem onClick={() => expandGroup(group)}>Expand</DropdownMenuItem>
        : (
          <DropdownMenuItem disabled={!canCollapseGroup(group)} onClick={() => collapseGroup(group)}>
            Collapse
          </DropdownMenuItem>
        )}
      <DropdownMenuItem onClick={resetDockLayout}>Reset layout</DropdownMenuItem>
    </>
  )
}

/** The "…" at the end of a group's tab strip: which panels are open, what to do with this group, and Reset layout. */
export function GroupMenu({ group, activePanel }: GroupMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground"
            aria-label="Panels and layout"
            title="Panels and layout"
          />
        }
      >
        <IconDots className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-max min-w-40"
        finalFocus={(closeType) => closeType === "keyboard"}
      >
        <GroupMenuItems group={group} activePanel={activePanel} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
