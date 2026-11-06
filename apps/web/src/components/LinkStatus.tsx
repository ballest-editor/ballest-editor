import { Button } from "@workspace/ui/components/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@workspace/ui/components/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { LINK_STATE_LABELS } from "../domain/linkState"
import { formatAgo, formatDateTime } from "../domain/time"
import { exportToGame, playMap, reimportMap, revealGamePath } from "../editor/actions"
import { useEditor, useOpenPrefab, useOpenProjectMap } from "../editor/store"
import { useNow } from "../editor/useNow"
import { LinkStateChip } from "./LinkStateChip"

/**
 * The open map's link to its export (docs/PROJECTS.md § Sync), in the middle of the status bar: a chip with the state
 * and when it was last exported. Its popover has that time, Export, Play and Reveal, and Re-import once the game has
 * changed the export. Desktop only.
 */
export function LinkStatus() {
  const open = useOpenProjectMap()
  const canExport = useEditor((s) => s.capabilities.exportToGame)
  const canPlay = useEditor((s) => s.capabilities.play)
  const prefab = useOpenPrefab()
  const now = useNow()
  if (prefab !== null) return <span className="text-fg-tertiary">Prefab {prefab.name}</span>
  if (!canExport) return null
  if (open === null) return <span className="text-fg-tertiary">Not saved in the project yet</span>

  const { state, map } = open
  const exported = map.link?.export ?? null
  const changed = state === "changedInGame" || state === "bothChanged"
  return (
    <Popover>
      <PopoverTrigger render={<LinkStateChip state={state} />}>
        {exported !== null && (
          <>
            <span aria-hidden>·</span>
            <span>exported {formatAgo(exported.at, now)}</span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent side="top" className="w-80 gap-3 p-3">
        <div className="flex flex-col">
          <PopoverTitle>{LINK_STATE_LABELS[state]}</PopoverTitle>
          {exported !== null && (
            <Tooltip>
              <TooltipTrigger render={<p className="w-fit text-fg-tertiary" />}>
                Last export {formatAgo(exported.at, now)}
              </TooltipTrigger>
              <TooltipContent side="top">{formatDateTime(exported.at)}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex justify-end gap-2">
          {exported !== null && (
            <Button variant="outline" onClick={() => void revealGamePath("mapsFolder")}>Reveal</Button>
          )}
          {changed && <Button variant="outline" onClick={() => void reimportMap(map.fileName)}>Re-import</Button>}
          <Button variant={canPlay ? "outline" : "default"} onClick={() => void exportToGame()}>Export</Button>
          {canPlay && <Button onClick={() => void playMap()}>Play</Button>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
