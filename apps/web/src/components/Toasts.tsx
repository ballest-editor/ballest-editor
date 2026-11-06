import { Toaster } from "@workspace/ui/components/sonner"
import { useEffect } from "react"
import { toast } from "sonner"
import { runNotificationAction, showToasts } from "../editor/actions"
import type { NotificationRecord } from "../editor/store"
import { NoticeRow } from "./NoticeRow"

/** An error isn't in the notification centre to read later, so it stays up for longer than sonner's 4 seconds. */
const ERROR_DURATION = 8000

const present = (notice: NotificationRecord) => {
  toast.custom(
    (id) => (
      // a toast behind the front one is as tall as the front one, as sonner's own are
      <div className="w-(--width) glass overflow-hidden rounded-sheet p-2 text-popover-foreground shadow-md ring-1 ring-edge in-data-[front=false]:in-data-[expanded=false]:max-h-(--front-toast-height)">
        <NoticeRow
          notice={notice}
          actions={notice.actions.slice(0, 1)}
          onAction={(action) => {
            toast.dismiss(id)
            runNotificationAction(notice, action)
          }}
        />
      </div>
    ),
    notice.level === "error" ? { duration: ERROR_DURATION } : {}
  )
}

/** Immediate feedback, bottom right and clear of the status bar (docs/DESKTOP.md § Notifications). */
export function Toasts() {
  useEffect(() => showToasts(present), [])
  return <Toaster position="bottom-right" offset={{ bottom: 32 }} />
}
