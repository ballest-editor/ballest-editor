import { IconX } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"
import { closeMapTab } from "../editor/actions"
import { useEditor, useOpenMapLabel } from "../editor/store"

function Tab(
  { active, label, onSelect, onClose, children }: {
    readonly active: boolean
    readonly label: string
    readonly onSelect: () => void
    /** Absent: the tab can't be closed now. */
    readonly onClose?: (() => void) | undefined
    readonly children: ReactNode
  }
) {
  return (
    <div
      className={cn(
        "group flex h-full max-w-56 items-center gap-1 border-r px-2",
        active ? "bg-background text-foreground" : "text-muted-foreground hover:bg-muted/60"
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className="flex min-w-0 items-center gap-1.5 outline-none"
        onClick={onSelect}
      >
        {children}
      </button>
      {onClose !== undefined && (
        <button
          type="button"
          aria-label={`Close ${label}`}
          className="rounded-sm p-0.5 opacity-60 hover:bg-muted hover:opacity-100"
          onClick={onClose}
        >
          <IconX className="size-3" />
        </button>
      )}
    </div>
  )
}

/**
 * The document tabs over the viewport (docs/PROJECTS.md § Shell): Start, then the open map's (one map at a time for
 * now). Closing the map's tab shows Start; Start closes only while a map is open.
 */
export function DocumentTabs() {
  const startOpen = useEditor((s) => s.startOpen)
  const mapOpen = useEditor((s) => s.mapOpen)
  const activeTab = useEditor((s) => s.activeTab)
  const dirty = useEditor((s) => s.dirty)
  const showStart = useEditor((s) => s.showStart)
  const closeStart = useEditor((s) => s.closeStart)
  const showMapTab = useEditor((s) => s.showMapTab)
  const label = useOpenMapLabel()

  return (
    <div role="tablist" aria-label="Documents" className="flex h-8 shrink-0 items-stretch border-b bg-card text-xs">
      {startOpen && (
        <Tab
          active={activeTab === "start"}
          label="Start"
          onSelect={showStart}
          onClose={mapOpen ? closeStart : undefined}
        >
          Start
        </Tab>
      )}
      {mapOpen && (
        <Tab
          active={activeTab === "map"}
          label={label}
          onSelect={showMapTab}
          onClose={() => void closeMapTab()}
        >
          <span className="truncate">{label}</span>
          {dirty && <span className="size-1.5 shrink-0 rounded-full bg-foreground/60" aria-label="unsaved changes" />}
        </Tab>
      )}
    </div>
  )
}
