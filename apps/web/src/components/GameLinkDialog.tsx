import { Button } from "@workspace/ui/components/button"
import { DialogFooter } from "@workspace/ui/components/dialog"
import { useRef } from "react"
import { useEditor } from "../editor/store"
import { MissingGameLinkRows, useGameLinkSummary } from "./GameLink"
import { TitledDialog } from "./TitledDialog"

/**
 * What the app couldn't find (desktop), and the way to Settings › Game, which is the Game link's home. It opens by
 * itself when a launch finds a folder Export needs missing, and on the first launch if anything is
 * (docs/DESKTOP.md § Game link).
 */
export function GameLinkDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const summary = useGameLinkSummary()
  const openDialog = useEditor((s) => s.openDialog)
  // the way forward takes the focus, not Not now
  const settings = useRef<HTMLButtonElement>(null)
  return (
    <TitledDialog open={open} onClose={onClose} initialFocus={settings} title="Game link" description={summary}>
      <MissingGameLinkRows />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Not now</Button>
        <Button ref={settings} onClick={() => openDialog({ id: "settings", category: "game" })}>
          Open Settings › Game
        </Button>
      </DialogFooter>
    </TitledDialog>
  )
}
