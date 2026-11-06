import type { MouseEvent } from "react"

/** What makes a tab or a row act on a middle click. */
export const onMiddleClick = (action: () => void) => ({
  onAuxClick: (e: MouseEvent) => {
    if (e.button !== 1) return
    e.preventDefault()
    action()
  },
  // a middle press would otherwise start autoscroll
  onMouseDown: (e: MouseEvent) => e.button === 1 && e.preventDefault()
})
