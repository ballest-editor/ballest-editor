import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { useRef } from "react"
import { GameLinkChecklist, useGameLinkSummary } from "./GameLink"

/**
 * File › Game link… (desktop): the checklist as a modal; Settings › Game shows the same checklist as a page. It also
 * opens by itself on the first launch, and when a launch finds a folder Export needs missing (docs/PROJECTS.md § Shell).
 */
export function GameLinkDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const summary = useGameLinkSummary()
  // Done takes the focus: the first row's Reveal would, and open its tooltip with the dialog
  const done = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* a column, not the default grid, so that only the rows scroll */}
      <DialogContent className="flex flex-col sm:max-w-2xl" initialFocus={done}>
        <DialogHeader>
          <DialogTitle>Game link</DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>
        <GameLinkChecklist />
        <DialogFooter>
          <Button ref={done} onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
