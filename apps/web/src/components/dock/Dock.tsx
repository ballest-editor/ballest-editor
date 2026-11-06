import { IconArrowsMinimize, IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { PortalContainerContext } from "@workspace/ui/lib/portal-container"
import {
  type DockviewGroupPanelApi,
  type DockviewPanelApi,
  DockviewReact,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps
} from "dockview-react"
import "dockview-react/dist/styles/dockview.css"
import { type ComponentType, useEffect, useRef, useState } from "react"
import { DOCUMENTS_PANEL } from "../../domain/dockLayout"
import { Viewport } from "../../editor/Viewport"
import { DocumentTabs } from "../DocumentTabs"
import { EditorSkeletonPanels } from "../EditorSkeleton"
import { onMiddleClick } from "../middleClick"
import { ViewportControls } from "../ViewControls"
import "./dock.css"
import { attachDock, expandGroup, isCentreGroup, togglePanel, useClosedPanelsIn, useGroupFold } from "./dockControl"
import { followDockDrags } from "./dragImage"
import { GroupMenu } from "./GroupMenu"
import { dockPanels } from "./panels"
import { StripButton } from "./StripButton"

const dockTheme: DockviewTheme = { name: "ballest", className: "dockview-theme-ballest" }

/** The centre group's panel: the map tabs are in its header (`CentreTabs`), so this is only the viewport. */
const DocumentsPanel = () => <Viewport controls={ViewportControls} />

/** The window a panel or group is in, and how many times it has come back to the main one. */
function useDockWindow(api: DockviewPanelApi | DockviewGroupPanelApi) {
  const [dockWindow, setDockWindow] = useState(() => api.getWindow())
  const [returns, setReturns] = useState(0)
  useEffect(() => {
    const listener = api.onDidLocationChange(() => {
      const next = api.getWindow()
      setDockWindow(next)
      if (next === window) setReturns((count) => count + 1)
    })
    return () => listener.dispose()
  }, [api])
  return { portalContainer: dockWindow === window ? undefined : dockWindow.document.body, returns }
}

/**
 * What a panel renders in: it fills its tab, its popups go to the window it's in, and it renders afresh coming back to
 * the main window (`returns`), as its elements belong to the window that went (docs/DESKTOP.md § Dock).
 */
const inFrame = (Panel: ComponentType<IDockviewPanelProps>) =>
  function PanelFrame(props: IDockviewPanelProps) {
    const { portalContainer, returns } = useDockWindow(props.api)
    return (
      <PortalContainerContext value={portalContainer}>
        <div key={returns} className="h-full min-w-0 overflow-hidden bg-card">
          <Panel {...props} />
        </div>
      </PortalContainerContext>
    )
  }

const dockComponents = {
  [DOCUMENTS_PANEL]: DocumentsPanel,
  ...Object.fromEntries(dockPanels.map((panel) => [panel.id, inFrame(panel.component)]))
}

/**
 * A panel's tab: its icon, and while the strip has room for its title (dock.css), the title and a place for the × that
 * shows under the pointer, so hovering moves nothing. A tab down to its icon has no ×: the icon is all there is to click
 * to pick the tab. The tooltip stands in for a title the strip has hidden, and a rail keeps the title alone.
 */
function DockTab({ api, containerApi }: IDockviewPanelHeaderProps) {
  const { portalContainer } = useDockWindow(api)
  const [named, setNamed] = useState(false)
  const title = useRef<HTMLSpanElement>(null)
  const Icon = dockPanels.find((panel) => panel.id === api.id)?.icon
  const expand = () => {
    const group = containerApi.getPanel(api.id)?.group
    if (group !== undefined) expandGroup(group)
  }
  return (
    <PortalContainerContext value={portalContainer}>
      <Tooltip open={named} onOpenChange={(open) => setNamed(open && title.current?.checkVisibility() === false)}>
        <TooltipTrigger
          render={
            <div
              className="dock-tab group flex h-full min-w-0 items-center gap-1 px-2 text-body"
              onClick={expand}
              {...onMiddleClick(() => api.close())}
            />
          }
        >
          {Icon !== undefined && <Icon className="dock-tab-icon size-4 shrink-0" />}
          <span ref={title} className="dock-tab-title truncate">{api.title}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="dock-tab-close -mr-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={`Close ${api.title}`}
            // dockview would make the tab active first, and a click on the tab unfolds its group
            onPointerDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              api.close()
            }}
          >
            <IconX />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{api.title}</TooltipContent>
      </Tooltip>
    </PortalContainerContext>
  )
}

