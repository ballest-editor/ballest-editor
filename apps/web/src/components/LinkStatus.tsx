import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@workspace/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { type ComponentProps, type ReactNode, useEffect, useState } from "react"
import {
  type ChipStatus,
  type ChipView,
  nextSavedChip,
  restingChip,
  savedChipMsLeft,
  SYNC_STATUS_LABELS,
  syncDetailOf,
  type SyncStatus,
  syncStatusOf
} from "../domain/linkState"
import { formatAgo, formatDateTime } from "../domain/time"
import { exportToGame, playMap, reimportMap, revealGamePath, saveMap } from "../editor/actions"
import { useEditor, useOpenPrefab, useOpenProjectMap, useTabSummary } from "../editor/store"
import { useNow } from "../editor/useNow"
import { SyncStatusChip } from "./SyncStatusChip"

/**
 * Lifts the popover over the viewport's tool bar, 36px tall and 12px up from the status bar (`ToolBar`), so it never
 * hides it, wherever the dock's panels put the two.
 */
const CLEARS_TOOL_BAR = 60

/**
 * What the chip says of the open map (`nextSavedChip`). It goes on saying what it said until it has looked, so no paint
 * has a status it should have held back, and looks again when it has something to stop saying.
 */
const useChipStatus = (view: ChipView): ChipStatus => {
  const [chip, setChip] = useState(() => restingChip(view))
  const { fileName, modifiedAt, status } = view
  useEffect(() => {
    const look = setTimeout(() => {
      const now = Date.now()
      setChip((last) => nextSavedChip(last, { fileName, modifiedAt, status }, now))
    })
    return () => clearTimeout(look)
  }, [fileName, modifiedAt, status])
  useEffect(() => {
    const left = savedChipMsLeft(chip, Date.now())
    if (left === 0) return
    const look = setTimeout(() => {
      const now = Date.now()
      setChip((last) => nextSavedChip(last, last, now))
    }, left)
    return () => clearTimeout(look)
  }, [chip])
  return chip.shown
}

/**
 * The status bar's chip, with `chipDetail` after its label, and its popover: the status, `lines`, then `actions`. `chip`
 * is what the chip says when that isn't the status; the popover goes on telling the status.
 */
function StatusPopover(
  { status, chip = status, chipDetail, lines, actions, ...props }: ComponentProps<typeof Popover> & {
    readonly status: SyncStatus
    readonly chip?: ChipStatus
    readonly chipDetail?: ReactNode
    readonly lines: ReactNode
    readonly actions: ReactNode
  }
) {
  return (
    <Popover {...props}>
      <PopoverTrigger render={<SyncStatusChip status={chip} render={<button type="button" />} />}>
        {chip !== "saved" && chipDetail}
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={CLEARS_TOOL_BAR} className="w-80 gap-3 p-3">
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
 * chip as its row, and its popover has Save. For a moment after a save the chip says Saved, so a save is confirmed after
 * its toast has gone too. Desktop only.
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
  const status = open === null ? "unsaved" : syncStatusOf(open.state, unsaved)
  const chip = useChipStatus({ fileName: open?.map.fileName ?? null, modifiedAt: open?.map.modifiedAt ?? null, status })
  if (prefab !== null) return <span className="text-fg-tertiary">Prefab {prefab.name}</span>
  if (!canExport) return null
  if (open === null) return blank ? null : <NeverSavedStatus /> // a blank map has nothing to save yet

  const { state, map } = open
  const exported = map.link?.export ?? null
  const changed = state === "changedInGame" || state === "bothChanged"
  const detail = syncDetailOf(state, status)
  return (
    <StatusPopover
      status={status}
      chip={chip}
      chipDetail={exported !== null && (
        <>
          <span aria-hidden>·</span>
          <span>exported {formatAgo(exported.at, now)}</span>
        </>
      )}
      lines={
        <>
          {detail !== null && <p className="text-fg-tertiary">{detail}</p>}
          {status === "notExported" && (
            <p className="text-fg-tertiary">Export puts this map in the game's maps folder.</p>
          )}
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
