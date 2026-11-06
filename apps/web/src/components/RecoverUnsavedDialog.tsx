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
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { useMemo, useRef } from "react"
import { itemCountOf } from "../domain/mapDiff"
import type { RecoveredTab } from "../domain/recovery"
import { formatAgo, formatDateTime } from "../domain/time"
import { discardUnsaved, restoreUnsaved } from "../editor/actions"
import { useEditor } from "../editor/store"
import { useNow } from "../editor/useNow"
import { CHIP } from "./chipStyle"
import { THUMBNAIL_TILE } from "./PieceThumbnail"
import { HintedButton } from "./TitledDialog"
import { useMapPicture } from "./useMapPicture"

/** The items from above, as a map's row in the Project panel shows them; it stays a tile when there's nothing to draw. */
function TabPicture({ tab }: { readonly tab: RecoveredTab }) {
  const shot = useMemo(() => ({ id: `recovery:${tab.key}`, items: tab.snapshot.map.items }), [tab])
  const rendered = useMapPicture(shot)
  return (
    <div className={cn("size-12 shrink-0 overflow-hidden rounded-control", THUMBNAIL_TILE)}>
      {rendered === undefined
        ? <Skeleton className="size-full" />
        : rendered !== null && <img src={rendered} alt="" className="size-full" />}
    </div>
  )
}

/** One tab that was left unsaved: its name, what it is if not a saved map, and when it was last edited. */
function RecoveredRow({ now, tab }: { readonly now: number; readonly tab: RecoveredTab }) {
  const { editedAt, file, label, map, prefab } = tab.snapshot
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <TabPicture tab={tab} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-body-strong">{label}</span>
          {prefab !== null && <Badge className={CHIP}>Prefab</Badge>}
          {prefab === null && file === null && <Badge className={CHIP}>Not saved yet</Badge>}
        </div>
        <div className="truncate text-body text-fg-tertiary" title={formatDateTime(editedAt)}>
          Edited {formatAgo(editedAt, now)} · {itemCountOf(map.items.length)}
        </div>
      </div>
    </li>
  )
}

/**
 * The app went away with unsaved edits (docs/DESKTOP.md § Recovery): the tabs it kept, to open again or let go. Decide
 * later, Escape and the × leave them for the next launch, so only Discard loses anything.
 */
export function RecoverUnsavedDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const dialog = useEditor((s) => s.dialog?.id === "recoverUnsaved" ? s.dialog : null)
  const restore = useRef<HTMLButtonElement>(null)
  const now = useNow(60_000)
  const tabs = dialog?.tabs ?? []
  return (
    <Dialog open={open && dialog !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex flex-col sm:max-w-md" initialFocus={restore}>
        <DialogHeader>
          <DialogTitle>Recover unsaved work?</DialogTitle>
          <DialogDescription>
            The editor closed before {tabs.length === 1 ? "this tab was" : "these tabs were"} saved.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex min-h-0 flex-col rounded-surface bg-muted/40 [&_[data-slot=scroll-area-viewport]]:max-h-72 [&_[data-slot=scroll-area-viewport]]:min-h-0">
          <ul>{tabs.map((tab) => <RecoveredRow key={tab.key} now={now} tab={tab} />)}</ul>
        </ScrollArea>
        <DialogFooter>
          <HintedButton
            hint="Deletes these edits for good. The saved files stay as they are."
            variant="destructive"
            className="sm:mr-auto"
            onClick={() => void discardUnsaved()}
          >
            Discard
          </HintedButton>
          <HintedButton hint="Asks again at the next launch." variant="outline" onClick={onClose}>
            Decide later
          </HintedButton>
          <Button ref={restore} onClick={() => void restoreUnsaved()}>
            {tabs.length === 1 ? "Restore" : "Restore all"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
