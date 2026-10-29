import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { hexToLinear, linearToHex } from "./color"

describe("color", () => {
  it("shows linear channels in sRGB, as the game's swatch does", () => {
    // the shape decal probe's (1, 0.1, 0.1) is drawn as (255, 89, 89) in game
    assert.strictEqual(linearToHex([1, 0.1, 0.1]), "#ff5959")
    assert.strictEqual(linearToHex([0, 0.5, 1]), "#00bcff")
  })

  it("clamps channels a swatch can't show", () => {
    assert.strictEqual(linearToHex([4, -1, 1]), "#ff00ff")
  })

  it("reads a hex code back as the linear channels it shows", () => {
    assert.deepStrictEqual(Option.getOrThrow(hexToLinear("#FFFFFF")), [1, 1, 1])
    assert.deepStrictEqual(Option.getOrThrow(hexToLinear("#000000")), [0, 0, 0])
    for (const hex of ["#ff5959", "#00bcff", "#010203", "#7f7f7f"]) {
      assert.strictEqual(linearToHex(Option.getOrThrow(hexToLinear(hex))), hex)
    }
    assert.isTrue(Option.isNone(hexToLinear("ff5959")))
    assert.isTrue(Option.isNone(hexToLinear("#ff59")))
  })
})
