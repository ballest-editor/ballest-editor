import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from "@workspace/ui/components/popover"
import { LINK_STATE_LABELS } from "../domain/linkState"
import { formatAgo, formatDateTime } from "../domain/time"
import { exportToGame, playMap, reimportMap, revealGamePath } from "../editor/actions"
import { useEditor, useOpenProjectMap } from "../editor/store"
import { useNow } from "../editor/useNow"
import { LINK_STATE_HELP, LinkStateBadge } from "./LinkStateBadge"

/**
 * The open map's link to its export (docs/PROJECTS.md § Sync), in the middle of the status bar: the state and when it
 * was last exported. Its popover has the export's path and time, Export to game, Play and Reveal, and Re-import once the
 * game has changed the export. Desktop only.
 */
export function LinkStatus() {
  const open = useOpenProjectMap()
  const mapOpen = useEditor((s) => s.mapOpen)
  const canExport = useEditor((s) => s.capabilities.exportToGame)
  const canPlay = useEditor((s) => s.capabilities.play)
  const now = useNow()
  if (!canExport || !mapOpen) return null
  if (open === null) return <span className="text-muted-foreground">Not saved in the project yet</span>

  const { state, map } = open
  const exported = map.link?.export ?? null
  const changed = state === "changedInGame" || state === "bothChanged"
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="xs" className="h-5 gap-1.5 px-1.5 text-xs font-normal" />}
      >
        <LinkStateBadge state={state} />
        {exported !== null && <span className="text-muted-foreground">· exported {formatAgo(exported.at, now)}</span>}
      </PopoverTrigger>
      <PopoverContent side="top" className="w-96 gap-3">
        <PopoverHeader>
          <PopoverTitle>{LINK_STATE_LABELS[state]}</PopoverTitle>
          <PopoverDescription>{LINK_STATE_HELP[state]}</PopoverDescription>
        </PopoverHeader>
        {exported !== null && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Export</dt>
            <dd className="break-all font-mono text-[0.6875rem]">{exported.path}</dd>
            <dt className="text-muted-foreground">Last export</dt>
            <dd>
              {formatDateTime(exported.at)} ({formatAgo(exported.at, now)})
            </dd>
          </dl>
        )}
        <div className="flex justify-end gap-2">
          {exported !== null && (
            <Button variant="outline" onClick={() => void revealGamePath("mapsFolder")}>Reveal</Button>
          )}
          {changed && <Button variant="outline" onClick={() => void reimportMap(map.fileName)}>Re-import</Button>}
          <Button variant={canPlay ? "outline" : "default"} onClick={() => void exportToGame()}>Export to game</Button>
          {canPlay && <Button onClick={() => void playMap()}>Play</Button>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
