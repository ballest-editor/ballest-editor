import { assert, describe, it } from "@effect/vitest"
import { formatPaneReadout, paneMarkOf } from "./paneReadout"

const eyeAt = (z: number) => ({ x: 0, y: 0, z })
const goal = { point: { x: 3100, y: 0, z: 1240 }, name: "Goal" }

describe("the pane readout", () => {
  it("says how high the camera is and how far the selection is", () => {
    assert.strictEqual(formatPaneReadout(eyeAt(1240), 0, goal, "cm"), "12.4 m up · 31 m to Goal")
  })

  it("measures height from the grid plane, not from zero", () => {
    assert.strictEqual(formatPaneReadout(eyeAt(1740), 500, undefined, "m"), "12.4 m up")
  })

  it("says down when the camera is under the grid plane", () => {
    assert.strictEqual(formatPaneReadout(eyeAt(-320), 0, undefined, "m"), "3.2 m down")
  })

  it("leaves the selection out with nothing selected", () => {
    assert.strictEqual(formatPaneReadout(eyeAt(1240), 0, undefined, "cm"), "12.4 m up")
  })

  it("drops a decimal that says nothing, and any past 100 m", () => {
    assert.strictEqual(formatPaneReadout(eyeAt(3100), 0, undefined, "m"), "31 m up")
    assert.strictEqual(formatPaneReadout(eyeAt(12_345), 0, undefined, "m"), "123 m up")
    assert.strictEqual(formatPaneReadout(eyeAt(9996), 0, undefined, "m"), "100 m up")
  })

  it("follows the units setting under a metre", () => {
    assert.strictEqual(formatPaneReadout(eyeAt(42.4), 0, undefined, "cm"), "42 cm up")
    assert.strictEqual(formatPaneReadout(eyeAt(42.4), 0, undefined, "m"), "0.4 m up")
  })

  it("measures the straight line to the selection", () => {
    const mark = { point: { x: 300, y: 400, z: 0 }, name: "Cube" }
    assert.strictEqual(formatPaneReadout(eyeAt(0), 0, mark, "m"), "0 m up · 5 m to Cube")
  })
})

describe("what the readout measures to", () => {
  it("is nothing with nothing selected", () => {
    assert.isUndefined(paneMarkOf([], undefined))
  })

  it("takes the name of one thing", () => {
    assert.deepStrictEqual(paneMarkOf([{ x: 1, y: 2, z: 3 }], "Goal"), { point: { x: 1, y: 2, z: 3 }, name: "Goal" })
  })

  it("is the centre of several, counted when they have no one name", () => {
    const points = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 200, z: 300 }]
    assert.deepStrictEqual(paneMarkOf(points, undefined), { point: { x: 50, y: 100, z: 150 }, name: "2 items" })
    assert.strictEqual(paneMarkOf(points, "Ramp group")?.name, "Ramp group")
  })
})
