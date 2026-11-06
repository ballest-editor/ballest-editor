import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleDashed,
  IconPencil,
  IconRefreshAlert,
  IconWorldUpload
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { ComponentProps, ComponentType } from "react"
import { LINK_STATE_LABELS, type LinkState } from "../domain/linkState"

const ICONS: Record<LinkState, ComponentType<{ readonly className?: string }>> = {
  notExported: IconCircleDashed,
  inSync: IconCircleCheck,
  editedSinceExport: IconPencil,
  changedInGame: IconRefreshAlert,
  bothChanged: IconAlertTriangle,
  publishedDraft: IconWorldUpload
}

/** `chip` is the fill and `text` sits on a span inside, so the button's hover colour leaves it alone. */
const NEUTRAL = {
  chip: "bg-muted hover:bg-input aria-expanded:bg-input dark:hover:bg-input",
  text: "text-foreground"
}
const GREEN = {
  chip: "bg-emerald-500/15 hover:bg-emerald-500/25 aria-expanded:bg-emerald-500/25 dark:hover:bg-emerald-500/25",
  text: "text-emerald-800 dark:text-emerald-300"
}
const AMBER = {
  chip: "bg-amber-500/15 hover:bg-amber-500/25 aria-expanded:bg-amber-500/25 dark:hover:bg-amber-500/25",
  text: "text-amber-800 dark:text-amber-300"
}

const TONES: Record<LinkState, typeof NEUTRAL> = {
  notExported: NEUTRAL,
  inSync: GREEN,
  editedSinceExport: AMBER,
  changedInGame: AMBER,
  bothChanged: AMBER,
  publishedDraft: NEUTRAL
}

/** A link state as a button: its colour, icon and label, then `children`. */
export function LinkStateChip(
  { state, className, children, ...props }: ComponentProps<typeof Button> & { readonly state: LinkState }
) {
  const Icon = ICONS[state]
  const tone = TONES[state]
  return (
    <Button variant="ghost" size="sm" className={cn("h-5 px-1.5", tone.chip, className)} {...props}>
      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", tone.text)}>
        <Icon className="size-4" />
        {LINK_STATE_LABELS[state]}
        {children}
      </span>
    </Button>
  )
}
