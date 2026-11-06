import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "@workspace/ui/lib/utils"
import * as React from "react"

import { IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/30 duration-150 dark:bg-black/50 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * The popup's element, which lets go of the focus as the dialog starts to close. Base UI only moves it once the exit
 * animation has ended, and until then the keys would go to a dialog that is already on its way out.
 */
function DialogPopupElement({ open, popup, ...props }: React.ComponentProps<"div"> & {
  open: boolean
  popup: React.RefObject<HTMLDivElement | null>
}) {
  React.useLayoutEffect(() => {
    const focused = popup.current?.ownerDocument.activeElement
    if (!open && focused instanceof HTMLElement && popup.current?.contains(focused)) focused.blur()
  }, [open, popup])
  return <div {...props} />
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  // Closing leaves the focus on the page, not on what opened it: on a menu trigger the editor's keys would be off.
  finalFocus = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const popup = React.useRef<HTMLDivElement>(null)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full grid-cols-[minmax(0,1fr)] max-w-[calc(100%-2rem)] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:color-mix(in_oklch,var(--foreground)_25%,transparent)_transparent] [overflow-wrap:anywhere] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-sheet bg-popover p-dialog text-body text-popover-foreground shadow-lg ring-1 ring-edge duration-150 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-1 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-1",
          className
        )}
        finalFocus={finalFocus}
        {...props}
        ref={popup}
        render={(element, { open }) => <DialogPopupElement {...element} open={open} popup={popup} />}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <IconX />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-title", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-body text-fg-tertiary *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle }
