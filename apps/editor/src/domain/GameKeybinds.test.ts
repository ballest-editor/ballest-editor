import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { repoRoot } from "../test/samples"
import { deriveKeybinds, GameKeybindsFile, mappingDirection, namedActions, UE_KEY_TO_CODE } from "./GameKeybinds"
import { defaultKeybinds } from "./Keybinds"

const negate = { type: "InputModifierNegate", settings: { bX: true, bY: true, bZ: true } }
const swizzle = { type: "InputModifierSwizzleAxis", settings: { Order: "EInputAxisSwizzle::YXZ" } }
const m = (action: string, key: string, modifierSettings: ReadonlyArray<typeof negate | typeof swizzle> = []) => ({
  action,
  key,
  modifiers: modifierSettings.map((x) => x.type),
  triggers: [],
  modifierSettings
})

describe("GameKeybinds", () => {
  it("resolves Enhanced Input axis modifiers to directions", () => {
    assert.deepStrictEqual(mappingDirection(m("IA_Move", "D")), [1, 0, 0])
    assert.deepStrictEqual(mappingDirection(m("IA_Move", "A", [negate])), [-1, -0, -0])
    assert.deepStrictEqual(mappingDirection(m("IA_Move", "W", [swizzle])), [0, 1, 0])
    assert.deepStrictEqual(mappingDirection(m("IA_Move", "S", [swizzle, negate])), [-0, -1, -0])
  })

  it("maps a free-cam context onto editor actions and reports the rest as fallbacks", () => {
    const file = Schema.decodeSync(GameKeybindsFile)({
      contexts: [
        { name: "IMC_LevelEditor", mappings: [] },
        {
          name: "IMC_FreeCam",
          mappings: [
            m("IA_Pan", "Up", [swizzle]),
            m("IA_Pan", "Down", [negate, swizzle]),
            m("IA_Pan", "Left", [negate]),
            m("IA_Pan", "Right"),
            m("IA_Height", "SpaceBar"),
            m("IA_Height", "LeftControl", [negate]),
            m("IA_Camera", "Mouse2D"),
            m("IA_CamSpeedModifier", "MouseWheelAxis"),
            m("IA_CenterCamera", "C"),
            m("IA_Unknown", "J")
          ]
        },
        { name: "IMC_Universal", mappings: [m("IA_Pause", "Escape")] },
        // Racing controls reuse keys for other things and must not leak into the editor.
        {
          name: "IMC_Default",
          mappings: [m("IA_Look", "RightMouseButton"), m("IA_Move", "I", [swizzle])]
        }
      ]
    })
    const { keybinds, fromGame, fellBack } = deriveKeybinds(file)
    assert.deepStrictEqual(keybinds.moveForward, ["ArrowUp"])
    assert.deepStrictEqual(keybinds.moveBack, ["ArrowDown"])
    assert.deepStrictEqual(keybinds.moveLeft, ["ArrowLeft"])
    assert.deepStrictEqual(keybinds.moveRight, ["ArrowRight"])
    assert.deepStrictEqual(keybinds.moveUp, ["Space"])
    assert.deepStrictEqual(keybinds.moveDown, ["ShiftLeft"]) // editor override beats the game's Left Ctrl
    assert.deepStrictEqual(keybinds.look, defaultKeybinds.look) // Mouse2D has no button; IMC_Default ignored
    assert.deepStrictEqual(keybinds.speedFaster, ["WheelUp"])
    assert.deepStrictEqual(keybinds.speedSlower, ["WheelDown"])
    // level-editor overlay hotkey stays primary; the free camera's "center camera" is secondary
    assert.deepStrictEqual(keybinds.focusSelection, ["KeyF", "KeyC"])
    assert.deepStrictEqual(keybinds.deselect, ["Escape"])
    assert.strictEqual(fromGame.get("moveForward")?.context, "IMC_FreeCam")
    assert.strictEqual(fromGame.get("deselect")?.context, "IMC_Universal")
    assert.include(fellBack, "undo")
    assert.include(fellBack, "look")
  })

  it("names every action once, grouped by section with ours first", () => {
    const file = Schema.decodeSync(GameKeybindsFile)({
      sections: [{ name: "racing" }],
      contexts: [{
        name: "IMC_FreeCam",
        mappings: [{ ...m("IA_Height", "SpaceBar"), label: "rise", section: "racing" }]
      }]
    })
    const named = namedActions(deriveKeybinds(file))
    assert.strictEqual(new Set(named.map((n) => n.action)).size, named.length)
    assert.deepStrictEqual(named.at(-1), { action: "moveUp", section: "racing", label: "rise" })
    assert.deepStrictEqual(named[0], { action: "selectMode", section: "level editor", label: "select" })
    const sections = named.map((n) => n.section)
    assert.deepStrictEqual(sections, [...sections].sort((a, b) => sections.indexOf(a) - sections.indexOf(b)))
  })

  it("takes labels and sections from the file when present", () => {
    const file = Schema.decodeSync(GameKeybindsFile)({
      contexts: [{
        name: "IMC_FreeCam",
        mappings: [{ ...m("IA_Height", "SpaceBar"), label: "up", section: "mouse and keyboard free camera" }]
      }]
    })
    assert.deepStrictEqual(deriveKeybinds(file).naming.get("moveUp"), {
      label: "up",
      section: "mouse and keyboard free camera"
    })
    // arrow-key look in the racing context names our look actions (direction from modifiers)
    const look = Schema.decodeSync(GameKeybindsFile)({
      contexts: [{
        name: "IMC_Default",
        mappings: [
          { ...m("IA_Look", "Up", [swizzle, negate]), label: "Look Up", section: "mouse and keyboard bindings" },
          { ...m("IA_Look", "Left", [negate]), label: "Look Left", section: "mouse and keyboard bindings" }
        ]
      }]
    })
    const named = deriveKeybinds(look)
    assert.strictEqual(named.naming.get("lookUp")?.label, "look up")
    assert.strictEqual(named.naming.get("lookLeft")?.label, "look left")
    assert.deepStrictEqual(named.keybinds.lookUp, ["ArrowUp"]) // racing context doesn't rebind the editor
    assert.strictEqual(deriveKeybinds(undefined).naming.size, 0)
  })

  it("falls back for everything without a file, and maps UE key names", () => {
    assert.deepStrictEqual(deriveKeybinds(undefined).keybinds, defaultKeybinds)
    assert.strictEqual(UE_KEY_TO_CODE["SpaceBar"], "Space")
    assert.strictEqual(UE_KEY_TO_CODE["NumPadSeven"], "Numpad7")
    assert.strictEqual(UE_KEY_TO_CODE["Seven"], "Digit7")
  })

  const real = path.join(repoRoot, "assets", "keybinds.json")
  it.skipIf(!fs.existsSync(real))("decodes assets/keybinds.json", () => {
    const file = Schema.decodeUnknownSync(GameKeybindsFile)(JSON.parse(fs.readFileSync(real, "utf8")))
    const { keybinds, fromGame } = deriveKeybinds(file)
    assert.isAbove(file.contexts.length, 0)
    // IMC_FreeCam: WASD fly, Space up, LeftControl down, wheel = camera speed; IMC_Universal: Escape
    assert.deepStrictEqual(
      [
        keybinds.moveForward,
        keybinds.moveLeft,
        keybinds.moveBack,
        keybinds.moveRight,
        keybinds.moveUp,
        keybinds.moveDown
      ],
      [["KeyW"], ["KeyA"], ["KeyS"], ["KeyD"], ["Space"], ["ShiftLeft"]]
    )
    assert.deepStrictEqual([keybinds.speedFaster, keybinds.speedSlower, keybinds.deselect], [
      ["WheelUp"],
      ["WheelDown"],
      ["Escape"]
    ])
    assert.deepStrictEqual(keybinds.translateMode, ["KeyW"]) // the game's editor overlay, untouched by the camera contexts
    assert.deepStrictEqual(keybinds.focusSelection, ["KeyF", "KeyC"])
    for (const action of ["moveForward", "moveUp", "speedFaster", "deselect"] as const) {
      assert.isTrue(fromGame.has(action), action)
    }
    // the game's own names and sections, lower-cased
    const { naming, sectionOrder, cameraPresets } = deriveKeybinds(file)
    assert.deepStrictEqual(naming.get("moveForward"), { label: "forward", section: "mouse and keyboard free camera" })
    assert.strictEqual(naming.get("moveBack")?.label, "reverse")
    assert.strictEqual(naming.get("lookRight")?.label, "look right")
    assert.strictEqual(naming.get("lookUp")?.label, "look up")
    assert.isUndefined(naming.get("focusSelection")) // named by the level-editor overlay, not the camera
    assert.include(sectionOrder, "mouse and keyboard free camera")
    assert.notInclude(sectionOrder.join(), "gamepad")
    for (const [, n] of naming) assert.notMatch(n.section ?? "", /gamepad/i)
    assert.deepStrictEqual(cameraPresets.find((p) => p.label === "Wide Angle")?.fov, 110)
  })
})
