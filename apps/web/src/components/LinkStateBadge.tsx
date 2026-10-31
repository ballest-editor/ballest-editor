import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleDashed,
  IconPencil,
  IconRefreshAlert,
  IconWorldUpload
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { ComponentType } from "react"
import { LINK_STATE_LABELS, type LinkState } from "../domain/linkState"

const ICONS: Record<LinkState, ComponentType<{ readonly className?: string }>> = {
  notExported: IconCircleDashed,
  inSync: IconCircleCheck,
  editedSinceExport: IconPencil,
  changedInGame: IconRefreshAlert,
  bothChanged: IconAlertTriangle,
  publishedDraft: IconWorldUpload
}

/** What each state means, for the status bar's popover. */
export const LINK_STATE_HELP: Record<LinkState, string> = {
  notExported: "The game's maps folder doesn't have this map yet. Export it to open or race it in the game.",
  inSync: "The game's maps folder has this map exactly as it is saved here.",
  editedSinceExport: "The map has changed since it was exported; the game still has the earlier version.",
  changedInGame: "The in-game editor has changed the exported copy since the last export.",
  bothChanged: "The map has changed here and in the game since the last export.",
  publishedDraft: "The export is the draft of a map published to the Workshop."
}

const TONES: Partial<Record<LinkState, string>> = {
  inSync: "text-emerald-600 dark:text-emerald-400",
  changedInGame: "text-amber-600 dark:text-amber-400",
  bothChanged: "text-amber-600 dark:text-amber-400"
}

/** A link state as an icon and its label. */
export function LinkStateBadge({ state, className }: { readonly state: LinkState; readonly className?: string }) {
  const Icon = ICONS[state]
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", TONES[state], className)}>
      <Icon className="size-3.5 shrink-0" />
      {LINK_STATE_LABELS[state]}
    </span>
  )
}
