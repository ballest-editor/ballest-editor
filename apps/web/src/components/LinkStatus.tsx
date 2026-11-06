import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@workspace/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { type ComponentProps, type ReactNode, useEffect, useState } from "react"
import {
  type ChipStatus,
  chipStatusOf,
  type ChipView,
  GAME_WRITE_HOLD_MS,
  type GameWrite,
  nextSavedChip,
  restingChip,
  SAVED_CHIP_MS,
  SYNC_STATUS_LABELS,
  syncDetailOf,
  type SyncStatus,
  syncStatusOf
} from "../domain/linkState"
import { formatAgo, formatDateTime } from "../domain/time"
import { exportToGame, playMap, reimportMap, revealGamePath, saveMap } from "../editor/actions"
import { useEditor, useOpenPrefab, useOpenProjectMap, useTabSummary } from "../editor/store"
import { useNow } from "../editor/useNow"
import { StatusBarChip } from "./SyncStatusChip"

/**
 * Lifts the popover over the viewport's tool bar, 36px tall and at most 12px up from the status bar (`ToolBar`), so it
 * never hides it, wherever the dock's panels put the two.
 */
const CLEARS_TOOL_BAR = 60

/**
 * What the chip says of the open map (`nextSavedChip`). It looks while rendering, so the chip changes in the same commit
 * as the title and the tab's dot, even when loading a map keeps the main thread busy straight after. Saved's 2 seconds
 * run from when it appears, and over again for another save.
 */
const useChipStatus = (view: ChipView): ChipStatus => {
  const [chip, setChip] = useState(() => restingChip(view))
  const seen = chip.opened === view.opened && chip.savedDoc === view.savedDoc && chip.status === view.status
  if (!seen) setChip(nextSavedChip(chip, view))
  const { justSaved, savedDoc } = chip
  useEffect(() => {
    if (!justSaved) return
    const end = setTimeout(
      () => setChip((last) => last.savedDoc === savedDoc ? { ...last, justSaved: false } : last),
      SAVED_CHIP_MS
    )
    return () => clearTimeout(end)
  }, [justSaved, savedDoc])
  return chipStatusOf(chip)
}

/** The Export or Play the chip shows: the one under way, and for `GAME_WRITE_HOLD_MS` after, the one that just ended. */
const useShownGameWrite = (): GameWrite | null => {
  const current = useEditor((s) => s.gameWrite)
  const [last, setLast] = useState<GameWrite | null>(null)
  if (current !== null && current !== last) setLast(current)
  useEffect(() => {
    if (current !== null || last === null) return
    const end = setTimeout(() => setLast(null), GAME_WRITE_HOLD_MS)
    return () => clearTimeout(end)
  }, [current, last])
  return current ?? last
}

/**
 * The status bar's chip and its popover: the status, `lines`, then `actions`. `chip` is what the chip says when that
 * isn't the status, and `write` the Export or Play it shows instead; the popover goes on telling the status.
 */
function StatusPopover(
  { status, chip = status, write, lines, actions, ...props }: ComponentProps<typeof Popover> & {
    readonly status: SyncStatus
    readonly chip?: ChipStatus
    readonly write: GameWrite | null
    readonly lines: ReactNode
    readonly actions: ReactNode
  }
) {
  return (
    <Popover {...props}>
      <PopoverTrigger render={<StatusBarChip status={chip} write={write} render={<button type="button" />} />} />
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
function NeverSavedStatus(
  { chip, write }: { readonly chip: ChipStatus; readonly write: GameWrite | null }
) {
  const [open, setOpen] = useState(false)
  const save = () => {
    setOpen(false)
    void saveMap()
  }
  return (
    <StatusPopover
      status="unsaved"
      chip={chip}
      write={write}
      open={open}
      onOpenChange={setOpen}
      lines={<p className="text-fg-tertiary">Not saved in the project yet</p>}
      actions={<Button onClick={save}>Save</Button>}
    />
  )
}

/**
 * The open map's sync status (docs/PROJECTS.md § Sync), in the middle of the status bar: a chip with the status. Its
 * popover adds the link state the status leaves out, and has when it was last exported, Export, Play and Reveal, and
 * Re-import once the game has changed the export. A map that isn't in the project yet is Unsaved, the same chip as its
 * row, and its popover has Save. For a moment after a save the chip says Saved, so a save is confirmed after its toast
 * has gone too, and during an Export or a Play it shows how far that has got. Desktop only.
 */
export function LinkStatus() {
  const open = useOpenProjectMap()
  const unsaved = useEditor((s) => s.dirty)
  const hasFile = useEditor((s) => s.file !== null)
  const savedDoc = useEditor((s) => s.savedDoc)
  const opened = useEditor((s) => `${s.tabId}/${s.mapShownRequest}`)
  const canExport = useEditor((s) => s.capabilities.exportToGame)
  const canPlay = useEditor((s) => s.capabilities.play)
  const prefab = useOpenPrefab()
  const tabId = useEditor((s) => s.tabId)
  const { blank } = useTabSummary(tabId)
  const now = useNow()
  // a first save has a file before the project's list has the map, and nothing is unsaved by then
  const unlisted = hasFile && !unsaved ? "notExported" : "unsaved"
  const status = open === null ? unlisted : syncStatusOf(open.state, unsaved)
  const chip = useChipStatus({ opened, savedDoc, status })
  const write = useShownGameWrite()
  if (prefab !== null) return <span className="text-fg-tertiary">Prefab {prefab.name}</span>
  if (!canExport) return null
  if (open === null) return blank ? null : <NeverSavedStatus chip={chip} write={write} /> // a blank map has nothing to save yet

  const { state, map } = open
  const exported = map.link?.export ?? null
  const changed = state === "changedInGame" || state === "bothChanged"
  const detail = syncDetailOf(state, status)
  return (
    <StatusPopover
      status={status}
      chip={chip}
      write={write}
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

/**
 * When the open map was last exported, beside the chip. It stays out of the chip, whose width doesn't change, and in a
 * column of its own, so the chip stays centred however long it is.
 */
export function LastExportStatus() {
  const exported = useOpenProjectMap()?.map.link?.export ?? null
  const prefab = useOpenPrefab()
  const now = useNow()
  if (prefab !== null || exported === null) return null
  return <span className="truncate text-fg-tertiary">exported {formatAgo(exported.at, now)}</span>
}
