import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { type ComponentProps, type ReactNode, type RefObject, useRef } from "react"

/** A small dialog: its title, a line about it if it needs one, and what goes under them. */
export function TitledDialog({
  children,
  description,
  initialFocus = true,
  onClose,
  open,
  showCloseButton = true,
  title
}: {
  readonly children?: ReactNode
  readonly description?: ReactNode
  /** What has the focus as it opens: by default, the first thing that can. */
  readonly initialFocus?: boolean | RefObject<HTMLElement | null>
  readonly onClose: () => void
  readonly open: boolean
  readonly showCloseButton?: boolean
  readonly title: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" initialFocus={initialFocus} showCloseButton={showCloseButton}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description !== undefined && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/** A dialog's button that keeps what it does in a tooltip, so the dialog itself stays one line. */
export function HintedButton({ children, hint, ...button }: ComponentProps<typeof Button> & {
  readonly hint: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button {...button} />}>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{hint}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Asks what to do about something an action found: one line, then `alternative` at the left, Cancel, and `confirm`.
 * Cancel takes the focus: a `HintedButton` would, and open its tooltip with the dialog.
 */
export function ConfirmDialog({ alternative, confirm, description, onClose, open, title }: {
  readonly alternative?: ReactNode
  readonly confirm: ReactNode
  readonly description: ReactNode
  readonly onClose: () => void
  readonly open: boolean
  readonly title: ReactNode
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  return (
    <TitledDialog
      open={open}
      onClose={onClose}
      initialFocus={cancel}
      showCloseButton={false}
      title={title}
      description={description}
    >
      <DialogFooter>
        {alternative}
        <Button ref={cancel} variant="outline" onClick={onClose}>Cancel</Button>
        {confirm}
      </DialogFooter>
    </TitledDialog>
  )
}
