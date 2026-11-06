import { useState } from "react"
import { type PaneCamera, paneCameraAt } from "./paneCameras"
import { useBeforePaneDraw } from "./PaneRenderer"

/**
 * What `read` says of the pane in `slot`, followed as that pane draws: cameras aren't React state, and the chrome over a
 * pane has to keep up with them. `same` keeps what hasn't changed from rendering again.
 */
export const usePaneReading = <T>(
  slot: number,
  read: (pane: PaneCamera) => T,
  same: (a: T, b: T) => boolean = Object.is
): T => {
  const [reading, setReading] = useState(() => read(paneCameraAt(slot)))
  useBeforePaneDraw((pane, drawn) => {
    if (drawn !== slot) return
    const next = read(pane)
    setReading((last) => same(last, next) ? last : next)
  })
  return reading
}
