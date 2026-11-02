import { cn } from "@workspace/ui/lib/utils"
import { type LeftTab, useEditor } from "../editor/store"
import { Palette } from "./Palette"
import { ProjectPanel } from "./ProjectPanel"

const TABS: ReadonlyArray<{ readonly id: LeftTab; readonly label: string }> = [
  { id: "pieces", label: "Pieces" },
  { id: "project", label: "Project" }
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
      <div role="tablist" aria-label="Left panel" className="flex shrink-0 gap-1 border-b px-2 pt-1">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn(
              "-mb-px border-b-2 px-1 py-1 text-[0.65rem] font-semibold tracking-wider uppercase outline-none",
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
