import type { MapBackup, PrefabBackup, PrefabSummary, PrefabTier } from "@ballest/contracts"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { mapLabelOf } from "../domain/factory"
import { itemCountOf, mapDiffLabelOf } from "../domain/mapDiff"
import {
  type BackupPreview,
  type BackupSummary,
  describeBackup,
  describePrefabBackup,
  listBackups,
  listPrefabBackups,
  previewBackup,
  recoverBackup,
  restoreBackupAsNew,
  restorePrefabBackup
} from "../editor/actions"
import { useEditor } from "../editor/store"
import { mapThumbnailFor } from "../editor/thumbnails"
import { CHIP } from "./chipStyle"
import { THUMBNAIL_TILE } from "./PieceThumbnail"
import { SectionTitle } from "./SectionTitle"
import { HintedButton } from "./TitledDialog"
import { useOnOpen } from "./useOnOpen"

const formatTime = (at: string) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

const formatShortTime = (at: string) =>
  new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

/** A file's size as a person reads it: "3.4 KB". */
const formatSize = (bytes: number) =>
  bytes < 1000
    ? `${bytes} B`
    : bytes < 1_000_000
    ? `${(bytes / 1000).toFixed(1)} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`

const PLACES = {
  project: { label: "Project", title: "The project's copy, before Save, Rename or Import wrote over it" },
  export: { label: "Game", title: "The game's maps folder's copy, before Export wrote over it" }
} as const

const TIERS: ReadonlyArray<{ readonly tier: PrefabTier; readonly title: string }> = [
  { tier: "user", title: "User prefabs" },
  { tier: "project", title: "Project prefabs" }
]

/** What the dialog shows the versions of. */
type Shown =
  | { readonly kind: "map"; readonly fileName: string }
  | { readonly kind: "prefab"; readonly tier: PrefabTier; readonly name: string }

/** When a version is from, the badge saying whose copy, and what it holds. */
function VersionText(
  { at, badge, status }: { readonly at: string; readonly badge?: ReactNode; readonly status: string }
) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 text-body-strong tabular-nums">
        {formatTime(at)}
        {badge}
      </div>
      <div className="truncate text-body text-fg-tertiary">{status}</div>
    </div>
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

/**
 * A map's version: what it holds, decoded the way Open would. Clicking it selects it, for the preview beside the list,
 * and the selected one has the two ways of bringing it back.
 */
function VersionRow({ backup, onClose, onSelect, selected }: {
  readonly backup: MapBackup
  readonly onClose: () => void
  readonly onSelect: () => void
  readonly selected: boolean
}) {
  const summary = useSummary<MapBackup, BackupSummary>(backup, describeBackup)
  const place = PLACES[backup.place]
  const unreadable = summary?._tag !== "Map"
  return (
    <li className={cn("transition-colors", selected && "bg-primary/12")}>
      <button
        type="button"
        aria-pressed={selected}
        className={cn(
          "flex w-full items-center px-3 py-2 text-left transition-colors outline-none focus-visible:bg-foreground/6",
          !selected && "hover:bg-foreground/6"
        )}
        onClick={onSelect}
      >
        <VersionText
          at={backup.at}
          badge={
            <Tooltip>
              <TooltipTrigger render={<Badge variant="neutral" className={CHIP} />}>{place.label}</TooltipTrigger>
              <TooltipContent side="bottom">{place.title}</TooltipContent>
            </Tooltip>
          }
          status={summary === null
            ? "Reading…"
            : summary._tag === "Map"
            ? `${itemCountOf(summary.items)} · ${summary.displayName} by ${summary.creatorName}`
            : `Can't be opened: ${summary.message}`}
        />
      </button>
      {selected && (
        <div className="flex flex-wrap gap-2 px-3 pb-2">
          <HintedButton
            hint="Opens as unsaved edits of this map. Save backs up the current file first."
            variant="outline"
            disabled={unreadable}
            onClick={() => {
              onClose()
              void recoverBackup(backup)
            }}
          >
            Restore in place
          </HintedButton>
          <HintedButton
            hint="Opens in a new tab as a map of its own, named on Save. This map stays as it is."
            variant="outline"
            disabled={unreadable}
            onClick={() => {
              onClose()
              void restoreBackupAsNew(backup)
            }}
          >
            Restore as new
          </HintedButton>
        </div>
      )}
    </li>
  )
}

