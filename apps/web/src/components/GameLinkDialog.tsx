import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { GameLinkChecklist, useGameLinkSummary } from "./GameLink"

/**
 * Project › Game link… (desktop): the checklist as a modal. It also opens by itself on the first launch, and when a
 * launch finds a folder Export needs missing (docs/PROJECTS.md § Shell).
 */
export function GameLinkDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const summary = useGameLinkSummary()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Game link</DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>
        <GameLinkChecklist />
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
