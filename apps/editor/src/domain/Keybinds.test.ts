import { describe, expect, it } from "@effect/vitest"
import {
  actionsFor,
  defaultKeybinds,
  formatBinding,
  formatBindings,
  HeldKeys,
  isBoundChord,
  isDefaultBinding,
  isOneShotChord,
  keybindActionDescriptions,
  keybindActionLabels,
  keybindActions,
  keybindSections,
  mergeKeybinds,
  MODIFIER_HOLD_MS,
  releasesBinding
} from "./Keybinds"

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

  it("uses the game's level-editor hotkeys and names", () => {
    const editor = keybindSections.find((s) => s.name === "level editor")!
    expect(editor.actions.map((a) => [keybindActionLabels[a], defaultKeybinds[a]])).toEqual([
      ["select", ["KeyQ"]],
      ["translate", ["KeyW"]],
      ["rotate", ["KeyE"]],
      ["scale", ["KeyR"]],
      ["local / world axes", ["KeyX"]], // editor only
      ["focus selection", ["KeyF", "KeyC"]],
      ["add to selection", ["Shift+Mouse0"]],
      ["toggle selection", ["Ctrl+Mouse0"]]
    ])
    const edit = keybindSections.find((s) => s.name === "edit")!
    expect(edit.actions.map((a) => [keybindActionLabels[a], defaultKeybinds[a]])).toEqual([
      ["undo", ["Ctrl+KeyZ"]],
      ["redo", ["Ctrl+KeyY", "Ctrl+Shift+KeyZ"]],
      ["cut", ["Ctrl+KeyX"]], // editor only
      ["copy", ["Ctrl+KeyC"]],
      ["paste", ["Ctrl+KeyV"]],
      ["duplicate", ["Ctrl+KeyD"]],
      ["delete", ["Backspace", "Delete"]],
      ["deselect", ["Escape"]]
    ])
  })

  it("uses the game's names and defaults for its free camera", () => {
    const freeCam = keybindSections.find((s) => s.name === "mouse and keyboard free camera")!
    expect(freeCam.actions.map((a) => [keybindActionLabels[a], defaultKeybinds[a]])).toEqual([
      ["forward", ["KeyW"]],
      ["reverse", ["KeyS"]],
      ["left", ["KeyA"]],
      ["right", ["KeyD"]],
      ["look", ["Mouse2"]],
      ["up", ["Space"]],
      ["down", ["ShiftLeft"]]
    ])
    expect(keybindActionDescriptions.moveDown).toContain("Left Ctrl")
    expect(defaultKeybinds.fastMove).toEqual([])
  })

  it("only shares keys between a fly key and a tool shortcut (W: forward + translate, as in the game)", () => {
    const seen = new Map<string, Array<string>>()
    for (const [action, bindings] of Object.entries(defaultKeybinds)) {
      for (const b of bindings) seen.set(b, [...(seen.get(b) ?? []), action])
    }
    const shared = [...seen].filter(([, actions]) => actions.length > 1)
    expect(shared).toEqual([["KeyW", ["translateMode", "moveForward"]]])
    expect(isOneShotChord(defaultKeybinds, "KeyW")).toBe(true)
    expect(isOneShotChord(defaultKeybinds, "KeyS")).toBe(false)
    expect(actionsFor(defaultKeybinds, "KeyC")).toEqual(["focusSelection"])
  })

  it("merges stored bindings, accepting the old single-string form", () => {
    const merged = mergeKeybinds({ undo: "Ctrl+KeyU", redo: ["Ctrl+KeyR", "Ctrl+KeyR", ""], bogus: "KeyX" })
    expect(merged.undo).toEqual(["Ctrl+KeyU"])
    expect(merged.redo).toEqual(["Ctrl+KeyR"])
    expect(merged).not.toHaveProperty("bogus")
    expect(isDefaultBinding(merged, defaultKeybinds, "undo")).toBe(false)
    expect(isDefaultBinding(merged, defaultKeybinds, "moveForward")).toBe(true)
  })

  it("formats bindings for display", () => {
    expect(formatBinding("Ctrl+KeyZ")).toBe("Ctrl + Z")
    expect(formatBinding("Alt+Mouse0")).toBe("Alt + LMB")
    expect(formatBinding("Mouse3")).toBe("Mouse 4")
    expect(formatBinding("ArrowLeft")).toBe("←")
    expect(formatBindings(["KeyF", "KeyC"])).toBe("F / C")
    expect(formatBindings([])).toBe("Unbound")
    expect(formatBinding("Shift+Slash")).toBe("Shift + /")
  })

  it("ends a held binding when its key or one of its modifiers is released", () => {
    expect(releasesBinding("Shift+Slash", "Slash")).toBe(true)
    expect(releasesBinding("Shift+Slash", "ShiftRight")).toBe(true)
    expect(releasesBinding("Ctrl+Slash", "MetaLeft")).toBe(true)
    expect(releasesBinding("Shift+Slash", "KeyW")).toBe(false)
    expect(releasesBinding("Shift+Slash", "ControlLeft")).toBe(false)
  })

  it("shows the cheat sheet on Shift+/ as a one-shot chord, so Shift doesn't fly the camera down", () => {
    expect(defaultKeybinds.showKeybinds).toEqual(["Shift+Slash"])
    expect(isBoundChord(defaultKeybinds, "Shift+Slash")).toBe(true)
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
    expect(keys.holdsAny(defaultKeybinds.moveDown, 500)).toBe(true)
    expect(keys.holdsAny(defaultKeybinds.moveForward, 500)).toBe(true)
  })

  it("plain keys hold immediately", () => {
    const keys = new HeldKeys()
    keys.press("KeyW", 0)
    expect(keys.holds("KeyW", 0)).toBe(true)
    expect(keys.holds("", 0)).toBe(false)
    expect(keys.holdsAny([], 0)).toBe(false)
  })
})