/** The top-down picture of a backup's items, rendered once they have been read. */
function BackupPicture({ preview }: { readonly preview: BackupPreview | null }) {
  const index = useEditor((s) => s.catalogIndex)
  const table = useEditor((s) => s.materialTable)
  const surfaces = useEditor((s) => s.surfaces)
  // undefined while it renders, null when there is nothing to show
  const [rendered, setRendered] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (preview?._tag !== "Map" || index === null || table === null) return
    let live = true
    void mapThumbnailFor(preview.id, preview.items, index, table, surfaces).then((url) => {
      if (live) setRendered(url ?? null)
    })
    return () => {
      live = false
    }
  }, [preview, index, table, surfaces])
  const image = preview?._tag === "Unreadable" ? null : rendered
  return (
    <div className={cn("flex size-60 items-center justify-center overflow-hidden rounded-surface", THUMBNAIL_TILE)}>
      {image === undefined
        ? <Skeleton className="size-full" />
        : image === null
        ? <span className="text-body text-fg-tertiary">Nothing to show</span>
        : <img src={image} alt="The backup's items from above" className="size-full" />}
    </div>
  )
}

/** The selected version beside the list: its picture, what it is, and what changed in the current map since. */
function BackupPreviewPanel({ backup }: { readonly backup: MapBackup }) {
  const preview = useSummary<MapBackup, BackupPreview>(backup, previewBackup)
  return (
    <div className="flex w-60 shrink-0 flex-col gap-2">
      <BackupPicture preview={preview} />
      {preview?._tag === "Map" && (
        <>
          <div className="text-body text-fg-secondary tabular-nums">
            {itemCountOf(preview.items.length)} · {formatShortTime(backup.at)} · {formatSize(preview.bytes)}
          </div>
          <div>
            <div className="text-caption text-fg-tertiary">Current map since this backup</div>
            <div className="text-body-strong tabular-nums">
              {preview.diff === null ? "It's no longer in the project" : mapDiffLabelOf(preview.diff)}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** A prefab's version: how many items it holds, with Restore. A file that isn't a prefab can't come back from here. */
function PrefabVersionRow({ backup, onClose }: { readonly backup: PrefabBackup; readonly onClose: () => void }) {
  const summary = useSummary<PrefabBackup, PrefabSummary>(backup, describePrefabBackup)
  const items = summary?.itemCount ?? null
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <VersionText
        at={backup.at}
        status={summary === null
          ? "Reading…"
          : items === null
          ? "Can't be restored: it doesn't read as a prefab"
          : itemCountOf(items)}
      />
      <HintedButton
        hint="Writes it back now. The current file is backed up first."
        variant="outline"
        disabled={items === null}
        onClick={() => {
          onClose()
          void restorePrefabBackup(backup)
        }}
      >
        Restore
      </HintedButton>
    </li>
  )
}

const versionKeyOf = ({ id, place }: MapBackup) => `${place} ${id}`

/** Backups by what they are versions of, in the order `keyOf` first meets each: newest first, as main lists them. */
function groupBy<T>(backups: ReadonlyArray<T>, keyOf: (backup: T) => string) {
  const groups = new Map<string, Array<T>>()
  for (const backup of backups) groups.set(keyOf(backup), [...(groups.get(keyOf(backup)) ?? []), backup])
  return [...groups]
}

/**
 * Project › Backups… (desktop): the versions the app kept of a map file or a prefab before writing over
 * it, newest first, for the open map or any other. A map's selected version shows beside the list, against the map as it
 * is now. Restoring it in place makes it that map's unsaved edits, and Save keeps it; restoring it as new opens it as a
 * map of its own. Restoring a prefab's writes it back at once, since a definition has no unsaved state to hold it in.
 */
export function RecoverDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const fileName = useEditor((s) => s.file?.name ?? null)
  const [backups, setBackups] = useState<ReadonlyArray<MapBackup> | null>(null)
  const [prefabBackups, setPrefabBackups] = useState<ReadonlyArray<PrefabBackup>>([])
  // The versions the first segment shows; null, with no map open, leaves All backups alone.
  const [shown, setShown] = useState<Shown | null>(null)
  const [all, setAll] = useState(false)
  // The map version chosen in the list, by `versionKeyOf`; the newest one until one is.
  const [chosen, setChosen] = useState<string | null>(null)

  // Each time the dialog opens, list the backups again and start on the open map's.
  useOnOpen(open, () => {
    setBackups(null)
    setPrefabBackups([])
    setShown(fileName === null ? null : { kind: "map", fileName })
    setAll(fileName === null)
    setChosen(null)
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
  const everything = sections.map(({ rows, title }) => (
    <section key={title}>
      <div className="px-3 pt-3 pb-1">
        <SectionTitle>{title}</SectionTitle>
      </div>
      <ul>
        {rows.map(({ label, list, name, shows }) => (
          <li key={name}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-150 ease-out outline-none hover:bg-accent focus-visible:bg-accent"
              onClick={() => {
                setShown(shows)
                setAll(false)
                setChosen(null)
              }}
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

  const mapVersions = shown?.kind === "map" ? (backups ?? []).filter((b) => b.fileName === shown.fileName) : []
  const selected = mapVersions.find((backup) => versionKeyOf(backup) === chosen) ?? mapVersions[0]
  const versions = shown?.kind === "prefab"
    ? prefabBackups.filter((b) => b.tier === shown.tier && b.name === shown.name)
      .map((backup) => <PrefabVersionRow key={backup.id} backup={backup} onClose={onClose} />)
    : mapVersions.map((backup) => (
      <VersionRow
        key={versionKeyOf(backup)}
        backup={backup}
        selected={backup === selected}
        onSelect={() => setChosen(versionKeyOf(backup))}
        onClose={onClose}
      />
    ))
  const empty = all ? sections.length === 0 : versions.length === 0
  const previewing = !all && selected !== undefined
  // wide from the start, so the dialog doesn't jump when the list arrives
  const wide = previewing || (!all && shown?.kind === "map" && backups === null)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* a column, so that the list shrinks before Close leaves the window; as wide as what it shows, up to a limit */}
      <DialogContent
        className={cn("flex flex-col sm:min-w-sm", wide ? "sm:w-2xl sm:max-w-2xl" : "sm:w-max sm:max-w-xl")}
      >
        <DialogHeader>
          <DialogTitle>Backups</DialogTitle>
        </DialogHeader>
        {shown !== null && (
          <ToggleGroup
            className="max-w-full"
            value={[all ? "all" : "shown"]}
            onValueChange={([picked]) => {
              if (picked !== undefined) setAll(picked === "all")
            }}
          >
            <ToggleGroupItem value="shown" className="min-w-0 shrink">
              <span className="truncate">{shown.kind === "map" ? mapLabelOf(shown.fileName) : shown.name}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="all">All backups</ToggleGroupItem>
          </ToggleGroup>
        )}
        {backups === null
          ? <p className="text-body text-fg-tertiary">Reading the backups…</p>
          : empty
          ? <p className="text-body text-fg-tertiary">No backups yet.</p>
          : (
            <div className="flex min-h-0 gap-4">
              <ScrollArea className="flex min-h-0 min-w-0 flex-1 flex-col rounded-surface bg-muted/40 [&_[data-slot=scroll-area-viewport]]:max-h-80 [&_[data-slot=scroll-area-viewport]]:min-h-0">
                {all ? everything : <ul>{versions}</ul>}
              </ScrollArea>
              {previewing && <BackupPreviewPanel key={versionKeyOf(selected)} backup={selected} />}
            </div>
          )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
