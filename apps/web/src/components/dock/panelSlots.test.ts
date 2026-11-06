import { assert, describe, it } from "@effect/vitest"
import { type PanelSlot, parseSavedSlots, reopenIndex, slotAt } from "./panelSlots"

/** Closes the panels of `strip` in the order given, and reopens them in another, as the dock would. */
const closeThenReopen = (
  strip: ReadonlyArray<string>,
  closed: ReadonlyArray<string>,
  reopened: ReadonlyArray<string>
) => {
  const slots = new Map<string, PanelSlot>()
  const open = [...strip]
  for (const id of closed) {
    slots.set(id, { group: "1", index: slotAt(slots, "1", open.indexOf(id)) })
    open.splice(open.indexOf(id), 1)
  }
  for (const id of reopened) {
    open.splice(reopenIndex(slots, id, "1", open.length), 0, id)
    slots.delete(id)
  }
  return open
}

describe("a closed panel's slot", () => {
  const strip = ["project", "pieces", "prefabs", "outline"]

  it("brings one panel back where it was, first, between two, or last", () => {
    for (const id of strip) assert.deepStrictEqual(closeThenReopen(strip, [id], [id]), strip)
  })

  it("brings two panels back as they were, whichever order they closed and reopen in", () => {
    const pair = ["pieces", "prefabs"]
    const reversed = pair.toReversed()
    for (const closed of [pair, reversed]) {
      for (const reopened of [pair, reversed]) assert.deepStrictEqual(closeThenReopen(strip, closed, reopened), strip)
    }
  })

  it("is the end of the strip for a panel that left another group, or none", () => {
    const slots = new Map([["prefabs", { group: "2", index: 0 }]])
    assert.strictEqual(reopenIndex(slots, "prefabs", "1", 3), 3)
    assert.strictEqual(reopenIndex(slots, "pieces", "2", 3), 3)
  })

  it("never lands past the end of a strip that has shrunk", () => {
    assert.strictEqual(reopenIndex(new Map([["outline", { group: "1", index: 3 }]]), "outline", "1", 1), 1)
  })

  it("reads slots saved beside the layout, and none from a layout saved before them", () => {
    const slot = { group: "1", index: 2 }
    assert.deepStrictEqual(parseSavedSlots(JSON.stringify({ slots: { prefabs: slot } })), [["prefabs", slot]])
    assert.deepStrictEqual(parseSavedSlots(JSON.stringify({ layout: {} })), [])
    assert.deepStrictEqual(parseSavedSlots("{nope"), [])
    assert.deepStrictEqual(parseSavedSlots(null), [])
  })
})
