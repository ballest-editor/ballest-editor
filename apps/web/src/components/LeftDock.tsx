import { cn } from "@workspace/ui/lib/utils"
import { type LeftTab, useEditor } from "../editor/store"
import { Palette } from "./Palette"
import { ProjectPanel } from "./ProjectPanel"

const TABS: ReadonlyArray<{ readonly id: LeftTab; readonly label: string }> = [
  { id: "project", label: "Project" },
  { id: "pieces", label: "Pieces" }
]

/**
 * The left side panel: a tab strip over the piece palette and the Project panel (docs/PROJECTS.md § Shell). Both stay
 * mounted, so the palette keeps its search and open sections while the project is in front.
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
      <div className={cn("min-h-0 flex-1", tab !== "pieces" && "hidden")}>
        <Palette />
      </div>
      <div className={cn("min-h-0 flex-1", tab !== "project" && "hidden")}>
        <ProjectPanel />
      </div>
    </div>
  )
}
