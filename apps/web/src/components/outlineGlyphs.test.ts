import { describe, expect, it } from "@effect/vitest"
import { IconAngle, IconBox, IconBulb, IconCone, IconMapPin, IconTarget } from "@tabler/icons-react"
import { GOAL_CLASS, PLAYER_START_CLASS } from "../domain/MapFile"
import { hasOwnGlyph, itemGlyphOf, lightGlyphOf } from "./outlineGlyphs"

const ramp = { className: "BP_Ramp", category: "Ramps" }
const lightCard = { className: "MP_LightCard_01", category: "Lights" }

describe("hasOwnGlyph", () => {
  it("is the player start and the goal, and no other piece", () => {
    expect(hasOwnGlyph(PLAYER_START_CLASS, undefined)).toBe(true)
    expect(hasOwnGlyph(GOAL_CLASS, undefined)).toBe(true)
    expect(hasOwnGlyph("BP_Ramp", ramp)).toBe(false)
  })

  it("is every light", () => {
    expect(hasOwnGlyph(lightCard.className, lightCard)).toBe(true)
  })
})

describe("itemGlyphOf", () => {
  it("gives the player start and the goal their own, whatever their category", () => {
    const objective = { className: "", category: "Objectives" }
    expect(itemGlyphOf(PLAYER_START_CLASS, objective)).toBe(IconMapPin)
    expect(itemGlyphOf(GOAL_CLASS, objective)).toBe(IconTarget)
  })

  it("gives a piece its category's", () => {
    expect(itemGlyphOf("BP_Ramp", ramp)).toBe(IconAngle)
  })

  it("gives a light the one it has everywhere", () => {
    expect(itemGlyphOf(lightCard.className, lightCard)).toBe(IconCone)
  })

  it("falls back to a box for an item with no category it knows", () => {
    expect(itemGlyphOf("BP_Unknown", undefined)).toBe(IconBox)
    expect(itemGlyphOf("BP_Unknown", { className: "BP_Unknown", category: null })).toBe(IconBox)
    expect(itemGlyphOf("BP_Unknown", { className: "BP_Unknown", category: "Not a category" })).toBe(IconBox)
  })
})

describe("lightGlyphOf", () => {
  it("is nothing for any other piece", () => {
    expect(lightGlyphOf(ramp)).toBeUndefined()
  })

  it("falls back to a bulb for a light a game patch adds", () => {
    expect(lightGlyphOf({ className: "MP_NewLight", category: "Lights" })).toBe(IconBulb)
  })

  it("tells the seven lights apart", () => {
    const classes = [
      "MP_RawPointLight",
      "MP_RawSpotLight",
      "MP_RawRectLight",
      "MP_LightCard_01",
      "MP_LightCard_02",
      "MP_LightCard_03",
      "MP_LightCard_04"
    ]
    expect(new Set(classes.map((className) => lightGlyphOf({ className, category: "Lights" }))).size).toBe(7)
  })
})
