/**
 * The status bar's hint line, at its left as in Blender: what the keys and the mouse do to the control under the pointer
 * or being typed in. Each control keeps its own hint until it clears it, and the latest one shows, so leaving a hovered
 * field gives the line back to the field still being typed in.
 */
import { create } from "zustand"

/** One hint: a chord as `Keybinds` writes it (`Shift`, `Mouse0`), shown as a key chip, then what it does. */
export interface HintItem {
  readonly keys?: string
  readonly text: string
}

export type StatusHint = ReadonlyArray<HintItem>

interface Shown {
  readonly owner: string
  readonly hint: StatusHint
}

interface StatusHintState {
  /** Every control's hint, oldest first. */
  readonly shown: ReadonlyArray<Shown>
  /** The one the status bar shows: the latest. */
  readonly hint: StatusHint | null
}

export const useStatusHint = create<StatusHintState>()(() => ({ shown: [], hint: null }))

const setShown = (shown: ReadonlyArray<Shown>): void =>
  useStatusHint.setState({ shown, hint: shown.at(-1)?.hint ?? null })

const without = (owner: string): ReadonlyArray<Shown> =>
  useStatusHint.getState().shown.filter((entry) => entry.owner !== owner)

export const showStatusHint = (owner: string, hint: StatusHint): void => setShown([...without(owner), { owner, hint }])

export const clearStatusHint = (owner: string): void => setShown(without(owner))
