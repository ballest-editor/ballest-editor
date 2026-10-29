import { assert, describe, it } from "@effect/vitest"
import { formatGridSize, formatRotationStep, GRID_SIZES, ROTATION_STEPS, snapValue } from "./snap"

describe("snap", () => {
  it("rounds to the nearest multiple of the step", () => {
    assert.strictEqual(snapValue(12.4, 10), 10)
    assert.strictEqual(snapValue(15, 10), 20)
    assert.strictEqual(snapValue(-137, 25), -125)
    assert.isFalse(Object.is(snapValue(-0.4, 10), -0))
  })

  it("offers increasing sizes and formats them in the editor's units", () => {
    assert.deepStrictEqual([...GRID_SIZES].sort((a, b) => a - b), [...GRID_SIZES])
    assert.strictEqual(formatGridSize(25, "cm"), "25 cm")
    assert.strictEqual(formatGridSize(25, "m"), "0.25 m")
  })

  it("offers the game's rotation steps, formatted like its menu", () => {
    assert.deepStrictEqual([...ROTATION_STEPS].sort((a, b) => a - b), [...ROTATION_STEPS])
    assert.deepStrictEqual(ROTATION_STEPS.map(formatRotationStep), [
      "2.812",
      "5.0",
      "10.0",
      "15.0",
      "30.0",
      "45.0",
      "90.0"
    ])
  })
})
