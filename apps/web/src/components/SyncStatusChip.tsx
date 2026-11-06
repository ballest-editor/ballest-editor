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

/** The hover a chip gets when it renders as a button: its tone's fill is `Badge`'s. */
const BUTTON_TONES: Record<SyncTone, string> = {
  neutral:
    "[button]:hover:lift-status-neutral [button]:active:press-status-neutral [button]:aria-expanded:lift-status-neutral",
  ok: "[button]:hover:lift-status-ok [button]:active:press-status-ok [button]:aria-expanded:lift-status-ok",
  warn: "[button]:hover:lift-status-warn [button]:active:press-status-warn [button]:aria-expanded:lift-status-warn"
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
      variant={tone}
      className={cn("transition-none [&>svg]:size-3.5!", BUTTON_TONES[tone], className)}
      {...props}
    />
  )
}

/**
 * A sync status as a chip: its colour, icon and label, then `children`. `render` makes it something else, a button, and
 * a Project panel row has no room for the icon.
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
 * The status bar's chip: `SyncStatusChip`, as wide as its label, in the room of the widest (`WIDEST_CHIP_LABEL`), so the
 * bar around it stays put whatever it says. While `write` runs it fills that room and says the stage, with the bar
 * filling behind the label.
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
    <span className="grid justify-items-center">
      <StatusChip tone="neutral" className="invisible col-start-1 row-start-1" aria-hidden>
        <Icon />
        {WIDEST_CHIP_LABEL}
      </StatusChip>
      <StatusChip
        tone={write === null ? CHIP_STATUS_TONES[status] : "neutral"}
        {...props}
        className={cn("relative isolate col-start-1 row-start-1", write !== null && "w-full")}
      >
        {write !== null && (
          <Progress
            value={gameWritePercentOf(write)}
            aria-label={label}
            className="absolute inset-0 -z-10 h-auto rounded-none bg-transparent"
            barClassName="bg-current opacity-20"
          />
        )}
        <Icon />
        {label}
      </StatusChip>
    </span>
  )
}
