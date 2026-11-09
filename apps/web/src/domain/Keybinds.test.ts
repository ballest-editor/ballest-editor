import { describe, expect, it } from "@effect/vitest"
import { formsChord } from "./flyKeys"
import {
  actionsFor,
  actionWhen,
  clashingChords,
  conflictingBindings,
  defaultKeybinds,
  dragChordOf,
  formatBinding,
  formatBindings,
  formatClick,
  formatModifiers,
  HeldKeys,
  holdsModifiersOf,
  isBoundChord,
  isDefaultBinding,
  isOneShotChord,
  type KeybindAction,
  keybindActionDescriptions,
  keybindActionLabels,
  keybindActions,
  type Keybinds,
  keybindSections,
  mergeKeybinds,
  MODIFIER_HOLD_MS,
  PROJECTION_ACTIONS,
  releasesBinding,
  resolveChord,
  wheelSpeedStep
} from "./Keybinds"
import { describeWhen, type KeyContext } from "./keyContext"
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
      ["paint", ["KeyB"]], // editor only
      ["local / world axes", ["KeyC"]],
      ["together / each, rigid / link by link", ["Period"]], // editor only
      ["focus selection", ["KeyF"]],
      ["add to selection", ["Shift+Mouse0"]],
      ["toggle selection", ["Ctrl+Mouse0"]],
      ["remove from selection", ["Ctrl+Shift+Mouse0"]], // editor only
      ["lasso", ["AltLeft", "AltRight"]], // editor only
      ["paint whole piece", ["Shift+Mouse0"]], // editor only
      ["pick paint", ["Alt+Mouse0"]] // editor only
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
      ["cancel drag", ["Escape"]], // editor only
      ["enter group", ["Enter", "NumpadEnter"]], // editor only
      ["group", ["Ctrl+KeyG"]],
      ["make chain", ["Ctrl+Shift+KeyG"]], // editor only
      ["ungroup", ["Shift+KeyG"]],
      ["align left", ["Ctrl+Shift+ArrowLeft"]], // editor only
      ["align right", ["Ctrl+Shift+ArrowRight"]], // editor only
      ["align up", ["Ctrl+Shift+ArrowUp"]], // editor only
      ["align down", ["Ctrl+Shift+ArrowDown"]] // editor only
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

  it("only shares keys between a fly key and a tool shortcut (W: forward + translate, as in the game), a drag's, and the paint tool's clicks", () => {
    const seen = new Map<string, Array<string>>()
    for (const [action, bindings] of Object.entries(defaultKeybinds)) {
      for (const b of bindings) seen.set(b, [...(seen.get(b) ?? []), action])
    }
    const shared = [...seen].filter(([, actions]) => actions.length > 1)
    // Ctrl is snapping's only once a drag has begun, and flying's otherwise
    expect(shared).toEqual([
      ["ControlLeft", ["snapOff", "moveDown"]],
      ["KeyW", ["translateMode", "moveForward"]],
      ["Shift+Mouse0", ["addToSelection", "paintWholePiece"]],
      ["Alt+Mouse0", ["pickPaint", "orbit"]],
      ["Escape", ["deselect", "cancelDrag"]]
    ])
    expect(clashingChords(conflictingBindings(defaultKeybinds))).toEqual(new Set())
    expect(isOneShotChord(defaultKeybinds, "KeyW")).toBe(true)
    expect(isOneShotChord(defaultKeybinds, "KeyS")).toBe(false)
    expect(actionsFor(defaultKeybinds, "KeyC")).toEqual(["toggleGizmoSpace"])
    expect(actionsFor(defaultKeybinds, "KeyF")).toEqual(["focusSelection"])
    expect(actionsFor(defaultKeybinds, "KeyX")).toEqual(["snapLockX"])
    expect(isOneShotChord(defaultKeybinds, "KeyX")).toBe(false)
  })

  // docs/design/hide-isolate-lock.md: Blender's H and Alt+H, Unity's Shift+H, Blender's Numpad / for local view, and
  // Godot's and Rhino's Ctrl+L, as L is snapping's while a drag is held
  it("hides, isolates and locks on the keys the other editors use, as the game has none", () => {
    const view = keybindSections.find((s) => s.name === "view")!
    expect(view.actions.slice(-5).map((a) => [keybindActionLabels[a], defaultKeybinds[a]])).toEqual([
      ["hide / show", ["KeyH"]],
      ["show all", ["Alt+KeyH"]],
      ["isolate", ["Shift+KeyH", "NumpadDivide"]],
      ["lock / unlock", ["Ctrl+KeyL"]],
      ["unlock all", ["Alt+KeyL"]]
    ])
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

  it("cancels a drag on what deselect was bound to in a save from before cancel drag had a key of its own", () => {
    expect(mergeKeybinds({ deselect: ["KeyQ"] }).cancelDrag).toEqual(["Escape", "KeyQ"])
    expect(mergeKeybinds({ deselect: ["KeyQ"], cancelDrag: ["Backquote"] }).cancelDrag).toEqual(["Backquote"])
    expect(mergeKeybinds({}).cancelDrag).toEqual(["Escape"])
  })

  it("keeps the binding saved for invert snapping as snapping off, and drops the grid and step keys", () => {
    const merged = mergeKeybinds({ snapInvert: ["AltLeft"], snapOnlyGrid: ["KeyQ"], snapOnlyStep: ["KeyT"] })
    expect(merged.snapOff).toEqual(["AltLeft"])
    expect(merged).not.toHaveProperty("snapOnlyGrid")
    expect(merged).not.toHaveProperty("snapOnlyStep")
    expect(merged).not.toHaveProperty("snapInvert")
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

  it("says a click binding and its modifiers as a hint does", () => {
    expect(formatClick("Alt+Mouse0", false)).toBe("Alt + click")
    expect(formatClick("Ctrl+Shift+Mouse0", true)).toBe("⌘ + Shift + click")
    expect(formatClick("Mouse0")).toBe("Click")
    expect(formatClick("Alt+Mouse2")).toBe("Alt + RMB")
    expect(formatModifiers("Shift+Mouse0")).toBe("Shift")
    expect(formatModifiers("Mouse0")).toBeUndefined()
  })

  it("knows when the held modifiers are a binding's before its click", () => {
    const held = (mods: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean }) => ({
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      ...mods
    })
    expect(holdsModifiersOf(defaultKeybinds, "paintWholePiece", held({ shiftKey: true }))).toBe(true)
    expect(holdsModifiersOf(defaultKeybinds, "paintWholePiece", held({ shiftKey: true, altKey: true }))).toBe(false)
    expect(holdsModifiersOf(defaultKeybinds, "paintWholePiece", held({}))).toBe(false)
    // a binding with no modifier is never "held": the bare click is the slot's
    expect(holdsModifiersOf({ ...defaultKeybinds, paintWholePiece: ["Mouse0"] }, "paintWholePiece", held({}))).toBe(
      false
    )
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

  it("a bound chord's own key (Ctrl+Shift+Left, align) doesn't turn the camera as the arrow it is", () => {
    const keys = new HeldKeys()
    keys.press("ControlLeft", 0)
    keys.press("ShiftLeft", 5)
    keys.press("ArrowLeft", 10, formsChord(defaultKeybinds, "Ctrl+Shift+ArrowLeft"))
    expect(isBoundChord(defaultKeybinds, "Ctrl+Shift+ArrowLeft")).toBe(true)
    keys.claim("ArrowLeft")
    expect(keys.holdsAny(defaultKeybinds.lookLeft, 500)).toBe(false)
    expect(keys.holdsAny(defaultKeybinds.moveDown, 500)).toBe(false)
    keys.release("ArrowLeft")
    keys.release("ControlLeft")
    keys.release("ShiftLeft")
    keys.press("ArrowLeft", 1000)
    expect(keys.holdsAny(defaultKeybinds.lookLeft, 1000)).toBe(true)
  })

  it("a chord nobody bound (Shift+Left) still turns the camera", () => {
    expect(isBoundChord(defaultKeybinds, "Shift+ArrowLeft")).toBe(false)
    expect(isBoundChord(defaultKeybinds, "ArrowLeft")).toBe(false)
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
/** The chords `keybinds` marks red that the defaults don't. */
const newConflicts = (keybinds: Keybinds) =>
  [...clashingChords(conflictingBindings(keybinds))].filter((chord) =>
    !clashingChords(conflictingBindings(defaultKeybinds)).has(chord)
  )

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
  it("marks a chord two actions share where both can take it, and not one shared across held and one-shot keys", () => {
    expect(newConflicts({ ...defaultKeybinds, undo: ["Ctrl+KeyJ"], redo: ["Ctrl+KeyJ"] })).toEqual(["Ctrl+KeyJ"])
    expect(newConflicts({ ...defaultKeybinds, moveForward: ["KeyJ"], translateMode: ["KeyJ"] })).toEqual([])
  })

  it("marks two of a drag's keys sharing a chord, and not a drag's key sharing one with a key that waits for no drag", () => {
    expect(newConflicts({ ...defaultKeybinds, snapOnlyMesh: ["KeyJ"] })).toEqual(["KeyJ"])
    expect(newConflicts({ ...defaultKeybinds, snapLockX: ["KeyX"], cutSelection: ["KeyX"] })).toEqual([])
    expect(newConflicts({ ...defaultKeybinds, snapOnlyMesh: ["KeyX"] })).toEqual(["KeyX"]) // X locks a move too
    expect(newConflicts({ ...defaultKeybinds, snapLockX: ["KeyM"] })).toEqual(["KeyM"])
  })

  it("gives the keys that narrow snapping chords nothing else is bound to", () => {
    const narrowing = keybindActions.filter((action) => action.startsWith("snapOnly"))
    expect(narrowing).toEqual([
      "snapOnlyConnectors",
      "snapOnlyMesh",
      "snapOnlyAlignment"
    ])
    for (const action of narrowing) {
      for (const chord of defaultKeybinds[action]) expect(actionsFor(defaultKeybinds, chord)).toEqual([action])
    }
  })

  it("keeps the paint tool's clicks apart from selection clicks, and says the eyedropper takes Alt+click from orbit in Paint", () => {
    expect(newConflicts({ ...defaultKeybinds, pickPaint: ["Ctrl+Mouse0"] })).toEqual([])
    expect(newConflicts({ ...defaultKeybinds, pickPaint: ["Shift+Mouse0"] })).toEqual(["Shift+Mouse0"])
    const conflicts = conflictingBindings(defaultKeybinds)
    expect(conflicts.get("pickPaint")?.get("Alt+Mouse0")).toEqual({
      clashes: [],
      overrides: ["orbit"],
      overriddenBy: []
    })
    expect(conflicts.get("orbit")?.get("Alt+Mouse0")).toEqual({
      clashes: [],
      overrides: [],
      overriddenBy: ["pickPaint"]
    })
    expect(conflicts.get("addToSelection")).toBeUndefined()
  })
})

describe("the caption under an action", () => {
  it("says where it works, and nothing for one that works everywhere or also during a drag", () => {
    const caption = (action: KeybindAction) => describeWhen(actionWhen[action])
    expect(caption("undo")).toBe("")
    expect(caption("moveForward")).toBe("")
    expect(caption("snapOff")).toBe("While moving, turning, scaling or placing")
    expect(caption("snapHold")).toBe("While moving or turning")
    expect(caption("snapLockX")).toBe("While moving")
    expect(caption("snapOnlyMesh")).toBe("While moving, turning or scaling")
    expect(caption("cancelDrag")).toBe("While moving, turning, scaling or selecting")
    expect(caption("lassoSelect")).toBe("While selecting")
    expect(caption("removeFromSelection")).toBe("Select, Move, Rotate and Scale tools")
    expect(caption("addToSelection")).toBe("Select, Move, Rotate and Scale tools")
    expect(caption("pickPaint")).toBe("Paint tool")
    expect(caption("playMap")).toBe("Desktop app")
  })
})

describe("resolveChord", () => {
  const idle: KeyContext = { drag: "none", tool: "translate", platform: "desktop" }

  it("fires a chord's actions only where they work, the narrowest first", () => {
    expect(resolveChord(defaultKeybinds, idle, "Ctrl+KeyZ")).toEqual(["undo"])
    expect(resolveChord(defaultKeybinds, { ...idle, drag: "move" }, "Ctrl+KeyZ")).toEqual([])
    expect(resolveChord(defaultKeybinds, { ...idle, drag: "move" }, "KeyX")).toEqual(["snapLockX"])
    expect(resolveChord(defaultKeybinds, idle, "KeyX")).toEqual([])
    expect(resolveChord(defaultKeybinds, { ...idle, drag: "turn" }, "KeyX")).toEqual([])
    expect(resolveChord(defaultKeybinds, { ...idle, drag: "scrub" }, "Delete")).toEqual([])
  })

  it("lets the camera fly through a look and a gizmo drag, but not a one-shot", () => {
    for (const drag of ["none", "camera", "move", "turn", "scale"] as const) {
      expect(resolveChord(defaultKeybinds, { ...idle, drag }, "KeyS")).toEqual(["moveBack"])
    }
    expect(resolveChord(defaultKeybinds, { ...idle, drag: "camera" }, "KeyW")).toEqual(["moveForward"])
    expect(resolveChord(defaultKeybinds, idle, "KeyW")).toEqual(["translateMode", "moveForward"])
    expect(resolveChord(defaultKeybinds, { ...idle, drag: "camera" }, "KeyF")).toEqual([])
  })

  it("gives a box drag its lasso key and Escape, and nothing else", () => {
    const area = { ...idle, drag: "area" } as const
    expect(resolveChord(defaultKeybinds, area, "AltLeft")).toEqual(["lassoSelect"])
    expect(resolveChord(defaultKeybinds, idle, "AltLeft")).toEqual([])
    expect(resolveChord(defaultKeybinds, area, "Escape")).toEqual(["cancelDrag"])
    expect(resolveChord(defaultKeybinds, area, "Ctrl+KeyZ")).toEqual([])
    expect(resolveChord(defaultKeybinds, area, "KeyX")).toEqual([])
  })

  it("gives the paint tool its own clicks and Escape to the drag under way", () => {
    expect(resolveChord(defaultKeybinds, idle, "Shift+Mouse0")).toEqual(["addToSelection"])
    expect(resolveChord(defaultKeybinds, { ...idle, tool: "paint" }, "Shift+Mouse0")).toEqual(["paintWholePiece"])
    expect(resolveChord(defaultKeybinds, { ...idle, tool: "paint" }, "Alt+Mouse0")).toEqual(["pickPaint", "orbit"])
    expect(resolveChord(defaultKeybinds, idle, "Alt+Mouse0")).toEqual(["orbit"])
    expect(resolveChord(defaultKeybinds, idle, "Ctrl+Shift+Mouse0")).toEqual(["removeFromSelection"])
    expect(resolveChord(defaultKeybinds, idle, "Escape")).toEqual(["deselect"])
    expect(resolveChord(defaultKeybinds, { ...idle, drag: "move" }, "Escape")).toEqual(["cancelDrag"])
  })

  it("has Play on the desktop only, so F5 falls through to the browser", () => {
    expect(resolveChord(defaultKeybinds, idle, "F5")).toEqual(["playMap"])
    expect(resolveChord(defaultKeybinds, { ...idle, platform: "browser" }, "F5")).toEqual([])
    expect(actionWhen.playMap).toEqual({ platform: ["desktop"] })
  })
})