/** The centre group's own tab is hidden: `DocumentTabs` stands in for it, and dock.css takes this tab out of the strip. */
const HiddenTab = () => <span data-dock-hidden-tab />

const dockTabComponents = { hidden: HiddenTab }

/** The map tabs, in the centre group's strip. */
function CentreTabs({ group }: IDockviewHeaderActionsProps) {
  return isCentreGroup(group) ? <DocumentTabs /> : null
}

/** The panels that are closed and would come back in `group`, dimmed. One click reopens each. */
function ClosedPanels({ group }: Pick<IDockviewHeaderActionsProps, "group">) {
  const closed = useClosedPanelsIn(group)
  if (closed.length === 0) return null
  return (
    <div className="flex h-full items-center gap-2 px-1">
      {closed.map(({ id, title, icon: Icon }) => (
        <StripButton
          key={id}
          label={`Open ${title}`}
          className="dock-closed-tab text-fg-disabled"
          onClick={() => togglePanel(id)}
        >
          <Icon />
        </StripButton>
      ))}
    </div>
  )
}

/** After a panel strip's tabs: its closed panels, where the tabs left them. The centre's go at its end (`GroupActions`). */
function TabsEnd({ group }: IDockviewHeaderActionsProps) {
  return isCentreGroup(group) ? null : <ClosedPanels group={group} />
}

/** The end of a group's strip: its "…", or in a popped-out window the way back. A rail has neither. */
function GroupActions({ group, activePanel, location }: IDockviewHeaderActionsProps) {
  const fold = useGroupFold(group)
  const { portalContainer } = useDockWindow(group.api)
  if (fold === "width") return null
  return (
    <PortalContainerContext value={portalContainer}>
      <div className="flex h-full">
        {isCentreGroup(group) && <ClosedPanels group={group} />}
        <div className="flex items-center px-1">
          {location?.type === "popout"
            ? (
              <StripButton label="Back to the main window" onClick={() => group.api.getWindow().close()}>
                <IconArrowsMinimize />
              </StripButton>
            )
            : <GroupMenu group={group} activePanel={activePanel} />}
        </div>
      </div>
    </PortalContainerContext>
  )
}

/**
 * Everything between the top bar and the status bar (docs/DESKTOP.md § Dock). A dock has no size until its first effect,
 * so the skeleton stays over it until the layout is in: the first paint is the saved layout, not an empty dock.
 */
export function Dock() {
  const [ready, setReady] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => followDockDrags(document), [])
  return (
    // `isolate` keeps dockview's z-indexes in here: its sashes (99) would otherwise take clicks from a menu over them (50)
    <div ref={box} className="relative isolate min-h-0 flex-1">
      <DockviewReact
        className="h-full"
        theme={dockTheme}
        components={dockComponents}
        tabComponents={dockTabComponents}
        defaultTabComponent={DockTab}
        prefixHeaderActionsComponent={CentreTabs}
        leftHeaderActionsComponent={TabsEnd}
        rightHeaderActionsComponent={GroupActions}
        disableFloatingGroups
        disableTabsOverflowList
        proportionalLayout={false}
        onReady={({ api }) => {
          // Dockview measures itself a frame later, and a saved layout read at no size stays crushed.
          const { width, height } = box.current?.getBoundingClientRect() ?? { width: 0, height: 0 }
          api.layout(width, height)
          attachDock(api, dockPanels)
          setReady(true)
        }}
      />
      {!ready && <EditorSkeletonPanels className="absolute inset-0 z-10" />}
    </div>
  )
}
