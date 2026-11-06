import { describe, expect, it } from "vitest"
import { devMenuTemplate, isPopoutUrl, popoutOverlay, titleBarOverlay, windowShortcutOf } from "./chrome"

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
  it("takes only the app's own popout page for a panel's window", () => {
    const app = new URL("ballest://app/")
    expect(isPopoutUrl("ballest://app/popout.html", app)).toBe(true)
    expect(isPopoutUrl("ballest://app/index.html", app)).toBe(false)
    expect(isPopoutUrl("ballest://other/popout.html", app)).toBe(false)
    expect(isPopoutUrl("https://app/popout.html", app)).toBe(false)
    expect(isPopoutUrl("not a url", app)).toBe(false)
  })

  it("draws a panel's window controls over its tab strip, in the main window's colours", () => {
    const overlay = titleBarOverlay(false)
    expect(popoutOverlay(overlay)).toEqual({ ...overlay, height: 32 })
  })

  it("matches only the plain window shortcuts", () => {
    expect(windowShortcutOf(key("F11"))).toBe("toggleFullScreen")
    expect(windowShortcutOf(key("KeyQ", { control: true }))).toBe("quit")
    expect(windowShortcutOf(key("KeyQ"))).toBeUndefined()
    expect(windowShortcutOf(key("KeyQ", { control: true, shift: true }))).toBeUndefined()
    expect(windowShortcutOf(key("F11", { alt: true }))).toBeUndefined()
    expect(windowShortcutOf({ ...key("F11"), type: "keyUp" })).toBeUndefined()
    expect(windowShortcutOf({ ...key("F11"), isAutoRepeat: true })).toBeUndefined()
  })

  it("leaves Ctrl+W to the page: the dev menu only reloads and opens DevTools", () => {
    const items = devMenuTemplate.flatMap(({ submenu }) => Array.isArray(submenu) ? submenu : [])
    // An exact list, since the roles that group others (`windowMenu`, `fileMenu`) bring `close` with them.
    expect(items.map(({ role }) => role)).toEqual(["reload", "forceReload", "toggleDevTools"])
    expect(items.filter(({ accelerator }) => accelerator !== undefined)).toEqual([])
    expect(devMenuTemplate.filter(({ role }) => role !== undefined)).toEqual([])
  })

  it("draws the window controls in the page theme's foreground", () => {
    expect(titleBarOverlay(true)).toEqual({ color: "#01000000", symbolColor: "#f5f7f9", height: 40 })
    expect(titleBarOverlay(false).symbolColor).toBe("#393d42")
  })
})
