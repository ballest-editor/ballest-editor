import { IconDotsVertical, IconFileImport, IconPlus } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { mapLabelOf } from "../domain/factory"
import { linkStateOf } from "../domain/linkState"
import { formatAgo, formatDateTime } from "../domain/time"
import { importMap, nameProjectMap, openProjectMap, revealProject, startNewMap } from "../editor/actions"
import { type ProjectMap, useEditor } from "../editor/store"
import { useNow } from "../editor/useNow"
import { LinkStateBadge } from "./LinkStateBadge"

/** Where the map's thumbnail goes once maps have one (docs/PROJECTS.md § Shell); a square for now. */
function ThumbnailSlot() {
  return <span aria-hidden className="size-10 shrink-0 rounded-sm bg-muted" />
}

function MapRow(
  { map, now, onClose }: { readonly map: ProjectMap; readonly now: number; readonly onClose: () => void }
) {
  const isOpen = useEditor((s) => s.file?.name === map.fileName)
  const dirty = useEditor((s) => s.dirty)
  const label = mapLabelOf(map.fileName)
  const open = () => {
    onClose()
    void openProjectMap(map.fileName)
  }
  const name = (mode: "rename" | "duplicate") => {
    onClose()
    void nameProjectMap(map.fileName, mode)
  }
  return (
    <li
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_9rem_7rem_auto_auto] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60",
        isOpen && "bg-muted/40"
      )}
      title={map.path}
      onDoubleClick={open}
    >
      <ThumbnailSlot />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium">{label}</span>
        {isOpen && <span className="shrink-0 text-muted-foreground">open</span>}
      </span>
      <LinkStateBadge state={linkStateOf(map, { unsaved: isOpen && dirty })} />
      <span className="text-right text-muted-foreground" title={formatDateTime(map.modifiedAt)}>
        edited {formatAgo(map.modifiedAt, now)}
      </span>
      <Button variant="outline" size="sm" disabled={isOpen} onClick={open}>Open</Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${label}`} />}
        >
          <IconDotsVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => name("rename")}>Rename…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => name("duplicate")}>Duplicate…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void revealProject()}>Reveal</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/**
 * Project › Maps… (desktop; docs/PROJECTS.md § Shell): the project's maps, most recently changed first, each with its
 * link state and when it was last edited, the open one marked. New map…, Import…; Open (a double click too), and
 * per map Rename…, Duplicate… and Reveal. A tool, not a home page.
 */
export function MapsDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const maps = useEditor((s) => s.projectMaps)
  const projectName = useEditor((s) => s.project?.current.name ?? "this project")
  const now = useNow()
  const then = (action: () => Promise<unknown>) => {
    onClose()
    void action()
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[min(80vh,720px)] flex-col sm:max-w-3xl">
        <DialogHeader className="flex-row items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <DialogTitle>Maps in {projectName}</DialogTitle>
            <DialogDescription>The project's maps, most recently changed first.</DialogDescription>
          </div>
          <Button variant="outline" onClick={() => then(importMap)}>
            <IconFileImport data-icon="inline-start" />
            Import…
          </Button>
          <Button onClick={() => then(startNewMap)}>
            <IconPlus data-icon="inline-start" />
            New map…
          </Button>
        </DialogHeader>
        {maps.length === 0
          ? (
            <p className="px-2 py-6 text-xs text-muted-foreground">
              No maps saved yet. Save the open map, or New map… starts one here; Import… copies one in from the game's
              maps folder or anywhere else.
            </p>
          )
          : (
            <ul className="-mx-2 flex min-h-0 flex-col gap-0.5 overflow-y-auto text-xs">
              {maps.map((map) => <MapRow key={map.fileName} map={map} now={now} onClose={onClose} />)}
            </ul>
          )}
      </DialogContent>
    </Dialog>
  )
}
