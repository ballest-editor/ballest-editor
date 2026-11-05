import { IconArrowsMinimize, IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
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
import { DocumentTabs } from "../DocumentTabs"
import { EditorSkeletonPanels } from "../EditorSkeleton"
import { ViewportControls } from "../ViewControls"
import "./dock.css"
import { attachDock, expandGroup, isCentreGroup, useGroupFold } from "./dockControl"
import { followDockDrags } from "./dragImage"
import { GroupMenu } from "./GroupMenu"
import { dockPanels } from "./panels"

const dockTheme: DockviewTheme = { name: "ballest", className: "dockview-theme-ballest" }

/** The centre group's panel: the map tabs are in its header (`CentreTabs`), so this is only the viewport. */
function DocumentsPanel() {
  return (
    <div className="relative h-full">
      <Viewport controls={ViewportControls} />
    </div>
  )
}

/**
 * What a panel renders in: it fills its tab, and its popups go to the window it's in (`PortalContainerContext`). Elements
 * made while it's popped out belong to that window, whose `Element` nothing here recognises and which goes away, so a
 * panel coming back to the main window renders afresh (`returns`). That costs it its local state, such as a search.
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

/**
 * A panel's tab. Only what lives in the centre has a ×: the rest open and close from the View menu and a group's "…",
 * and Settings is in neither, wherever it was dragged.
 */
function DockTab({ api, containerApi }: IDockviewPanelHeaderProps) {
  const closable = dockPanels.find((panel) => panel.id === api.id)?.location === "centre"
  const expand = () => {
    const group = containerApi.getPanel(api.id)?.group
    if (group !== undefined) expandGroup(group)
  }
  return (
    <div
      className="dock-tab"
      onClick={expand}
      onAuxClick={(e) => {
        if (e.button === 1) api.close()
      }}
      // a middle press would otherwise start autoscroll
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
    >
      <span className="truncate">{api.title}</span>
      {closable && (
        <button
          type="button"
          aria-label={`Close ${api.title}`}
          className="dock-tab-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            api.close()
          }}
        >
          <IconX className="size-3" />
        </button>
      )}
    </div>
  )
}

/** The centre group's own tab is hidden: `DocumentTabs` stands in for it, and dock.css takes this tab out of the strip. */
const HiddenTab = () => <span data-dock-hidden-tab />

const dockTabComponents = { hidden: HiddenTab }

/** The map tabs, ahead of any other tab in the centre group (Settings). */
function CentreTabs({ group }: IDockviewHeaderActionsProps) {
  return isCentreGroup(group) ? <DocumentTabs /> : null
}

/**
 * What a group's strip holds at its end: its "…", or in a popped-out window the way back. A rail is only its panels'
 * titles.
 */
function GroupActions({ group, activePanel, location }: IDockviewHeaderActionsProps) {
  const fold = useGroupFold(group)
  if (fold === "width") return null
  const back = "Back to the main window"
  return (
    <div className="dock-actions">
      {location?.type === "popout"
        ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground"
            aria-label={back}
            title={back}
            onClick={() => group.api.getWindow().close()}
          >
            <IconArrowsMinimize className="size-3.5" />
          </Button>
        )
        : <GroupMenu group={group} activePanel={activePanel} />}
    </div>
  )
}

/**
 * The window between the top bar and the status bar (docs/DESKTOP.md § Dock): the centre group, the map tabs over the
 * viewport, and the panels around it. A dock has no size until its first effect, so the skeleton stays over it until
 * the layout is in: the first paint is the saved layout, not a flash of an empty dock.
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
