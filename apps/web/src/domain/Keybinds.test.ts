import { describe, expect, it } from "@effect/vitest"
import {
  actionsFor,
  conflictingBindings,
  defaultKeybinds,
  dragChordOf,
  formatBinding,
  formatBindings,
  HeldKeys,
  isBoundChord,
  isDefaultBinding,
  isOneShotChord,
  keybindActionDescriptions,
  keybindActionLabels,
  keybindActions,
  type Keybinds,
  keybindSections,
  mergeKeybinds,
  MODIFIER_HOLD_MS,
  PROJECTION_ACTIONS,
  releasesBinding,
  wheelSpeedStep
} from "./Keybinds"
import { viewProjections } from "./viewLayout"

describe("keybind table", () => {
  it("has each pane view's own key, for its tooltip and the View menu", () => {
    expect(Object.fromEntries(viewProjections.map((view) => [view, defaultKeybinds[PROJECTION_ACTIONS[view]]])))
      .toEqual({
        perspective: ["Numpad5"],
        top: ["Numpad7"],
        bottom: ["Ctrl+Numpad7"],
        front: ["Numpad1"],
        back: ["Ctrl+Numpad1"],
        left: ["Ctrl+Numpad3"],
        right: ["Numpad3"]
      })
  })

  it("lists every action exactly once, with a lower-case label, a description and a default", () => {
    const listed = keybindSections.flatMap((s) => s.actions)
    expect(new Set(listed).size).toBe(listed.length)
    expect(new Set(listed)).toEqual(new Set(Object.keys(defaultKeybinds)))
    for (const action of keybindActions) {
      expect(keybindActionLabels[action]).toBe(keybindActionLabels[action].toLowerCase())
      expect(keybindActionDescriptions[action].length).toBeGreaterThan(10)
    }
  })

  it("uses the in-game editor's hotkeys and names", () => {
    const editor = keybindSections.find((s) => s.name === "editor")!
    expect(editor.actions.map((a) => [keybindActionLabels[a], defaultKeybinds[a]])).toEqual([
      ["select", ["KeyQ"]],
      ["move", ["KeyW"]],
      ["rotate", ["KeyE"]],
      ["scale", ["KeyR"]],
      ["local / world axes", ["KeyC"]],
      ["together / each pivot", ["Period"]], // editor only
      ["focus selection", ["KeyF"]],
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
      ["select all", ["Ctrl+KeyA"]],
      ["deselect", ["Escape"]],
      ["enter group", ["Enter", "NumpadEnter"]], // editor only
      ["group", ["Ctrl+KeyG"]],
      ["ungroup", ["Shift+KeyG"]]
    ])
  })

  it("uses the game's names and defaults for its free camera", () => {
    const camera = keybindSections.find((s) => s.name === "camera")!
    expect(camera.actions.slice(0, 7).map((a) => [keybindActionLabels[a], defaultKeybinds[a]])).toEqual([
      ["forward", ["KeyW"]],
      ["reverse", ["KeyS"]],
      ["left", ["KeyA"]],
      ["right", ["KeyD"]],
      ["look", ["Mouse2"]],
      ["up", ["Space"]],
      ["down", ["ControlLeft"]]
    ])
    expect(keybindActionDescriptions.moveDown).toContain("Left Ctrl")
    expect(defaultKeybinds.fastMove).toEqual([])
  })

  it("only shares keys between a fly key and a tool shortcut (W: forward + translate, as in the game) or a drag's", () => {
    const seen = new Map<string, Array<string>>()
    for (const [action, bindings] of Object.entries(defaultKeybinds)) {
      for (const b of bindings) seen.set(b, [...(seen.get(b) ?? []), action])
    }
    const shared = [...seen].filter(([, actions]) => actions.length > 1)
    // Ctrl is snapping's only once a drag has begun, and flying's otherwise
    expect(shared).toEqual([["ControlLeft", ["snapInvert", "moveDown"]], ["KeyW", ["translateMode", "moveForward"]]])
    expect(isOneShotChord(defaultKeybinds, "KeyW")).toBe(true)
    expect(isOneShotChord(defaultKeybinds, "KeyS")).toBe(false)
    expect(actionsFor(defaultKeybinds, "KeyC")).toEqual(["toggleGizmoSpace"])
    expect(actionsFor(defaultKeybinds, "KeyF")).toEqual(["focusSelection"])
    expect(actionsFor(defaultKeybinds, "KeyX")).toEqual(["snapLockX"])
    expect(isOneShotChord(defaultKeybinds, "KeyX")).toBe(false)
  })

  it("merges stored bindings, accepting the old single-string form", () => {
    const merged = mergeKeybinds({ undo: "Ctrl+KeyU", redo: ["Ctrl+KeyR", "Ctrl+KeyR", ""], bogus: "KeyX" })
    expect(merged.undo).toEqual(["Ctrl+KeyU"])
    expect(merged.redo).toEqual(["Ctrl+KeyR"])
    expect(merged).not.toHaveProperty("bogus")
    expect(isDefaultBinding(merged, defaultKeybinds, "undo")).toBe(false)
    expect(isDefaultBinding(merged, defaultKeybinds, "moveForward")).toBe(true)
  })

  it("keeps bindings saved under the file actions' old names", () => {
    const merged = mergeKeybinds({ importMap: ["Ctrl+KeyI"], exportMap: ["Ctrl+Shift+KeyE"] })
    expect(merged.openMap).toEqual(["Ctrl+KeyI"])
    expect(merged.saveMapAs).toEqual(["Ctrl+Shift+KeyE"])
    expect(merged.saveMap).toEqual(["Ctrl+KeyS"])
    expect(mergeKeybinds({ importMap: ["Ctrl+KeyI"], openMap: ["Ctrl+KeyP"] }).openMap).toEqual(["Ctrl+KeyP"])
  })

  it("formats bindings for display", () => {
    expect(formatBinding("Ctrl+KeyZ")).toBe("Ctrl + Z")
    expect(formatBinding("Ctrl+Shift+KeyZ", true)).toBe("⌘ + Shift + Z")
    expect(formatBinding("Alt+Mouse0")).toBe("Alt + LMB")
    expect(formatBinding("Mouse3")).toBe("Mouse 4")
    expect(formatBinding("Numpad7")).toBe("Num 7")
    expect(formatBinding("Ctrl+Numpad1")).toBe("Ctrl + Num 1")
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

  it("skips the hold when told to, but not a chord's suppression", () => {
    const keys = new HeldKeys()
    keys.press("ControlLeft", 0)
    expect(keys.holds("ControlLeft", 0, true)).toBe(true)
    keys.suppressModifiers()
    expect(keys.holds("ControlLeft", 0, true)).toBe(false)
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

  it("a click chord (Ctrl+click) suppresses it too", () => {
    const keys = new HeldKeys()
    keys.press("ControlLeft", 0)
    keys.suppressModifiers()
    expect(keys.holds("ControlLeft", 500)).toBe(false)
  })

  it("Ctrl (down) + W flies down and forward: movement keys aren't chords", () => {
    const keys = new HeldKeys()
    keys.press("ControlLeft", 0)
    expect(isBoundChord(defaultKeybinds, "Ctrl+KeyW")).toBe(false)
    keys.press("KeyW", 10, isBoundChord(defaultKeybinds, "Ctrl+KeyW"))
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

/** What `keybinds` adds to the conflicts the defaults already have. */
const newConflicts = (keybinds: Keybinds) => {
  const baseline = conflictingBindings(defaultKeybinds)
  return [...conflictingBindings(keybinds)].filter((chord) => !baseline.has(chord))
}

describe("dragChordOf", () => {
  const press = (button: number, modifiers: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}) => ({
    button,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers
  })

  it("drops modifiers bound to nothing with the button: Ctrl held for flying down, then right-click", () => {
    expect(dragChordOf(defaultKeybinds, press(2, { ctrlKey: true }))).toBe("Mouse2")
    expect(dragChordOf(defaultKeybinds, press(2, { shiftKey: true }))).toBe("Mouse2")
    expect(dragChordOf(defaultKeybinds, press(1, { altKey: true }))).toBe("Mouse1")
  })

  it("keeps a chord that means something: orbit, and the selection clicks", () => {
    expect(dragChordOf(defaultKeybinds, press(0, { altKey: true }))).toBe("Alt+Mouse0")
    expect(dragChordOf(defaultKeybinds, press(0, { ctrlKey: true }))).toBe("Ctrl+Mouse0")
    expect(dragChordOf(defaultKeybinds, press(0, { shiftKey: true }))).toBe("Shift+Mouse0")
  })
})

describe("wheelSpeedStep", () => {
  const scroll = (deltaY: number, modifiers: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}) => ({
    deltaX: 0,
    deltaY,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers
  })

  it("changes speed whatever is held: Ctrl flies down, and the wheel still has to work", () => {
    for (const modifier of [{}, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
      expect(wheelSpeedStep(defaultKeybinds, scroll(-120, modifier))).toBe(1)
      expect(wheelSpeedStep(defaultKeybinds, scroll(120, modifier))).toBe(-1)
    }
  })

  it("lets a chord bound with a modifier win over the plain wheel", () => {
    const keybinds: Keybinds = { ...defaultKeybinds, speedFaster: ["WheelDown"], speedSlower: ["Ctrl+WheelDown"] }
    expect(wheelSpeedStep(keybinds, scroll(120))).toBe(1)
    expect(wheelSpeedStep(keybinds, scroll(120, { ctrlKey: true }))).toBe(-1)
  })

  it("does nothing when the wheel isn't bound", () => {
    expect(wheelSpeedStep({ ...defaultKeybinds, speedFaster: [], speedSlower: [] }, scroll(-120))).toBe(0)
  })

  it("takes Shift+scroll turned sideways as the scroll it was, and ignores any other sideways scroll", () => {
    expect(wheelSpeedStep(defaultKeybinds, { ...scroll(0, { shiftKey: true }), deltaX: -120 })).toBe(1)
    expect(wheelSpeedStep(defaultKeybinds, { ...scroll(0), deltaX: -120 })).toBe(0)
  })
})

describe("conflictingBindings", () => {
  it("marks a chord two actions of a kind share, and not one shared across kinds", () => {
    expect(newConflicts({ ...defaultKeybinds, undo: ["Ctrl+KeyJ"], redo: ["Ctrl+KeyJ"] })).toEqual(["Ctrl+KeyJ"])
    expect(newConflicts({ ...defaultKeybinds, moveForward: ["KeyJ"], translateMode: ["KeyJ"] })).toEqual([])
  })

  it("marks two of a drag's keys sharing a chord", () => {
    expect(newConflicts({ ...defaultKeybinds, snapOnlyMesh: ["KeyG"] })).toEqual(["KeyG"])
  })

  it("gives the keys that narrow snapping chords nothing else is bound to", () => {
    const narrowing = keybindActions.filter((action) => action.startsWith("snapOnly"))
    expect(narrowing).toEqual([
      "snapOnlyGrid",
      "snapOnlyConnectors",
      "snapOnlyMesh",
      "snapOnlyAlignment",
      "snapOnlyStep"
    ])
    expect(conflictingBindings(defaultKeybinds).size).toBe(0)
    for (const action of narrowing) {
      for (const chord of defaultKeybinds[action]) expect(actionsFor(defaultKeybinds, chord)).toEqual([action])
    }
  })
})
