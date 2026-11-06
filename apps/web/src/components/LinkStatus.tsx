import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@workspace/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { type ComponentProps, type ReactNode, useState } from "react"
import { SYNC_STATUS_LABELS, syncDetailOf, type SyncStatus, syncStatusOf } from "../domain/linkState"
import { formatAgo, formatDateTime } from "../domain/time"
import { exportToGame, playMap, reimportMap, revealGamePath, saveMap } from "../editor/actions"
import { useEditor, useOpenPrefab, useOpenProjectMap, useTabSummary } from "../editor/store"
import { useNow } from "../editor/useNow"
import { SyncStatusChip } from "./SyncStatusChip"

/** The status bar's chip, with `chipDetail` after its label, and its popover: the status, `lines`, then `actions`. */
function StatusPopover(
  { status, chipDetail, lines, actions, ...props }: ComponentProps<typeof Popover> & {
    readonly status: SyncStatus
    readonly chipDetail?: ReactNode
    readonly lines: ReactNode
    readonly actions: ReactNode
  }
) {
  return (
    <Popover {...props}>
      <PopoverTrigger render={<SyncStatusChip status={status} render={<button type="button" />} />}>
        {chipDetail}
      </PopoverTrigger>
      <PopoverContent side="top" className="w-80 gap-3 p-3">
        <div className="flex flex-col">
          <PopoverTitle>{SYNC_STATUS_LABELS[status]}</PopoverTitle>
          {lines}
        </div>
        <div className="flex justify-end gap-2">{actions}</div>
      </PopoverContent>
    </Popover>
  )
}

/** A map that isn't in the project yet: Save opens the Save map dialog, so the popover closes rather than wait behind it. */
function NeverSavedStatus() {
  const [open, setOpen] = useState(false)
  const save = () => {
    setOpen(false)
    void saveMap()
  }
  return (
    <StatusPopover
      status="unsaved"
      open={open}
      onOpenChange={setOpen}
      lines={<p className="text-fg-tertiary">Not saved in the project yet</p>}
      actions={<Button onClick={save}>Save</Button>}
    />
  )
}

/**
 * The open map's sync status (docs/PROJECTS.md § Sync), in the middle of the status bar: a chip with the status and when
 * it was last exported. Its popover adds the link state the status leaves out, and has that time, Export, Play and
 * Reveal, and Re-import once the game has changed the export. A map that isn't in the project yet is Unsaved, the same
 * chip as its row, and its popover has Save. Desktop only.
 */
export function LinkStatus() {
  const open = useOpenProjectMap()
  const unsaved = useEditor((s) => s.dirty)
  const canExport = useEditor((s) => s.capabilities.exportToGame)
  const canPlay = useEditor((s) => s.capabilities.play)
  const prefab = useOpenPrefab()
  const tabId = useEditor((s) => s.tabId)
  const { blank } = useTabSummary(tabId)
  const now = useNow()
  if (prefab !== null) return <span className="text-fg-tertiary">Prefab {prefab.name}</span>
  if (!canExport) return null
  if (open === null) return blank ? null : <NeverSavedStatus /> // a blank map has nothing to save yet

  const { state, map } = open
  const exported = map.link?.export ?? null
  const changed = state === "changedInGame" || state === "bothChanged"
  const status = syncStatusOf(state, unsaved)
  const detail = syncDetailOf(state, status)
  return (
    <StatusPopover
      status={status}
      chipDetail={exported !== null && (
        <>
          <span aria-hidden>·</span>
          <span>exported {formatAgo(exported.at, now)}</span>
        </>
      )}
      lines={
        <>
          {detail !== null && <p className="text-fg-tertiary">{detail}</p>}
          {exported !== null && (
            <Tooltip>
              <TooltipTrigger render={<p className="w-fit text-fg-tertiary" />}>
                Last export {formatAgo(exported.at, now)}
              </TooltipTrigger>
              <TooltipContent side="top">{formatDateTime(exported.at)}</TooltipContent>
            </Tooltip>
          )}
        </>
      }
      actions={
        <>
          {exported !== null && (
            <Button variant="outline" onClick={() => void revealGamePath("mapsFolder")}>Reveal</Button>
          )}
          {changed && <Button variant="outline" onClick={() => void reimportMap(map.fileName)}>Re-import</Button>}
          <Button variant={canPlay ? "outline" : "default"} onClick={() => void exportToGame()}>Export</Button>
          {canPlay && <Button onClick={() => void playMap()}>Play</Button>}
        </>
      }
    />
  )
}
