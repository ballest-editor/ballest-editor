import type { KeyboardEvent, MouseEvent } from "react"

/**
 * The one surface every overlay over the viewport sits on, so they read as one family against any scene: the card's
 * colour, translucent, which follows the theme.
 */
export const SURFACE = "border border-border bg-card/80 shadow-sm backdrop-blur-md"

/**
 * One control group, like the game's: a 28px rounded rect at the control radius, divided into segments that fill it.
 * The group is the only shape, with no padding and no container around it, so there's no second radius in the viewport.
 */
export const GROUP =
  `pointer-events-auto flex h-7 w-fit items-stretch divide-x divide-border overflow-hidden rounded-control ${SURFACE}`

/** A button in a group. */
export const SEGMENT =
  "flex h-full min-w-7 items-center justify-center gap-1 rounded-none px-1.5 text-fg-secondary outline-none transition-colors hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground disabled:text-fg-disabled"

/** A toggle segment that's on. */
export const SEGMENT_ON =
  "data-[pressed]:bg-primary data-[pressed]:text-primary-foreground data-[pressed]:hover:bg-primary/85 data-[pressed]:hover:text-primary-foreground"

/** Keeps keyboard focus with the viewport: no focus on mousedown, no Space/Enter activation. */
export const noFocus = {
  tabIndex: -1,
  onMouseDown: (e: MouseEvent) => e.preventDefault(),
  onKeyDown: (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") e.preventDefault()
  }
}

/** For a popup's `onOpenChangeComplete`: hands focus back to the viewport, so Space doesn't reopen it. */
export const releaseFocus = (open: boolean): void => {
  if (!open && document.activeElement instanceof HTMLElement) document.activeElement.blur()
}
