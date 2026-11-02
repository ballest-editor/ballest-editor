import { useEditor, useOpenMapLabel } from "../editor/store"

/**
 * The document tabs over the viewport (docs/PROJECTS.md § Shell): the open map's (one map at a time for now). There is
 * always a map, so the only tab has no close: New map or the Project panel replace it. The dot marks a map with
 * unsaved edits, or one not saved anywhere yet.
 */
export function DocumentTabs() {
  const dirty = useEditor((s) => s.dirty)
  const file = useEditor((s) => s.file)
  const label = useOpenMapLabel()
  const unsaved = dirty || file === null

  return (
    <div role="tablist" aria-label="Documents" className="flex h-8 shrink-0 items-stretch border-b bg-card text-xs">
      <div
        className="flex h-full max-w-56 items-center gap-1 border-r bg-background px-2 text-foreground"
        title={file?.path ?? "Not saved yet"}
      >
        <button type="button" role="tab" aria-selected className="flex min-w-0 items-center gap-1.5 outline-none">
          <span className="truncate">{label}</span>
          {unsaved && <span className="size-1.5 shrink-0 rounded-full bg-foreground/60" aria-label="unsaved" />}
        </button>
      </div>
    </div>
  )
}
