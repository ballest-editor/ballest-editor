import { cn } from "@workspace/ui/lib/utils"
import type { ComponentType } from "react"
import { type LeftTab, useEditor } from "../editor/store"
import { Outline } from "./Outline"
import { Palette } from "./Palette"
import { ProjectPanel } from "./ProjectPanel"

const TABS: ReadonlyArray<{ readonly id: LeftTab; readonly label: string; readonly Panel: ComponentType }> = [
  { id: "project", label: "Project", Panel: ProjectPanel },
  { id: "pieces", label: "Pieces", Panel: Palette },
  { id: "outline", label: "Outline", Panel: Outline }
]

/**
 * The left side panel: a tab strip over the Project panel, the piece palette and the Outline (docs/PROJECTS.md § Shell).
 * All stay mounted, so each keeps its search, its open sections and its scroll while another is in front.
 */
export function LeftDock() {
  const tab = useEditor((s) => s.leftTab)
  const setTab = useEditor((s) => s.setLeftTab)
  return (
    <div className="flex h-full min-w-0 flex-col bg-card">
      {/* the same height as the document tabs, so the two strips line up across the window */}
      <div role="tablist" aria-label="Left panel" className="flex h-8 shrink-0 items-stretch border-b px-2">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn(
              "-mb-px border-b-2 px-2 text-[0.65rem] font-semibold tracking-wider uppercase outline-none",
              tab === id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {TABS.map(({ id, Panel }) => (
        <div key={id} className={cn("min-h-0 flex-1", tab !== id && "hidden")}>
          <Panel />
        </div>
      ))}
    </div>
  )
}
