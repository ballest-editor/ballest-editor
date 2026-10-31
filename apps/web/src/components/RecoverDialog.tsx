import type { MapBackup } from "@ballest/contracts"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { useEffect, useMemo, useState } from "react"
import { mapLabelOf } from "../domain/factory"
import { type BackupSummary, describeBackup, listBackups, recoverBackup } from "../editor/actions"
import { useEditor } from "../editor/store"

const formatTime = (at: string) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

const PLACES = {
  project: { label: "Project", title: "The project's copy, before Save, Rename or Import wrote over it" },
  export: { label: "Game", title: "The game's maps folder's copy, before Export wrote over it" }
} as const

/** One version: when, whose copy, and what it holds (decoded the way Open would), with Open. */
function VersionRow(
  { backup, onOpen }: { readonly backup: MapBackup; readonly onOpen: (backup: MapBackup) => void }
) {
  const [summary, setSummary] = useState<BackupSummary | null>(null)
  useEffect(() => {
    let live = true
    void describeBackup(backup).then((found) => live && found !== undefined && setSummary(found))
    return () => {
      live = false
    }
  }, [backup])
  const place = PLACES[backup.place]
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm tabular-nums">
          {formatTime(backup.at)}
          <Badge variant="outline" title={place.title}>{place.label}</Badge>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {summary === null
            ? "Reading…"
            : summary._tag === "Map"
            ? `${summary.items.toLocaleString()} items · ${summary.displayName} by ${summary.creatorName}`
            : `Can't be opened: ${summary.message}`}
        </div>
      </div>
      <Button size="sm" variant="outline" disabled={summary?._tag !== "Map"} onClick={() => onOpen(backup)}>
        Open
      </Button>
    </li>
  )
}

/** Every file that has backups, the open map's first, then by its newest backup. */
const groupByFile = (backups: ReadonlyArray<MapBackup>, open: string | null) => {
  const groups = new Map<string, Array<MapBackup>>()
  for (const backup of backups) groups.set(backup.fileName, [...(groups.get(backup.fileName) ?? []), backup])
  return [...groups].sort(([a], [b]) => Number(b === open) - Number(a === open))
}

/**
 * Map › Recover previous version… (desktop): the versions the app kept of a map file before writing over it, newest
 * first, for the open map or any backed-up one. Opening one makes it the open map's unsaved edits; Save keeps it.
 */
export function RecoverDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const fileName = useEditor((s) => s.file?.name ?? null)
  const [backups, setBackups] = useState<ReadonlyArray<MapBackup> | null>(null)
  /** The file whose versions are shown; null shows every backed-up map. */
  const [shown, setShown] = useState<string | null>(null)

  // Each time the dialog opens, list the backups again and start on the open map's.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setBackups(null)
      setShown(fileName)
    }
  }
  useEffect(() => {
    if (!open) return
    let live = true
    void listBackups().then((found) => live && setBackups(found ?? []))
    return () => {
      live = false
    }
  }, [open])

  const groups = useMemo(() => groupByFile(backups ?? [], fileName), [backups, fileName])
  const versions = backups?.filter((b) => b.fileName === shown) ?? []
  const recover = (backup: MapBackup) => {
    onClose()
    void recoverBackup(backup)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Recover a previous version</DialogTitle>
          <DialogDescription>
            Before writing over a map file the editor keeps a copy of it: the project's on Save, Rename and Import, the
            game's on Export. A version opens as unsaved edits; Save writes it over the map, backing up the current file
            first.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-sm font-medium">
            {shown === null ? "All backed-up maps" : mapLabelOf(shown)}
          </div>
          {shown !== null && (
            <Button size="sm" variant="ghost" onClick={() => setShown(null)}>All backed-up maps</Button>
          )}
        </div>
        <ScrollArea className="h-72 rounded-md border">
          {backups === null
            ? <p className="p-3 text-sm text-muted-foreground">Reading the backups…</p>
            : shown === null
            ? groups.length === 0
              ? <p className="p-3 text-sm text-muted-foreground">No backups yet.</p>
              : (
                <ul className="divide-y">
                  {groups.map(([name, list]) => (
                    <li key={name}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
                        onClick={() => setShown(name)}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {mapLabelOf(name)}
                          {name === fileName && <span className="ml-1.5 text-muted-foreground">(open)</span>}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {list.length === 1 ? "1 version" : `${list.length} versions`} ·{" "}
                          {formatTime(list[0]?.at ?? "")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            : versions.length === 0
            ? (
              <p className="p-3 text-sm text-muted-foreground">
                No backups of this map yet. One is made each time Save, Rename, Import or Export writes over its file.
              </p>
            )
            : (
              <ul className="divide-y">
                {versions.map((backup) => (
                  <VersionRow key={`${backup.place} ${backup.id}`} backup={backup} onOpen={recover} />
                ))}
              </ul>
            )}
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
