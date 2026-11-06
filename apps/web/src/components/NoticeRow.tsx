import { IconAlertCircle, IconFolderOpen, IconInfoCircle } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"
import { formatClock, formatDateTime } from "../domain/time"
import type { NotificationAction, NotificationRecord } from "../editor/store"

const isReveal = ({ command }: NotificationAction) =>
  command._tag === "RevealProject" || command._tag === "RevealGamePath"

/**
 * One message, the same in a toast and in the notification centre: icon, text, time, and Reveal as an icon button at
 * the end of the line. Its other buttons, then `children`, go underneath.
 */
export function NoticeRow(
  { notice, actions, onAction, children }: {
    readonly notice: NotificationRecord
    readonly actions: ReadonlyArray<NotificationAction>
    readonly onAction: (action: NotificationAction) => void
    readonly children?: ReactNode
  }
) {
  const Icon = notice.level === "error" ? IconAlertCircle : IconInfoCircle
  const reveal = actions.find(isReveal)
  const buttons = actions.filter((action) => !isReveal(action))
  return (
    <div className="flex gap-2">
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", notice.level === "error" ? "text-destructive" : "text-fg-secondary")}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 break-words">{notice.title}</p>
          <time
            className="mt-0.5 shrink-0 text-caption text-fg-tertiary tabular-nums"
            dateTime={notice.at}
            title={formatDateTime(notice.at)}
          >
            {formatClock(notice.at)}
          </time>
          {reveal !== undefined && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="-my-0.5"
                    aria-label={reveal.label}
                    onClick={() => onAction(reveal)}
                  />
                }
              >
                <IconFolderOpen />
              </TooltipTrigger>
              <TooltipContent side="top">{reveal.label}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {notice.body !== null && <p className="break-words text-fg-tertiary">{notice.body}</p>}
        {(buttons.length > 0 || children !== undefined) && (
          <div className="flex flex-wrap gap-1">
            {buttons.map((action) => (
              <Button
                key={action.label}
                variant="outline"
                size="sm"
                onClick={() => onAction(action)}
              >
                {action.label}
              </Button>
            ))}
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
