import { describe, expect, it } from "@effect/vitest"
import { IconAngle, IconBox, IconMapPin, IconTarget } from "@tabler/icons-react"
import { GOAL_CLASS, PLAYER_START_CLASS } from "../domain/MapFile"
import { hasOwnGlyph, itemGlyphOf } from "./outlineGlyphs"

describe("hasOwnGlyph", () => {
  it("is the player start and the goal, and no other piece", () => {
    expect(hasOwnGlyph(PLAYER_START_CLASS)).toBe(true)
    expect(hasOwnGlyph(GOAL_CLASS)).toBe(true)
    expect(hasOwnGlyph("BP_Ramp")).toBe(false)
  })
})

describe("itemGlyphOf", () => {
  it("gives the player start and the goal their own, whatever their category", () => {
    expect(itemGlyphOf(PLAYER_START_CLASS, "Objectives")).toBe(IconMapPin)
    expect(itemGlyphOf(GOAL_CLASS, "Objectives")).toBe(IconTarget)
  })

  it("gives a piece its category's", () => {
    expect(itemGlyphOf("BP_Ramp", "Ramps")).toBe(IconAngle)
  })

  it("falls back to a box for an item with no category it knows", () => {
    expect(itemGlyphOf("BP_Unknown", null)).toBe(IconBox)
    expect(itemGlyphOf("BP_Unknown", undefined)).toBe(IconBox)
    expect(itemGlyphOf("BP_Unknown", "Not a category")).toBe(IconBox)
  })
})
