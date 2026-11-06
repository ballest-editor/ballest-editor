import type { KeyboardEvent, MouseEvent } from "react"

/**
 * The one frosted surface every overlay over the viewport sits on: the control groups, the tool bar and the panes'
 * labels, so they read as one family against any scene.
 */
export const FROSTED = "border border-border/60 bg-background/60 shadow-lg backdrop-blur-md"

/** One frosted button group; each control gets its own, like the game's. */
export const GROUP = `pointer-events-auto flex items-center gap-1 rounded-full p-1 ${FROSTED}`

/** Popups clear a group's padding and border, plus the usual 4px: `button` from a 32px button, `size` from a 24px picker. */
export const POPUP_OFFSET = { button: 9, size: 13 } as const

/** Keeps keyboard focus with the viewport: no focus on mousedown, no Space/Enter activation. */
export const noFocus = {
  tabIndex: -1,
  onMouseDown: (e: MouseEvent) => e.preventDefault(),
  onKeyDown: (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") e.preventDefault()
  }
}
