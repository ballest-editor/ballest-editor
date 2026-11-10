import type { WindowEntry } from "./WindowRegistry"

/** Where a window starts: on `project`, or, when `chooser`, on the welcome window until the user picks. */
interface WindowStart {
  readonly project: string | null
  readonly chooser: boolean
}

const CHOOSER: WindowStart = { project: null, chooser: true }

/**
 * One project per window (docs/DESKTOP.md § Other windows). A window started with `--project` goes there (`requested`,
 * already checked), unless another window has it open. Every other window starts on the welcome window.
 */
export const decideStart = (
  { others, requested, same }: {
    readonly requested: string | null
    readonly others: ReadonlyArray<WindowEntry>
    readonly same: (a: string, b: string) => boolean
  }
): WindowStart => {
  if (requested === null) return CHOOSER
  const isOpen = others.some((window) => window.project !== null && same(window.project, requested))
  return isOpen ? CHOOSER : { project: requested, chooser: false }
}
