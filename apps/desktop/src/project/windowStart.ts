import type { WindowEntry } from "./WindowRegistry"

/** Where a window starts: on `project` (null: Untitled Project), or, when `chooser`, nowhere until the user picks. */
export interface WindowStart {
  readonly project: string | null
  readonly chooser: boolean
}

const CHOOSER: WindowStart = { project: null, chooser: true }

/**
 * One project per window (docs/DESKTOP.md § Other windows). A window started with `--project` goes there (`requested`,
 * already checked), and another with no say of its own takes the last project used (`lastUsed`), or Untitled Project.
 * It shows the chooser instead when the project it would take is open in another window, or when another window is on
 * Untitled Project: there is only ever one of those, and a new window isn't it.
 */
export const decideStart = (
  { lastUsed, others, requested, same }: {
    readonly requested: string | null
    readonly lastUsed: string | null
    readonly others: ReadonlyArray<WindowEntry>
    readonly same: (a: string, b: string) => boolean
  }
): WindowStart => {
  const isOpen = (folder: string) => others.some((window) => window.project !== null && same(window.project, folder))
  if (requested !== null) return isOpen(requested) ? CHOOSER : { project: requested, chooser: false }
  const untitledElsewhere = others.some((window) => window.project === null && !window.choosing)
  if (untitledElsewhere || (lastUsed !== null && isOpen(lastUsed))) return CHOOSER
  return { project: lastUsed, chooser: false }
}
