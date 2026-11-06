import {
  IconCheck,
  IconCircleCheck,
  IconCircleDashed,
  IconPencil,
  IconRefreshAlert,
  IconWorldUpload
} from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"
import type { ComponentProps, ComponentType } from "react"
import { CHIP_STATUS_LABELS, CHIP_STATUS_TONES, type ChipStatus, type SyncTone } from "../domain/linkState"

const ICONS: Record<ChipStatus, ComponentType<{ readonly className?: string }>> = {
  saved: IconCheck,
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

/**
 * A pill in a status tone: a span, or whatever `render` gives it. It has no transition, so its colour changes in the
 * frame its label does.
 */
export function StatusChip(
  { tone, className, ...props }: ComponentProps<typeof Badge> & { readonly tone: SyncTone }
) {
  return (
    <Badge
      variant="neutral"
      className={cn("rounded-full outline-none transition-none [&>svg]:size-3.5!", TONES[tone], className)}
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
    readonly status: ChipStatus
    readonly icon?: boolean
  }
) {
  const Icon = ICONS[status]
  return (
    <StatusChip tone={CHIP_STATUS_TONES[status]} {...props}>
      {icon && <Icon />}
      {CHIP_STATUS_LABELS[status]}
      {children}
    </StatusChip>
  )
}
