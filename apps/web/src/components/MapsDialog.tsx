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
    if (!isOpen) void openProjectMap(map.fileName)
  }
  const name = (mode: "rename" | "duplicate" | "recover") => {
    onClose()
    void nameProjectMap(map.fileName, mode)
  }
  return (
    <li className={cn("flex items-center gap-1 rounded-md pr-1 hover:bg-muted/60", isOpen && "bg-muted/40")}>
      <button
        type="button"
        className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_9rem_7rem] items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={isOpen ? `${map.path}\nThe open map` : `${map.path}\nOpen`}
        onClick={open}
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
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`More for ${label}`} />}
        >
          <IconDotsVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => name("rename")}>Rename…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => name("duplicate")}>Duplicate…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => name("recover")}>Recover previous version…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void revealProject()}>Reveal</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/**
 * Project › Maps… (desktop; docs/PROJECTS.md § Shell): the project's maps, most recently changed first, each with its
 * link state and when it was last edited, the open one marked. New map…, Import…; a click on a map opens it, and its
 * menu holds Rename…, Duplicate…, Recover previous version… and Reveal. A tool, not a home page.
 */
export function MapsDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const maps = useEditor((s) => s.projectMaps)
  const projectPath = useEditor((s) => s.project?.current.path ?? "")
  const now = useNow()
  const then = (action: () => Promise<unknown>) => {
    onClose()
    void action()
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[min(80vh,720px)] min-h-[24rem] flex-col sm:max-w-3xl">
        <DialogHeader className="flex-row items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <DialogTitle>Maps</DialogTitle>
            <DialogDescription className="truncate font-mono text-[0.6875rem]" title={projectPath}>
              {projectPath}
            </DialogDescription>
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
