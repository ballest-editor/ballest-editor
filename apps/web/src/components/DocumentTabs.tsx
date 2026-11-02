import { IconX } from "@tabler/icons-react"
import { closeMapTab } from "../editor/actions"
import { useEditor, useOpenMapLabel } from "../editor/store"

/**
 * The document tabs over the viewport (docs/PROJECTS.md § Shell): the open map's (one map at a time for now). There is
 * always a map; closing the tab shows a fresh unsaved one, as New map would.
 */
export function DocumentTabs() {
  const dirty = useEditor((s) => s.dirty)
  const path = useEditor((s) => s.file?.path ?? null)
  const label = useOpenMapLabel()

  return (
    <div role="tablist" aria-label="Documents" className="flex h-8 shrink-0 items-stretch border-b bg-card text-xs">
      <div
        className="group flex h-full max-w-56 items-center gap-1 border-r bg-background px-2 text-foreground"
        title={path ?? undefined}
      >
        <button type="button" role="tab" aria-selected className="flex min-w-0 items-center gap-1.5 outline-none">
          <span className="truncate">{label}</span>
          {dirty && <span className="size-1.5 shrink-0 rounded-full bg-foreground/60" aria-label="unsaved changes" />}
        </button>
        <button
          type="button"
          aria-label={`Close ${label}`}
          className="rounded-sm p-0.5 opacity-60 hover:bg-muted hover:opacity-100"
          onClick={() =>
            void closeMapTab()}
        >
          <IconX className="size-3" />
        </button>
      </div>
    </div>
  )
}
