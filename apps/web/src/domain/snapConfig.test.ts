import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import {
  askedOrder,
  defaultSnapConfig,
  isPreset,
  narrowedTo,
  priorityOf,
  rangeOf,
  SnapConfig,
  snapsGrid,
  snapsRotation,
  snapsScale,
  targetSummary,
  turnSnapOf,
  withPreset,
  withTargetMoved
} from "./snapConfig"

const withConnectors = (config: SnapConfig, patch: Partial<SnapConfig["targets"]["connectors"]>): SnapConfig => ({
  ...config,
  targets: { ...config.targets, connectors: { ...config.targets.connectors, ...patch } }
})

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

  it("scales a connector's range by its pull, and nothing else's", () => {
    assert.strictEqual(defaultSnapConfig.targets.connectors.weight, 1)
    assert.strictEqual(rangeOf(withConnectors(defaultSnapConfig, { weight: 2 }), "connectors"), 24)
    assert.strictEqual(rangeOf(withConnectors(defaultSnapConfig, { weight: 0.5, range: 30 }), "connectors"), 15)
    assert.strictEqual(rangeOf(withConnectors(defaultSnapConfig, { weight: 4 }), "mesh"), 12)
  })

  it("asks Connectors ahead of Grid and Mesh only while it pulls harder than even", () => {
    const gridFirst = withConnectors(defaultSnapConfig, { weight: 2 })
    assert.deepStrictEqual(askedOrder(gridFirst), [
      "connectors",
      "grid",
      "mesh",
      "construction",
      "tracking",
      "alignment"
    ])
    assert.deepStrictEqual(askedOrder(defaultSnapConfig), priorityOf(defaultSnapConfig))
    assert.deepStrictEqual(
      askedOrder(withConnectors(defaultSnapConfig, { weight: 0.5 })),
      priorityOf(defaultSnapConfig)
    )
    const behindTracking = withTargetMoved(withTargetMoved(gridFirst, "connectors", 5), "tracking", 0)
    assert.deepStrictEqual(askedOrder(behindTracking), [
      "tracking",
      "connectors",
      "grid",
      "mesh",
      "construction",
      "alignment"
    ])
    const meshOff = {
      ...behindTracking,
      targets: { ...behindTracking.targets, mesh: { ...behindTracking.targets.mesh, enabled: false } }
    }
    assert.notInclude(askedOrder(meshOff), "mesh")
    assert.notInclude(askedOrder(withConnectors(gridFirst, { enabled: false })), "connectors")
  })

  it("snaps the grid, a turn and a scale only under snapping as a whole, which Ctrl inverts", () => {
    const all = { ...defaultSnapConfig, enabled: true, rotationEnabled: true, scaleEnabled: true }
    assert.isTrue(snapsGrid(all))
    assert.isFalse(snapsGrid({ ...all, enabled: false }))
    assert.isFalse(snapsGrid({ ...all, targets: { ...all.targets, grid: { ...all.targets.grid, enabled: false } } }))
    assert.isTrue(snapsRotation(all))
    assert.isFalse(snapsRotation(all, true))
    assert.isTrue(snapsRotation({ ...all, enabled: false }, true))
    assert.isFalse(snapsRotation({ ...all, rotationEnabled: false }, true))
    assert.isFalse(snapsScale({ ...all, enabled: false }))
    assert.isTrue(snapsScale(all))
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
    assert.strictEqual(
      targetSummary(withConnectors(defaultSnapConfig, { weight: 2 }), "connectors", "cm"),
      "Warn, show on hover, pull ×2"
    )
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
    // Ctrl turns the magnet over; the turn's own toggle still has to be on
    assert.deepStrictEqual(turnSnapOf(off, "turn", [], true), { step: false, targets: [] })
    const rotates = { ...off, rotationEnabled: true }
    assert.deepStrictEqual(turnSnapOf(rotates, "turn", [], false), { step: false, targets: [] })
    assert.deepStrictEqual(turnSnapOf(rotates, "turn", [], true), { step: true, targets: ["connectors", "mesh"] })
    assert.deepStrictEqual(turnSnapOf({ ...rotates, enabled: true }, "turn", [], false), {
      step: true,
      targets: ["connectors", "mesh"]
    })
    assert.deepStrictEqual(turnSnapOf(off, "turn", ["step"], false), { step: true, targets: [] })
    assert.deepStrictEqual(turnSnapOf(off, "turn", ["mesh"], false), { step: false, targets: ["mesh"] })
    assert.deepStrictEqual(turnSnapOf(off, "turn", ["mesh", "step"], false), { step: true, targets: ["mesh"] })
    assert.deepStrictEqual(turnSnapOf(off, "scale", ["mesh"], false), { step: false, targets: ["mesh"] })
    assert.deepStrictEqual(turnSnapOf(off, "turn", ["step"], true), { step: false, targets: [] })
  })

  it("leaves a turn alone under a key that means nothing to it", () => {
    const on = { ...defaultSnapConfig, enabled: true, rotationEnabled: true, scaleEnabled: true }
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

  it("decodes a sidecar's settings from before the connectors' pull at an even pull", () => {
    const encoded = Schema.encodeSync(SnapConfig)(defaultSnapConfig)
    const { weight: _, ...before } = encoded.targets.connectors
    const decoded = Schema.decodeSync(SnapConfig)({ ...encoded, targets: { ...encoded.targets, connectors: before } })
    assert.strictEqual(decoded.targets.connectors.weight, 1)
  })

  it("refuses a pull outside a quarter to four times", () => {
    const encoded = Schema.encodeSync(SnapConfig)(defaultSnapConfig)
    const pulled = (weight: number) => ({
      ...encoded,
      targets: { ...encoded.targets, connectors: { ...encoded.targets.connectors, weight } }
    })
    assert.throws(() => Schema.decodeSync(SnapConfig)(pulled(8)))
    assert.throws(() => Schema.decodeSync(SnapConfig)(pulled(0.1)))
    assert.strictEqual(Schema.decodeSync(SnapConfig)(pulled(4)).targets.connectors.weight, 4)
  })
})
