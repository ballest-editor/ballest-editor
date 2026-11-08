import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import {
  defaultSnapConfig,
  isPreset,
  narrowedTo,
  priorityOf,
  rangeOf,
  SnapConfig,
  targetSummary,
  turnSnapOf,
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

  it("narrows to the kinds held, the priority list keeping its order among them", () => {
    const piecesFirst = withPreset(defaultSnapConfig, "piecesFirst")
    assert.deepStrictEqual(priorityOf(narrowedTo(piecesFirst, ["grid"])), ["grid"])
    assert.deepStrictEqual(priorityOf(narrowedTo(piecesFirst, ["alignment"])), ["tracking", "alignment"])
    assert.deepStrictEqual(priorityOf(narrowedTo(piecesFirst, ["grid", "mesh"])), ["mesh", "grid"])
    assert.strictEqual(narrowedTo(piecesFirst, ["mesh"]).threshold, piecesFirst.threshold)
    assert.strictEqual(narrowedTo(piecesFirst, []), piecesFirst)
  })

  it("turns snapping on for the kind held, even a target that was off", () => {
    const off = {
      ...defaultSnapConfig,
      enabled: false,
      targets: { ...defaultSnapConfig.targets, mesh: { ...defaultSnapConfig.targets.mesh, enabled: false } }
    }
    const narrowed = narrowedTo(off, ["mesh"])
    assert.isTrue(narrowed.enabled)
    assert.deepStrictEqual(priorityOf(narrowed), ["mesh"])
    assert.strictEqual(narrowed.targets.mesh.sharpAngle, off.targets.mesh.sharpAngle)
  })

  it("gives a turn and a scale the step alone under the step's key, and no step under a target's", () => {
    const off = { ...defaultSnapConfig, rotationEnabled: false, scaleEnabled: false }
    assert.deepStrictEqual(turnSnapOf(off, "turn", [], false), { step: false, targets: [] })
    assert.deepStrictEqual(turnSnapOf(off, "turn", [], true), { step: true, targets: ["connectors", "mesh"] })
    assert.deepStrictEqual(turnSnapOf(off, "turn", ["step"], false), { step: true, targets: [] })
    assert.deepStrictEqual(turnSnapOf(off, "turn", ["mesh"], false), { step: false, targets: ["mesh"] })
    assert.deepStrictEqual(turnSnapOf(off, "turn", ["mesh", "step"], false), { step: true, targets: ["mesh"] })
    assert.deepStrictEqual(turnSnapOf(off, "scale", ["mesh"], false), { step: false, targets: ["mesh"] })
    assert.deepStrictEqual(turnSnapOf(off, "turn", ["step"], true), { step: false, targets: [] })
  })

  it("leaves a turn alone under a key that means nothing to it", () => {
    const on = { ...defaultSnapConfig, rotationEnabled: true, scaleEnabled: true }
    assert.deepStrictEqual(turnSnapOf(on, "turn", ["grid", "alignment"], false), turnSnapOf(on, "turn", [], false))
    assert.deepStrictEqual(turnSnapOf(on, "scale", ["connectors"], false), { step: true, targets: ["mesh"] })
  })

  it("drags by the body only to join ends, unless a config from before says otherwise", () => {
    assert.strictEqual(defaultSnapConfig.bodyDrag, "ends")
    const { bodyDrag: _, ...before } = Schema.encodeSync(SnapConfig)(defaultSnapConfig)
    assert.strictEqual(Schema.decodeSync(SnapConfig)(before).bodyDrag, "ends")
  })

  it("round-trips through its schema", () => {
    const encoded = Schema.encodeSync(SnapConfig)(defaultSnapConfig)
    assert.deepStrictEqual(Schema.decodeSync(SnapConfig)(encoded), defaultSnapConfig)
  })
})
