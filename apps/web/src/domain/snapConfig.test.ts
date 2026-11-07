import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import {
  defaultSnapConfig,
  isPreset,
  priorityOf,
  rangeOf,
  SnapConfig,
  targetSummary,
  withPreset,
  withTargetMoved
} from "./snapConfig"

describe("snapConfig", () => {
  it("starts on Grid first with every target on, as the game's feel", () => {
    assert.deepStrictEqual(priorityOf(defaultSnapConfig), [
      "grid",
      "connectors",
      "mesh",
      "construction",
      "tracking",
      "alignment"
    ])
    assert.isTrue(isPreset(defaultSnapConfig, "gridFirst"))
    assert.isFalse(isPreset(defaultSnapConfig, "piecesFirst"))
  })

  it("Pieces first keeps the grid as the fallback", () => {
    assert.strictEqual(priorityOf(withPreset(defaultSnapConfig, "piecesFirst")).at(-1), "grid")
  })

  it("moves a row, and a target that is off drops out of the order it is read in", () => {
    const moved = withTargetMoved(defaultSnapConfig, "alignment", 0)
    assert.strictEqual(priorityOf(moved)[0], "alignment")
    const off = {
      ...moved,
      targets: { ...moved.targets, alignment: { ...moved.targets.alignment, enabled: false } }
    }
    assert.strictEqual(priorityOf(off)[0], "grid")
    assert.lengthOf(priorityOf(off), 5)
  })

  it("reads an order that lost or repeats a target as a whole one", () => {
    const short = { ...defaultSnapConfig, order: ["mesh", "mesh"] as const }
    assert.deepStrictEqual(priorityOf(short), [
      "mesh",
      "grid",
      "connectors",
      "construction",
      "tracking",
      "alignment"
    ])
  })

  it("takes a connector's own range over the general threshold", () => {
    assert.strictEqual(rangeOf(defaultSnapConfig, "connectors"), 12)
    const own = {
      ...defaultSnapConfig,
      targets: { ...defaultSnapConfig.targets, connectors: { ...defaultSnapConfig.targets.connectors, range: 30 } }
    }
    assert.strictEqual(rangeOf(own, "connectors"), 30)
    assert.strictEqual(rangeOf(own, "mesh"), 12)
  })

  it("summarises each target in one line", () => {
    assert.strictEqual(targetSummary(defaultSnapConfig, "grid", "cm"), "10 cm, world origin")
    assert.strictEqual(targetSummary(defaultSnapConfig, "connectors", "cm"), "Warn, show on hover")
    const moved = {
      ...defaultSnapConfig,
      targets: {
        ...defaultSnapConfig.targets,
        grid: { ...defaultSnapConfig.targets.grid, origin: { x: 137, y: 0, z: 0 }, yaw: 30 }
      }
    }
    assert.strictEqual(targetSummary(moved, "grid", "cm"), "10 cm, own origin, 30°")
  })

  it("round-trips through its schema", () => {
    const encoded = Schema.encodeSync(SnapConfig)(defaultSnapConfig)
    assert.deepStrictEqual(Schema.decodeSync(SnapConfig)(encoded), defaultSnapConfig)
  })
})
