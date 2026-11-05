import type { DockviewPanelRenderer, IDockviewPanelProps } from "dockview-react"
import { type ComponentType, useEffect, useState } from "react"
import type { DockPanelSpec } from "../../domain/dockLayout"
import { Inspector } from "../Inspector"
import { Outline } from "../Outline"
import { Palette } from "../Palette"
import { ProjectPanel } from "../ProjectPanel"
import { SettingsPanel } from "../SettingsPanel"

export interface DockPanel extends DockPanelSpec {
  readonly component: ComponentType<IDockviewPanelProps>
  /** Below this the panel's group can't be dragged narrower. */
  readonly minimumWidth?: number
  /** `always` keeps the panel in the page behind another tab, so a long list keeps its scroll position. */
  readonly renderer?: DockviewPanelRenderer
}

/** Settings' `visible` follows the tab: it looks the game up again each time it comes into view. */
function DockedSettings({ api }: IDockviewPanelProps) {
  const [visible, setVisible] = useState(api.isVisible)
  useEffect(() => {
    const listener = api.onDidVisibilityChange((event) => setVisible(event.isVisible))
    return () => listener.dispose()
  }, [api])
  return <SettingsPanel visible={visible} />
}

/**
 * Every dock panel. Adding one is an entry here: it gets a tab, a View menu item (unless it lives in the centre), a place
 * in the default layout, and on the next launch a place in layouts saved before it existed. Order is the order of the
 * tabs in a group; the last one of a group starts in front.
 */
export const dockPanels: ReadonlyArray<DockPanel> = [
  { id: "project", title: "Project", location: "left", component: ProjectPanel, minimumWidth: 180 },
  { id: "pieces", title: "Pieces", location: "left", component: Palette, minimumWidth: 180, renderer: "always" },
  { id: "outline", title: "Outline", location: "left", component: Outline, minimumWidth: 180, renderer: "always" },
  { id: "inspector", title: "Inspector", location: "right", component: Inspector, minimumWidth: 220 },
  { id: "settings", title: "Settings", location: "centre", component: DockedSettings, startsClosed: true }
]
