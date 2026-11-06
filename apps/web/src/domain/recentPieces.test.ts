import { assert, describe, it } from "@effect/vitest"
import { RECENT_PIECES, withFavouriteToggled, withRecentPiece } from "./recentPieces"
import { defaultSettings, mergeSettings } from "./Settings"

describe("withRecentPiece", () => {
  it("lists the newest first", () => {
    assert.deepStrictEqual(["a", "b", "c"].reduce<ReadonlyArray<string>>(withRecentPiece, []), ["c", "b", "a"])
  })

  it("moves a piece placed again to the front rather than listing it twice", () => {
    assert.deepStrictEqual(withRecentPiece(["a", "b", "c"], "c"), ["c", "a", "b"])
  })

  it("drops the oldest past the limit", () => {
    const ids = Array.from({ length: RECENT_PIECES + 2 }, (_, i) => `${i}`)
    const recent = ids.reduce<ReadonlyArray<string>>(withRecentPiece, [])
    assert.strictEqual(recent.length, RECENT_PIECES)
    assert.strictEqual(recent[0], ids.at(-1))
    assert.notInclude(recent, "0")
  })
})

describe("withFavouriteToggled", () => {
  it("stars a piece at the end of the list", () => {
    assert.deepStrictEqual(withFavouriteToggled(["a"], "b"), ["a", "b"])
  })

  it("takes a star off", () => {
    assert.deepStrictEqual(withFavouriteToggled(["a", "b"], "a"), ["b"])
  })
})

describe("the lists in settings", () => {
  it("come back as saved", () => {
    const panels = { ...defaultSettings.panels, recentPieces: ["a", "b"], favouritePieces: ["b"] }
    const saved: unknown = JSON.parse(JSON.stringify({ ...defaultSettings, panels }))
    assert.deepStrictEqual(mergeSettings(saved).panels, panels)
  })

  it("are empty in a save from before they existed, or one that doesn't read", () => {
    assert.deepStrictEqual(mergeSettings({ panels: { piecesView: "grid" } }).panels, {
      ...defaultSettings.panels,
      piecesView: "grid"
    })
    assert.deepStrictEqual(
      mergeSettings({ panels: { recentPieces: "a", favouritePieces: [1] } }).panels,
      defaultSettings.panels
    )
  })
})
