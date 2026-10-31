import { Badge } from "@workspace/ui/components/badge"
import { useEditor } from "../editor/store"
import { MenuBar } from "./MenuBar"
import { UpdatePill } from "./UpdatePill"

/** The open file's name, with a dot while it has unsaved changes; its path (desktop) on hover. */
function FileName() {
  const file = useEditor((s) => s.file)
  const dirty = useEditor((s) => s.dirty)
  return (
    <span
      className="ml-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
      title={file?.path ?? undefined}
    >
      <span className="truncate">{file?.name ?? "Untitled"}</span>
      {dirty && <span className="size-1.5 shrink-0 rounded-full bg-foreground/60" aria-label="unsaved changes" />}
    </span>
  )
}

/**
 * In the desktop app this is the window's title bar (docs/DESKTOP.md § Window): it drags the window, and Electron
 * draws the window controls over one end of it. The padding keeps clear of them: `titlebar-area-*` is the part of
 * the bar they leave free, on whichever side the desktop puts them. A browser defines neither, so it gets plain
 * padding and no drag.
 */
const TITLE_BAR_CLASSES = [
  "[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]",
  "pl-[calc(env(titlebar-area-x,0px)_+_0.5rem)]",
  "pr-[calc(100vw_-_env(titlebar-area-width,100vw)_-_env(titlebar-area-x,0px)_+_0.5rem)]"
].join(" ")

export function TopBar() {
  const catalog = useEditor((s) => s.catalog)

  return (
    <header className={`flex h-10 shrink-0 items-center gap-1 border-b bg-card ${TITLE_BAR_CLASSES}`}>
      <span className="mr-2 px-1 text-sm font-semibold">Ballest Editor</span>
      <MenuBar />
      <FileName />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {catalog?.warning !== undefined && (
          <Badge variant="outline" className="text-amber-500" title={catalog.warning}>
            Fixture catalog
          </Badge>
        )}
        <UpdatePill />
      </div>
    </header>
  )
}
