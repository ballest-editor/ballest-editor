import { IconFolder } from "@tabler/icons-react"
import { useEditor } from "../editor/store"
import { LinkStatus } from "./LinkStatus"
import { NotificationCenter } from "./NotificationCenter"
import { UpdatePill } from "./UpdatePill"

/** The project in use, its folder on hover (desktop). */
function ProjectName() {
  const project = useEditor((s) => s.project?.current ?? null)
  if (project === null) return null
  return (
    <span className="flex min-w-0 items-center gap-1 text-muted-foreground" title={project.path}>
      <IconFolder className="size-3.5 shrink-0" />
      <span className="truncate">{project.name}</span>
    </span>
  )
}

/**
 * Along the bottom of the window (docs/PROJECTS.md § Shell), where state that used to be a toast lives: the project on
 * the left, the open map's link state in the middle, the update pill and the notification bell on the right.
 */
export function StatusBar() {
  return (
    <footer className="grid h-7 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-t bg-card px-2 text-xs">
      <div className="flex min-w-0 items-center">
        <ProjectName />
      </div>
      <div className="flex min-w-0 items-center justify-center">
        <LinkStatus />
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1">
        <UpdatePill />
        <NotificationCenter />
      </div>
    </footer>
  )
}
