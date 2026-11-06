import { IconDots } from "@tabler/icons-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  togglePanel,
  useClosedPanels,
  useGroupFold
} from "./dockControl"
import { StripButton } from "./StripButton"

interface GroupMenuProps {
  readonly group: DockviewGroupPanel
  readonly activePanel: IDockviewPanel | undefined
}

/** What can be done with the panel in front and its group. The centre group's panel has none of it. */
function PanelActions({ group, panel }: { readonly group: DockviewGroupPanel; readonly panel: IDockviewPanel }) {
  const folded = useGroupFold(group) !== undefined
  return (
    <>
      <DropdownMenuItem onClick={() => popOutPanel(panel)}>Pop out</DropdownMenuItem>
      {folded
        ? <DropdownMenuItem onClick={() => expandGroup(group)}>Expand</DropdownMenuItem>
        : (
          <DropdownMenuItem disabled={!canCollapseGroup(group)} onClick={() => collapseGroup(group)}>
            Collapse
          </DropdownMenuItem>
        )}
      <DropdownMenuItem onClick={() => panel.api.close()}>Close panel</DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  )
}

/** Mounted only while the menu is open, so what it reads of the dock is current. */
function GroupMenuItems({ group, activePanel }: GroupMenuProps) {
  const closed = useClosedPanels()
  return (
    <>
      {activePanel !== undefined && activePanel.id !== DOCUMENTS_PANEL && (
        <PanelActions group={group} panel={activePanel} />
      )}
      {closed.length > 0 && (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Panels</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {closed.map(({ id, title }) => (
              <DropdownMenuItem key={id} onClick={() => togglePanel(id)}>{title}</DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      <DropdownMenuItem onClick={resetDockLayout}>Reset layout</DropdownMenuItem>
    </>
  )
}

/** The "…" at the end of a group's tab strip: what to do with this view, the panels that are closed, and Reset layout. */
export function GroupMenu({ group, activePanel }: GroupMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<StripButton label="Panel actions" />}>
        <IconDots />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-max min-w-40" finalFocus={(closeType) => closeType === "keyboard"}>
        <GroupMenuItems group={group} activePanel={activePanel} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
