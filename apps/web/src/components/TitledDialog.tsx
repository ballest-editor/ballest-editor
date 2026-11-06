import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog"
import type { ReactNode } from "react"

/** A small dialog: its title, a line about it, and what goes under them. */
export function TitledDialog({ children, description, onClose, open, showCloseButton = true, title }: {
  readonly children?: ReactNode
  readonly description: ReactNode
  readonly onClose: () => void
  readonly open: boolean
  readonly showCloseButton?: boolean
  readonly title: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={showCloseButton}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
