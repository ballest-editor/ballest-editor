import { assert, describe, it } from "@effect/vitest"
import {
  describeWhen,
  type KeyContext,
  matches,
  needsDrag,
  overlaps,
  specificity,
  type When,
  within
} from "./keyContext"

const idle: KeyContext = { drag: "none", tool: "select", platform: "desktop" }
const moving: KeyContext = { ...idle, drag: "move" }
const painting: KeyContext = { ...idle, tool: "paint" }

describe("keybind conditions", () => {
  it("hold with nothing dragged unless they say otherwise, and in every tool and platform unless they name some", () => {
    const plain: When = {}
    assert.isTrue(matches(plain, idle))
    assert.isFalse(matches(plain, moving))
    assert.isTrue(matches(plain, painting))
    assert.isTrue(matches({ drag: ["move", "turn"] }, moving))
    assert.isFalse(matches({ drag: ["move", "turn"] }, idle))
    assert.isTrue(matches({ tool: ["paint"] }, painting))
    assert.isFalse(matches({ tool: ["paint"] }, idle))
    assert.isFalse(matches({ platform: ["desktop"] }, { ...idle, platform: "browser" }))
  })

  it("overlap when both can hold at once, which is what makes two bindings on one chord contend", () => {
    assert.isTrue(overlaps({}, {}))
    assert.isFalse(overlaps({}, { drag: ["move"] }), "Ctrl flies down, and turns snapping off only during a move")
    assert.isTrue(overlaps({ drag: ["none", "camera"] }, {}))
    assert.isFalse(overlaps({ tool: ["paint"] }, { tool: ["select", "translate", "rotate", "scale"] }))
    assert.isTrue(overlaps({ tool: ["paint"] }, {}), "orbit in every tool and the eyedropper in Paint share a click")
  })

  it("know when one condition lies within another, so the narrower binding overrides rather than clashes", () => {
    assert.isTrue(within({ tool: ["paint"] }, {}))
    assert.isFalse(within({}, { tool: ["paint"] }))
    assert.isTrue(within({ drag: ["move"] }, { drag: ["move", "turn"] }))
    assert.isTrue(within({}, {}))
  })

  it("rank a condition by how much it narrows, with a drag counting only when it is required", () => {
    assert.strictEqual(specificity({}), 0)
    assert.strictEqual(specificity({ drag: ["none", "camera"] }), 0)
    assert.strictEqual(specificity({ drag: ["move"] }), 1)
    assert.strictEqual(specificity({ drag: ["move"], tool: ["paint"], platform: ["desktop"] }), 3)
    assert.isTrue(needsDrag({ drag: ["move"] }))
    assert.isFalse(needsDrag({ drag: ["none", "move"] }))
  })

  it("say where a key works in Settings' words", () => {
    assert.strictEqual(describeWhen({}), "")
    assert.strictEqual(describeWhen({ drag: ["none", "camera"] }), "")
    assert.strictEqual(describeWhen({ drag: ["move"] }), "While moving")
    assert.strictEqual(describeWhen({ drag: ["move", "turn", "scale"] }), "While moving, turning or scaling")
    assert.strictEqual(describeWhen({ drag: ["move", "turn", "scale", "place", "stroke"] }), "While dragging")
    assert.strictEqual(describeWhen({ drag: ["camera"] }), "While looking")
    assert.strictEqual(describeWhen({ tool: ["paint"] }), "Paint tool")
    assert.strictEqual(
      describeWhen({ tool: ["select", "translate", "rotate", "scale"] }),
      "Select, Move, Rotate and Scale tools"
    )
    assert.strictEqual(describeWhen({ platform: ["desktop"] }), "Desktop app")
    assert.strictEqual(describeWhen({ drag: ["stroke"], tool: ["paint"] }), "While painting, Paint tool")
  })
})
