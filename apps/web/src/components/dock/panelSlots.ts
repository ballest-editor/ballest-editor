import { Schema } from "effect"

/**
 * Where a closed panel stood, so it comes back there (docs/DESKTOP.md § Dock). A slot counts the group's closed panels
 * as well as its open ones: Prefabs and Pieces closed in either order and reopened in either order end up as they were.
 */
export interface PanelSlot {
  readonly group: string
  readonly index: number
}

type PanelSlots = ReadonlyMap<string, PanelSlot>

const SavedSlotsSchema = Schema.Struct({
  slots: Schema.Record(Schema.String, Schema.Struct({ group: Schema.String, index: Schema.Finite }))
})

const decodeSavedSlots = Schema.decodeUnknownOption(Schema.fromJsonString(SavedSlotsSchema))

/** The slots saved beside the dock's layout. A layout saved before there were any has none. */
export const parseSavedSlots = (text: string | null): ReadonlyArray<readonly [string, PanelSlot]> => {
  if (text === null) return []
  const decoded = decodeSavedSlots(text)
  return decoded._tag === "None" ? [] : Object.entries(decoded.value.slots)
}

const slotsIn = (slots: PanelSlots, group: string): ReadonlyArray<number> =>
  [...slots.values()].filter((slot) => slot.group === group).map((slot) => slot.index)

/** The slot of a panel closing at `tab`, its place among `group`'s open tabs: past the closed panels before it. */
export const slotAt = (slots: PanelSlots, group: string, tab: number): number =>
  slotsIn(slots, group).toSorted((a, b) => a - b).reduce((slot, taken) => taken <= slot ? slot + 1 : slot, tab)

/** Where panel `id` goes among the `tabs` open in `group`: its slot if it left this group, else the end of the strip. */
export const reopenIndex = (slots: PanelSlots, id: string, group: string, tabs: number): number => {
  const own = slots.get(id)
  if (own?.group !== group) return tabs
  const closedBefore = slotsIn(slots, group).filter((index) => index < own.index).length
  return Math.min(own.index - closedBefore, tabs)
}
