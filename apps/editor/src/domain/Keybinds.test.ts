import { describe, expect, it } from "@effect/vitest"
import { defaultKeybinds, HeldKeys, isBoundChord, keybindActionDescriptions, keybindActionLabels, keybindActions, keybindSections, MODIFIER_HOLD_MS } from "./Keybinds"

describe("keybind table", () => {
  it("lists every action exactly once, with a lower-case label, a description and a default", () => {
    const listed = keybindSections.flatMap((s) => s.actions)
    expect(new Set(listed).size).toBe(listed.length)
    expect(new Set(listed)).toEqual(new Set(Object.keys(defaultKeybinds)))
    for (const action of keybindActions) {
      expect(keybindActionLabels[action]).toBe(keybindActionLabels[action].toLowerCase())
      expect(keybindActionDescriptions[action].length).toBeGreaterThan(10)
    }
  })

  it("uses the game's names and defaults for its free camera", () => {
    const freeCam = keybindSections.find((s) => s.name === "mouse and keyboard free camera")!
    expect(freeCam.actions.map((a) => [keybindActionLabels[a], defaultKeybinds[a]])).toEqual([
      ["forward", "KeyW"],
      ["reverse", "KeyS"],
      ["left", "KeyA"],
      ["right", "KeyD"],
      ["look", "Mouse2"],
      ["up", "Space"],
      ["down", "ShiftLeft"]
    ])
    expect([keybindActionLabels.focusSelection, defaultKeybinds.focusSelection]).toEqual(["center camera", "KeyC"])
    expect(keybindActionDescriptions.scaleMode).toContain("replay camera mode")
    expect(keybindActionDescriptions.moveDown).toContain("Left Ctrl")
    expect(defaultKeybinds.fastMove).toBe("")
  })

  it("has no duplicate defaults (unbound actions aside)", () => {
    const values = Object.values(defaultKeybinds).filter((v) => v !== "")
    expect(new Set(values).size).toBe(values.length)
  })
})

describe("HeldKeys: Left Ctrl = fly down vs Ctrl chords", () => {
  it("flies down only after a short solo hold", () => {
    const keys = new HeldKeys()
    keys.press("ControlLeft", 0)
    expect(keys.holds("ControlLeft", 10)).toBe(false)
    expect(keys.holds("ControlLeft", MODIFIER_HOLD_MS)).toBe(true)
  })

  it("a bound chord (Ctrl+Z) suppresses a modifier movement key until it's released", () => {
    const keys = new HeldKeys()
    keys.press("ControlLeft", 0)
    expect(isBoundChord(defaultKeybinds, "Ctrl+KeyZ")).toBe(true)
    keys.press("KeyZ", 30, isBoundChord(defaultKeybinds, "Ctrl+KeyZ"))
    expect(keys.holds("ControlLeft", 500)).toBe(false)
    keys.release("KeyZ")
    expect(keys.holds("ControlLeft", 1000)).toBe(false) // still the same press
    keys.release("ControlLeft")
    keys.press("ControlLeft", 2000)
    expect(keys.holds("ControlLeft", 2000 + MODIFIER_HOLD_MS)).toBe(true)
  })

  it("Shift (down) + W flies down and forward: movement keys aren't chords", () => {
    const keys = new HeldKeys()
    keys.press("ShiftLeft", 0)
    expect(isBoundChord(defaultKeybinds, "Shift+KeyW")).toBe(false)
    keys.press("KeyW", 10, isBoundChord(defaultKeybinds, "Shift+KeyW"))
    expect(keys.holds(defaultKeybinds.moveDown, 500)).toBe(true)
    expect(keys.holds(defaultKeybinds.moveForward, 500)).toBe(true)
  })

  it("plain keys hold immediately", () => {
    const keys = new HeldKeys()
    keys.press("KeyW", 0)
    expect(keys.holds("KeyW", 0)).toBe(true)
    expect(keys.holds("", 0)).toBe(false)
  })
})
