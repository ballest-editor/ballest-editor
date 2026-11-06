import type { MapBackup, PrefabBackup, PrefabSummary, PrefabTier } from "@ballest/contracts"
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
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { mapLabelOf } from "../domain/factory"
import {
  type BackupSummary,
  describeBackup,
  describePrefabBackup,
  listBackups,
  listPrefabBackups,
  recoverBackup,
  restorePrefabBackup
} from "../editor/actions"
import { useEditor } from "../editor/store"
import { SectionTitle } from "./SectionTitle"
import { useOnOpen } from "./useOnOpen"

const formatTime = (at: string) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

const PLACES = {
  project: { label: "Project", title: "The project's copy, before Save, Rename or Import wrote over it" },
  export: { label: "Game", title: "The game's maps folder's copy, before Export wrote over it" }
} as const

const TIERS: ReadonlyArray<{ readonly tier: PrefabTier; readonly title: string }> = [
  { tier: "user", title: "User prefabs" },
  { tier: "project", title: "Project prefabs" }
]

/** What the dialog shows the versions of; null shows everything with backups. */
type Shown =
  | { readonly kind: "map"; readonly fileName: string }
  | { readonly kind: "prefab"; readonly tier: PrefabTier; readonly name: string }

/** One version's row: when, the badge saying whose copy, what it holds, and the button that brings it back. */
function VersionLine(
  { action, at, badge, onAct, status }: {
    readonly action: { readonly label: string; readonly disabled: boolean }
    readonly at: string
    readonly badge?: ReactNode
    readonly onAct: () => void
    readonly status: string
  }
) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-body-strong tabular-nums">
          {formatTime(at)}
          {badge}
        </div>
        <div className="truncate text-body text-fg-tertiary">{status}</div>
      </div>
      <Button size="sm" variant="outline" disabled={action.disabled} onClick={onAct}>
        {action.label}
      </Button>
    </li>
  )
}

/** What `describe` says `backup` holds; null until it has answered. */
const useSummary = <B, S>(backup: B, describe: (backup: B) => Promise<S | undefined>) => {
  const [summary, setSummary] = useState<S | null>(null)
  useEffect(() => {
    let live = true
    void describe(backup).then((found) => live && found !== undefined && setSummary(found))
    return () => {
      live = false
    }
  }, [backup, describe])
  return summary
}

/** A map's version: what it holds, decoded the way Open would, with Open. */
function VersionRow({ backup, onClose }: { readonly backup: MapBackup; readonly onClose: () => void }) {
  const summary = useSummary<MapBackup, BackupSummary>(backup, describeBackup)
  const place = PLACES[backup.place]
  return (
    <VersionLine
      at={backup.at}
      badge={<Badge variant="outline" title={place.title}>{place.label}</Badge>}
      status={summary === null
        ? "Reading…"
        : summary._tag === "Map"
        ? `${summary.items.toLocaleString()} items · ${summary.displayName} by ${summary.creatorName}`
        : `Can't be opened: ${summary.message}`}
      action={{ label: "Open", disabled: summary?._tag !== "Map" }}
      onAct={() => {
        onClose()
        void recoverBackup(backup)
      }}
    />
  )
}

/** A prefab's version: how many items it holds, with Restore. A file that isn't a prefab can't come back from here. */
function PrefabVersionRow({ backup, onClose }: { readonly backup: PrefabBackup; readonly onClose: () => void }) {
  const summary = useSummary<PrefabBackup, PrefabSummary>(backup, describePrefabBackup)
  const items = summary?.itemCount ?? null
  return (
    <VersionLine
      at={backup.at}
      status={summary === null
        ? "Reading…"
        : items === null
        ? "Can't be restored: it doesn't read as a prefab"
        : `${items.toLocaleString()} ${items === 1 ? "item" : "items"}`}
      action={{ label: "Restore", disabled: items === null }}
      onAct={() => {
        onClose()
        void restorePrefabBackup(backup)
      }}
    />
  )
}

/** Backups by what they are versions of, in the order `keyOf` first meets each: newest first, as main lists them. */
function groupBy<T>(backups: ReadonlyArray<T>, keyOf: (backup: T) => string) {
  const groups = new Map<string, Array<T>>()
  for (const backup of backups) groups.set(keyOf(backup), [...(groups.get(keyOf(backup)) ?? []), backup])
  return [...groups]
}

/**
 * Project › Recover previous version… (desktop): the versions the app kept of a map file or a prefab before writing over
 * it, newest first, for the open map or any other. Opening a map's makes it the open map's unsaved edits, and Save keeps
 * it. Restoring a prefab's writes it back at once, since a definition has no unsaved state to hold it in.
 */
