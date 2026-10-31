import { describe, expect, it } from "vitest"
import { titleBarOverlay, windowShortcutOf } from "./chrome"

const key = (code: string, modifiers: Partial<Record<"control" | "shift" | "alt" | "meta", boolean>> = {}) => ({
  type: "keyDown",
  code,
  key: code,
  isAutoRepeat: false,
  isComposing: false,
  control: false,
  shift: false,
  alt: false,
  meta: false,
  location: 0,
  modifiers: [],
  ...modifiers
})

describe("window chrome", () => {
  it("matches only the plain window shortcuts", () => {
    expect(windowShortcutOf(key("F11"))).toBe("toggleFullScreen")
    expect(windowShortcutOf(key("KeyQ", { control: true }))).toBe("quit")
    expect(windowShortcutOf(key("KeyQ"))).toBeUndefined()
    expect(windowShortcutOf(key("KeyQ", { control: true, shift: true }))).toBeUndefined()
    expect(windowShortcutOf(key("F11", { alt: true }))).toBeUndefined()
    expect(windowShortcutOf({ ...key("F11"), type: "keyUp" })).toBeUndefined()
    expect(windowShortcutOf({ ...key("F11"), isAutoRepeat: true })).toBeUndefined()
  })

  it("draws the window controls in the page theme's foreground", () => {
    expect(titleBarOverlay(true)).toEqual({ color: "#01000000", symbolColor: "#fafafa", height: 40 })
    expect(titleBarOverlay(false).symbolColor).toBe("#09090b")
  })
})
