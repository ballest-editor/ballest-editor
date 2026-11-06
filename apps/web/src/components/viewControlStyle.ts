import type { KeyboardEvent, MouseEvent } from "react"

/**
 * The one surface every overlay over the viewport sits on, so they read as one family against any scene: glass, the
 * card's colour with what's behind it showing through as colour without detail.
 */
export const SURFACE = "border border-border bg-card/95 shadow-sm backdrop-blur-md backdrop-saturate-150"

/** One control group: a 32px glass pill holding its segments, each a smaller pill of its own. */
export const GROUP = `pointer-events-auto flex h-8 w-fit items-center gap-0.5 rounded-full p-0.5 ${SURFACE}`

/** A hairline between the parts of a group. */
export const GROUP_DIVIDER = "mx-0.5 h-4 w-px shrink-0 bg-border"

/** A button in a group. */
export const SEGMENT =
  "flex h-full min-w-7 items-center justify-center gap-1.5 rounded-full px-2 text-fg-secondary transition-colors focus-ring hover:bg-hover hover:text-foreground active:bg-pressed aria-expanded:bg-hover aria-expanded:text-foreground disabled:text-fg-disabled"

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
