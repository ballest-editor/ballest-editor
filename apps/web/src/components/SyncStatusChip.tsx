import { IconCircleCheck, IconCircleDashed, IconPencil, IconRefreshAlert, IconWorldUpload } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
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

/** A tone's fill and text, and the hover a chip gets when it renders as a button. */
const TONES: Record<SyncTone, string> = {
  neutral:
    "bg-status-neutral text-status-neutral-foreground [button]:hover:bg-status-neutral/80 [button]:aria-expanded:bg-status-neutral/80",
  ok: "bg-status-ok text-status-ok-foreground [button]:hover:bg-status-ok/80 [button]:aria-expanded:bg-status-ok/80",
  warn:
    "bg-status-warn text-status-warn-foreground [button]:hover:bg-status-warn/80 [button]:aria-expanded:bg-status-warn/80"
}

/** A pill in a status tone: a span, or whatever `render` gives it. */
export function StatusChip(
  { tone, className, ...props }: ComponentProps<typeof Badge> & { readonly tone: SyncTone }
) {
  return (
    <Badge
      variant="secondary"
      className={cn("rounded-full outline-none [&>svg]:size-3.5!", TONES[tone], className)}
      {...props}
    />
  )
}

/**
 * A sync status as a chip: its colour, icon and label, then `children`. The one chip for the status bar, where `render`
 * makes it a button, and a Project panel row, which has no room for the icon.
 */
export function SyncStatusChip(
  { status, icon = true, children, ...props }: ComponentProps<typeof Badge> & {
    readonly status: SyncStatus
    readonly icon?: boolean
  }
) {
  const Icon = ICONS[status]
  return (
    <StatusChip tone={SYNC_STATUS_TONES[status]} {...props}>
      {icon && <Icon />}
      {SYNC_STATUS_LABELS[status]}
      {children}
    </StatusChip>
  )
}
