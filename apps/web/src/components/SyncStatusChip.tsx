import {
  IconCheck,
  IconCircleCheck,
  IconCircleDashed,
  IconFileExport,
  IconPencil,
  IconPlayerPlay,
  IconRefreshAlert,
  IconWorldUpload
} from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Progress } from "@workspace/ui/components/progress"
import { cn } from "@workspace/ui/lib/utils"
import type { ComponentProps, ComponentType } from "react"
import {
  CHIP_STATUS_LABELS,
  CHIP_STATUS_TONES,
  type ChipStatus,
  GAME_WRITE_STAGE_LABELS,
  type GameWrite,
  gameWritePercentOf,
  type SyncTone,
  WIDEST_CHIP_LABEL
} from "../domain/linkState"

const ICONS: Record<ChipStatus, ComponentType<{ readonly className?: string }>> = {
  saved: IconCheck,
  unsaved: IconPencil,
  notExported: IconCircleDashed,
  inSync: IconCircleCheck,
  changedSinceExport: IconRefreshAlert,
  publishedDraft: IconWorldUpload
}

const WRITE_ICONS: Record<GameWrite["intent"], ComponentType<{ readonly className?: string }>> = {
  export: IconFileExport,
  play: IconPlayerPlay
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

/**
 * The status bar's chip: `SyncStatusChip` at one width whatever it says (`WIDEST_CHIP_LABEL` holds the room), with its
 * icon and label in the same place. While `write` runs it says the stage, with the bar filling behind the label.
 */
export function StatusBarChip(
  { status, write, ...props }: Omit<ComponentProps<typeof Badge>, "children"> & {
    readonly status: ChipStatus
    readonly write: GameWrite | null
  }
) {
  const Icon = write === null ? ICONS[status] : WRITE_ICONS[write.intent]
  const label = write === null ? CHIP_STATUS_LABELS[status] : GAME_WRITE_STAGE_LABELS[write.stage]
  return (
    <StatusChip tone={write === null ? CHIP_STATUS_TONES[status] : "neutral"} {...props} className="relative isolate">
      {write !== null && (
        <Progress
          value={gameWritePercentOf(write)}
          aria-label={label}
          className="absolute inset-0 -z-10 h-auto rounded-none bg-transparent"
          barClassName="bg-current opacity-20"
        />
      )}
      <Icon />
      <span className="grid text-left">
        <span className="invisible col-start-1 row-start-1" aria-hidden>{WIDEST_CHIP_LABEL}</span>
        <span className="col-start-1 row-start-1">{label}</span>
      </span>
    </StatusChip>
  )
}
