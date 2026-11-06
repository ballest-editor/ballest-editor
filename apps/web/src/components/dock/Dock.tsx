import { IconArrowsMinimize } from "@tabler/icons-react"
import { PortalContainerContext } from "@workspace/ui/lib/portal-container"
import {
  DockviewReact,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps
} from "dockview-react"
import "dockview-react/dist/styles/dockview.css"
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from "react"
import { DOCUMENTS_PANEL } from "../../domain/dockLayout"
import { Viewport } from "../../editor/Viewport"
import { closesOnMiddleClick, DocumentTabs } from "../DocumentTabs"
import { EditorSkeletonPanels } from "../EditorSkeleton"
import { ViewportControls } from "../ViewControls"
import "./dock.css"
import { attachDock, expandGroup, isCentreGroup, useGroupFold } from "./dockControl"
import { followDockDrags } from "./dragImage"
import { GroupMenu, StripButton } from "./GroupMenu"
import { dockPanels } from "./panels"

const dockTheme: DockviewTheme = { name: "ballest", className: "dockview-theme-ballest" }

/** The centre group's panel: the map tabs are in its header (`CentreTabs`), so this is only the viewport. */
const DocumentsPanel = () => <Viewport controls={ViewportControls} />

/**
 * What a panel renders in: it fills its tab, its popups go to the window it's in, and it renders afresh coming back to
 * the main window (`returns`), as its elements belong to the window that went (docs/DESKTOP.md § Dock).
 */
function PanelFrame({ api, children }: { readonly api: IDockviewPanelProps["api"]; readonly children: ReactNode }) {
  const [panelWindow, setPanelWindow] = useState(() => api.getWindow())
  const [returns, setReturns] = useState(0)
  useEffect(() => {
    const listener = api.onDidLocationChange(() => {
      const next = api.getWindow()
      setPanelWindow(next)
      if (next === window) setReturns((count) => count + 1)
    })
    return () => listener.dispose()
  }, [api])
  return (
    <PortalContainerContext value={panelWindow === window ? undefined : panelWindow.document.body}>
      <div key={returns} className="h-full min-w-0 overflow-hidden bg-card">{children}</div>
    </PortalContainerContext>
  )
}

const inFrame = (Panel: ComponentType<IDockviewPanelProps>) => (props: IDockviewPanelProps) => (
  <PanelFrame api={props.api}>
    <Panel {...props} />
  </PanelFrame>
)

const dockComponents = {
  [DOCUMENTS_PANEL]: DocumentsPanel,
  ...Object.fromEntries(dockPanels.map((panel) => [panel.id, inFrame(panel.component)]))
}

/** A panel's tab. Panels open and close from the View menu and a group's "…", so it has no ×. */
function DockTab({ api, containerApi }: IDockviewPanelHeaderProps) {
  const expand = () => {
    const group = containerApi.getPanel(api.id)?.group
    if (group !== undefined) expandGroup(group)
  }
  return (
    <div
      className="dock-tab flex h-full min-w-0 items-center px-2.5 text-eyebrow"
      onClick={expand}
      {...closesOnMiddleClick(() => api.close())}
    >
      <span className="truncate">{api.title}</span>
    </div>
  )
}

/** The centre group's own tab is hidden: `DocumentTabs` stands in for it, and dock.css takes this tab out of the strip. */
const HiddenTab = () => <span data-dock-hidden-tab />

const dockTabComponents = { hidden: HiddenTab }

/** The map tabs, in the centre group's strip. */
function CentreTabs({ group }: IDockviewHeaderActionsProps) {
  return isCentreGroup(group) ? <DocumentTabs /> : null
}

/** The end of a group's strip: its "…", or in a popped-out window the way back. A rail has neither. */
function GroupActions({ group, activePanel, location }: IDockviewHeaderActionsProps) {
  const fold = useGroupFold(group)
  if (fold === "width") return null
  return (
    <div className="flex h-full items-center px-1">
      {location?.type === "popout"
        ? (
          <StripButton label="Back to the main window" onClick={() => group.api.getWindow().close()}>
            <IconArrowsMinimize className="size-3.5" />
          </StripButton>
        )
        : <GroupMenu group={group} activePanel={activePanel} />}
    </div>
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
    <div ref={box} className="relative min-h-0 flex-1">
      <DockviewReact
        className="h-full"
        theme={dockTheme}
        components={dockComponents}
        tabComponents={dockTabComponents}
        defaultTabComponent={DockTab}
        prefixHeaderActionsComponent={CentreTabs}
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
