import type { DockviewPanelRenderer, IDockviewPanelProps } from "dockview-react"
import type { ComponentType } from "react"
import type { DockLocation } from "../../domain/dockLayout"
import { Inspector } from "../Inspector"
import { Outline } from "../Outline"
import { Palette } from "../Palette"
import { PrefabsPanel } from "../PrefabsPanel"
import { ProjectPanel } from "../ProjectPanel"

export interface DockPanel {
  readonly id: string
  readonly title: string
  readonly location: DockLocation
  readonly component: ComponentType<IDockviewPanelProps>
  /** Below this the panel's group can't be dragged narrower; 180 when absent. */
  readonly minimumWidth?: number
  /** `always` keeps the panel in the page behind another tab, so a long list keeps its scroll position. */
  readonly renderer?: DockviewPanelRenderer
}

/** Every dock panel (docs/DESKTOP.md § Dock), in the order of a group's tabs. The last of a group starts in front. */
export const dockPanels: ReadonlyArray<DockPanel> = [
  { id: "project", title: "Project", location: "left", component: ProjectPanel },
  { id: "pieces", title: "Pieces", location: "left", component: Palette, renderer: "always" },
  { id: "prefabs", title: "Prefabs", location: "left", component: PrefabsPanel },
  { id: "outline", title: "Outline", location: "left", component: Outline, renderer: "always" },
  { id: "inspector", title: "Inspector", location: "right", component: Inspector, minimumWidth: 220 }
]