export function RecoverDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const fileName = useEditor((s) => s.file?.name ?? null)
  const [backups, setBackups] = useState<ReadonlyArray<MapBackup> | null>(null)
  const [prefabBackups, setPrefabBackups] = useState<ReadonlyArray<PrefabBackup>>([])
  const [shown, setShown] = useState<Shown | null>(null)

  // Each time the dialog opens, list the backups again and start on the open map's.
  useOnOpen(open, () => {
    setBackups(null)
    setPrefabBackups([])
    setShown(fileName === null ? null : { kind: "map", fileName })
  })
  useEffect(() => {
    if (!open) return
    let live = true
    void Promise.all([listBackups(), listPrefabBackups()]).then(([maps, prefabs]) => {
      if (!live) return
      setBackups(maps ?? [])
      setPrefabBackups(prefabs ?? [])
    })
    return () => {
      live = false
    }
  }, [open])

  // every map with backups, the open one's first, then by its newest backup; then every prefab's, by tier
  const sections = useMemo(
    () =>
      [
        {
          title: "Maps",
          rows: groupBy(backups ?? [], (backup) => backup.fileName)
            .sort(([a], [b]) => Number(b === fileName) - Number(a === fileName))
            .map(([name, list]) => ({
              name,
              list,
              label: (
                <>
                  {mapLabelOf(name)}
                  {name === fileName && <span className="ml-1.5 text-fg-tertiary">(open)</span>}
                </>
              ),
              shows: { kind: "map", fileName: name } as const
            }))
        },
        ...TIERS.map(({ tier, title }) => ({
          title,
          rows: groupBy(prefabBackups.filter((backup) => backup.tier === tier), (backup) => backup.name)
            .map(([name, list]) => ({ name, list, label: name, shows: { kind: "prefab", tier, name } as const }))
        }))
      ].filter(({ rows }) => rows.length > 0),
    [backups, prefabBackups, fileName]
  )
  const versions = shown?.kind === "map" ? backups?.filter((b) => b.fileName === shown.fileName) ?? [] : []
  const prefabVersions = shown?.kind === "prefab"
    ? prefabBackups.filter((b) => b.tier === shown.tier && b.name === shown.name)
    : []

  const everything = sections.map(({ rows, title }) => (
    <section key={title}>
      <div className="px-3 pt-3 pb-1">
        <SectionTitle>{title}</SectionTitle>
      </div>
      <ul className="divide-y">
        {rows.map(({ label, list, name, shows }) => (
          <li key={name}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:bg-muted"
              onClick={() => setShown(shows)}
            >
              <span className="min-w-0 flex-1 truncate text-body-strong">{label}</span>
              <span className="shrink-0 text-body text-fg-tertiary tabular-nums">
                {list.length === 1 ? "1 version" : `${list.length} versions`} · {formatTime(list[0]?.at ?? "")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  ))

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* a column, so that the list shrinks before Close leaves the window */}
      <DialogContent className="flex flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Recover a previous version</DialogTitle>
          <DialogDescription>
            Copies kept before a file was written over: a project map's on Save, Rename and Import, the game's on
            Export, a prefab's on a save, Rename or Delete. A map's version opens as unsaved edits, and Save backs up
            the current file first. A prefab's is written back at once, and the file it replaces is backed up first.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-body-strong">
            {shown === null ? "All backups" : shown.kind === "map" ? mapLabelOf(shown.fileName) : shown.name}
          </div>
          {shown !== null && <Button size="sm" variant="ghost" onClick={() => setShown(null)}>All backups</Button>}
        </div>
        <ScrollArea className="h-72 min-h-0 rounded-control border">
          {backups === null
            ? <p className="p-3 text-body text-fg-tertiary">Reading the backups…</p>
            : shown === null
            ? sections.length === 0 ? <p className="p-3 text-body text-fg-tertiary">No backups yet.</p> : everything
            : shown.kind === "prefab"
            ? (
              <ul className="divide-y">
                {prefabVersions.map((backup) => <PrefabVersionRow key={backup.id} backup={backup} onClose={onClose} />)}
              </ul>
            )
            : versions.length === 0
            ? (
              <p className="p-3 text-body text-fg-tertiary">
                No backups of this map yet. One is made each time Save, Rename, Import or Export writes over its file.
              </p>
            )
            : (
              <ul className="divide-y">
                {versions.map((backup) => (
                  <VersionRow key={`${backup.place} ${backup.id}`} backup={backup} onClose={onClose} />
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
