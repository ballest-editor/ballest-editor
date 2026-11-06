import { IconCircleCheck, IconCircleDashed, IconPencil, IconRefreshAlert, IconWorldUpload } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { ComponentProps, ComponentType } from "react"
import { SYNC_STATUS_LABELS, SYNC_STATUS_TONES, type SyncStatus, type SyncTone } from "../domain/linkState"

const ICONS: Record<SyncStatus, ComponentType<{ readonly className?: string }>> = {
  unsaved: IconPencil,
  notExported: IconCircleDashed,
  inSync: IconCircleCheck,
  changedSinceExport: IconRefreshAlert,
  publishedDraft: IconWorldUpload
}

/** `fill` and `text` are a badge's colours; a chip adds `hover`, with `text` on a span so the button's hover leaves it alone. */
const TONES: Record<SyncTone, { readonly fill: string; readonly hover: string; readonly text: string }> = {
  neutral: {
    fill: "bg-status-neutral",
    hover: "hover:bg-status-neutral/80 aria-expanded:bg-status-neutral/80 dark:hover:bg-status-neutral/80",
    text: "text-status-neutral-foreground"
  },
  ok: {
    fill: "bg-status-ok",
    hover: "hover:bg-status-ok/80 aria-expanded:bg-status-ok/80 dark:hover:bg-status-ok/80",
    text: "text-status-ok-foreground"
  },
  warn: {
    fill: "bg-status-warn",
    hover: "hover:bg-status-warn/80 aria-expanded:bg-status-warn/80 dark:hover:bg-status-warn/80",
    text: "text-status-warn-foreground"
  }
}

/** A sync status as a button: its colour, icon and label, then `children`. */
export function SyncStatusChip(
  { status, className, children, ...props }: ComponentProps<typeof Button> & { readonly status: SyncStatus }
) {
  const Icon = ICONS[status]
  const tone = TONES[SYNC_STATUS_TONES[status]]
  return (
    <Button variant="ghost" size="sm" className={cn("h-5 px-1.5", tone.fill, tone.hover, className)} {...props}>
      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", tone.text)}>
        <Icon className="size-4" />
        {SYNC_STATUS_LABELS[status]}
        {children}
      </span>
    </Button>
  )
}

/** A sync status as a badge, in the chip's colours and words, for a row. */
export function SyncStatusBadge(
  { status, className, ...props }: ComponentProps<typeof Badge> & { readonly status: SyncStatus }
) {
  const tone = TONES[SYNC_STATUS_TONES[status]]
  return (
    <Badge variant="secondary" className={cn(tone.fill, tone.text, className)} {...props}>
      {SYNC_STATUS_LABELS[status]}
    </Badge>
  )
}
