import { useState } from "react"

/** Runs `start` in the render where `open` turns true: how a dialog that stays mounted starts over each time it opens. */
export const useOnOpen = (open: boolean, start: () => void) => {
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) start()
  }
}
