import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { allSnapping } from "../test/snapFixtures"
import {
  askedOrder,
  defaultSnapConfig,
  isPreset,
  narrowedTo,
  priorityOf,
  rangeOf,
  scaleSnapStep,
  SNAP_KINDS,
  SnapConfig,
  snapsGrid,
  snapsRotation,
  snapsScale,
  type SnapTarget,
  targetOn,
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
  it("starts with nothing snapping, on Grid first with every target's own switch on", () => {
    assert.deepStrictEqual(priorityOf(defaultSnapConfig), [])
    assert.isFalse(snapsGrid(defaultSnapConfig))
    assert.isFalse(snapsRotation(defaultSnapConfig))
    assert.isFalse(snapsScale(defaultSnapConfig))
    assert.deepStrictEqual(priorityOf({ ...defaultSnapConfig, magnet: true }), [
      "connectors",
      "mesh",
      "construction",
      "tracking",
      "alignment"
    ])
    assert.deepStrictEqual(priorityOf(allSnapping), [
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
    assert.strictEqual(priorityOf(withPreset(allSnapping, "piecesFirst")).at(-1), "grid")
  })

  it("moves a row, and a target that is off drops out of the order it is read in", () => {
    const moved = withTargetMoved(allSnapping, "alignment", 0)
    assert.strictEqual(priorityOf(moved)[0], "alignment")
    const off = {
      ...moved,
      targets: { ...moved.targets, alignment: { ...moved.targets.alignment, enabled: false } }
    }
    assert.strictEqual(priorityOf(off)[0], "grid")
    assert.lengthOf(priorityOf(off), 5)
  })

  it("reads an order that lost or repeats a target as a whole one", () => {
    const short = { ...allSnapping, order: ["mesh", "mesh"] as const }
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
    assert.strictEqual(rangeOf(allSnapping, "connectors"), 12)
    const own = {
      ...allSnapping,
      targets: { ...allSnapping.targets, connectors: { ...allSnapping.targets.connectors, range: 30 } }
    }
    assert.strictEqual(rangeOf(own, "connectors"), 30)
    assert.strictEqual(rangeOf(own, "mesh"), 12)
  })

  it("scales a connector's range by its pull, and nothing else's", () => {
    assert.strictEqual(allSnapping.targets.connectors.weight, 1)
    assert.strictEqual(rangeOf(withConnectors(allSnapping, { weight: 2 }), "connectors"), 24)
    assert.strictEqual(rangeOf(withConnectors(allSnapping, { weight: 0.5, range: 30 }), "connectors"), 15)
    assert.strictEqual(rangeOf(withConnectors(allSnapping, { weight: 4 }), "mesh"), 12)
  })

  it("asks Connectors ahead of Grid and Mesh only while it pulls harder than even", () => {
    const gridFirst = withConnectors(allSnapping, { weight: 2 })
    assert.deepStrictEqual(askedOrder(gridFirst), [
      "connectors",
      "grid",
      "mesh",
      "construction",
      "tracking",
      "alignment"
    ])
    assert.deepStrictEqual(askedOrder(allSnapping), priorityOf(allSnapping))
    assert.deepStrictEqual(
      askedOrder(withConnectors(allSnapping, { weight: 0.5 })),
      priorityOf(allSnapping)
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

  it("snaps the grid, a turn and a scale by their own switches, magnet or not, and Ctrl turns them off", () => {
    const all = { ...allSnapping, rotationEnabled: true, scaleEnabled: true }
    const noMagnet = { ...all, magnet: false }
    assert.isTrue(snapsGrid(all))
    assert.isTrue(snapsGrid(noMagnet))
    assert.isFalse(snapsGrid({ ...all, targets: { ...all.targets, grid: { ...all.targets.grid, enabled: false } } }))
    assert.isTrue(snapsRotation(all))
    assert.isTrue(snapsRotation(noMagnet))
    assert.isFalse(snapsRotation(all, true))
    assert.isFalse(snapsRotation({ ...all, rotationEnabled: false }))
    assert.isTrue(snapsScale(noMagnet))
    assert.isFalse(snapsScale(noMagnet, true))
    assert.isFalse(snapsScale({ ...all, scaleEnabled: false }))
  })

  it("asks the grid alone with the magnet off, and every target on with it on", () => {
    assert.deepStrictEqual(priorityOf({ ...allSnapping, magnet: false }), ["grid"])
    assert.deepStrictEqual(askedOrder({ ...allSnapping, magnet: false }), ["grid"])
    assert.isFalse(targetOn({ ...allSnapping, magnet: false }, "connectors"))
    assert.isTrue(targetOn({ ...allSnapping, magnet: false }, "grid"))
    assert.isTrue(targetOn(allSnapping, "connectors"))
  })

  it("summarises each target in one line", () => {
    assert.strictEqual(targetSummary(allSnapping, "grid", "cm"), "10 cm, world origin")
    assert.strictEqual(targetSummary(allSnapping, "connectors", "cm"), "12 px, match rotation")
    const moved = {
      ...allSnapping,
      targets: {
        ...allSnapping.targets,
        grid: { ...allSnapping.targets.grid, origin: { x: 137, y: 0, z: 0 }, yaw: 30 }
      }
    }
    assert.strictEqual(targetSummary(moved, "grid", "cm"), "10 cm, own origin, 30°")
    assert.strictEqual(
      targetSummary(withConnectors(allSnapping, { weight: 2 }), "connectors", "cm"),
      "12 px, match rotation, pull ×2"
    )
    assert.strictEqual(
      targetSummary(withConnectors(allSnapping, { range: 30, matchRotation: false }), "connectors", "cm"),
      "30 px, keep rotation"
    )
  })

  it("narrows to the kinds held, the priority list keeping its order among them", () => {
    const piecesFirst = withPreset(allSnapping, "piecesFirst")
    assert.deepStrictEqual(priorityOf(narrowedTo(piecesFirst, ["connectors"])), ["connectors"])
    assert.deepStrictEqual(priorityOf(narrowedTo(piecesFirst, ["alignment"])), ["tracking", "alignment"])
    assert.deepStrictEqual(priorityOf(narrowedTo(piecesFirst, ["mesh", "connectors"])), ["connectors", "mesh"])
    assert.strictEqual(narrowedTo(piecesFirst, ["mesh"]).threshold, piecesFirst.threshold)
    assert.strictEqual(narrowedTo(piecesFirst, []), piecesFirst)
  })

  it("keeps the grid off under every key: J, M and L each narrow to a target, and none to the grid", () => {
    assert.deepStrictEqual(SNAP_KINDS, ["connectors", "mesh", "alignment"])
    for (const kind of SNAP_KINDS) assert.isFalse(narrowedTo(allSnapping, [kind]).targets.grid.enabled)
  })

  it("turns the magnet on for the kind held, even a target that was off", () => {
    const off = {
      ...allSnapping,
      magnet: false,
      targets: { ...allSnapping.targets, mesh: { ...allSnapping.targets.mesh, enabled: false } }
    }
    const narrowed = narrowedTo(off, ["mesh"])
    assert.isTrue(narrowed.magnet)
    assert.deepStrictEqual(priorityOf(narrowed), ["mesh"])
    assert.strictEqual(narrowed.targets.mesh.sharpAngle, off.targets.mesh.sharpAngle)
  })

  it("steps a turn by its own switch, stops it on the targets that are on, and narrows under a held key", () => {
    const off = { ...allSnapping, magnet: false, rotationEnabled: false, scaleEnabled: false }
    const stops: ReadonlyArray<SnapTarget> = ["grid", "connectors", "mesh", "alignment"]
    assert.deepStrictEqual(turnSnapOf(off, "turn", [], false), { step: false, targets: ["grid"] })
    const rotates = { ...off, rotationEnabled: true }
    assert.deepStrictEqual(turnSnapOf(rotates, "turn", [], false), { step: true, targets: ["grid"] })
    assert.deepStrictEqual(turnSnapOf(defaultSnapConfig, "turn", [], false), { step: false, targets: [] })
    assert.deepStrictEqual(turnSnapOf({ ...defaultSnapConfig, rotationEnabled: true }, "turn", [], false), {
      step: true,
      targets: []
    })
    const on = { ...rotates, magnet: true }
    assert.deepStrictEqual(turnSnapOf(on, "turn", [], false), { step: true, targets: stops })
    assert.deepStrictEqual(turnSnapOf({ ...off, magnet: true }, "scale", [], false), {
      step: false,
      targets: ["mesh"]
    })
    // a key keeps its kind's stops, and the step is as Rotation says
    assert.deepStrictEqual(turnSnapOf(on, "turn", ["connectors"], false), { step: true, targets: ["connectors"] })
    assert.deepStrictEqual(turnSnapOf(on, "turn", ["mesh"], false), { step: true, targets: ["mesh"] })
    assert.deepStrictEqual(turnSnapOf(on, "turn", ["alignment"], false), { step: true, targets: ["alignment"] })
    assert.deepStrictEqual(turnSnapOf({ ...on, rotationEnabled: false }, "turn", ["mesh"], false), {
      step: false,
      targets: ["mesh"]
    })
    // with the magnet off a key brings its kind's stops, and the step is still Rotate's own
    assert.deepStrictEqual(turnSnapOf(rotates, "turn", ["mesh"], false), { step: true, targets: ["mesh"] })
    assert.deepStrictEqual(turnSnapOf(off, "scale", ["mesh"], false), { step: false, targets: ["mesh"] })
  })

  it("snaps nothing in a turn or a scale while Ctrl is held, a narrowing key with it or not", () => {
    const on = { ...allSnapping, rotationEnabled: true, scaleEnabled: true }
    const none = { step: false, targets: [] }
    assert.deepStrictEqual(turnSnapOf(on, "turn", [], true), none)
    assert.deepStrictEqual(turnSnapOf(on, "turn", ["connectors"], true), none)
    assert.deepStrictEqual(turnSnapOf(on, "scale", ["mesh"], true), none)
    // with the magnet off, Ctrl still holds the grid and the step off
    assert.deepStrictEqual(turnSnapOf({ ...on, magnet: false }, "turn", [], true), none)
  })

  it("leaves a scale alone under a key that means nothing to it", () => {
    const on = { ...allSnapping, rotationEnabled: true, scaleEnabled: true }
    assert.deepStrictEqual(turnSnapOf(on, "scale", ["alignment"], false), turnSnapOf(on, "scale", [], false))
    assert.deepStrictEqual(turnSnapOf(on, "scale", ["connectors"], false), { step: true, targets: ["mesh"] })
  })

  it("reads a config from before your snapping moved to Settings, and drops what moved", () => {
    const encoded = Schema.encodeSync(SnapConfig)(defaultSnapConfig)
    const { connectors, mesh, tracking } = encoded.targets
    const before = {
      ...encoded,
      bodyDrag: "always",
      targets: {
        ...encoded.targets,
        connectors: { ...connectors, profiles: "strict", showOpenEnds: "always", flipToFit: false },
        mesh: { ...mesh, occlusion: "through" },
        tracking: { ...tracking, keep: 3, hoverMs: 200, acquire: "shift" }
      }
    }
    assert.deepStrictEqual(Schema.decodeSync(SnapConfig)(before), defaultSnapConfig)
  })

  describe("a config saved while the magnet gated all of snapping", () => {
    const { magnet: _, ...current } = allSnapping
    const gated = (enabled: boolean) => ({ ...current, enabled, rotationEnabled: true, scaleEnabled: true })

    it("reads one saved off as it behaved: the grid, Rotate and Scale off with the magnet", () => {
      const decoded = Schema.decodeSync(SnapConfig)(gated(false))
      assert.isFalse(decoded.magnet)
      assert.isFalse(decoded.targets.grid.enabled)
      assert.isFalse(decoded.rotationEnabled)
      assert.isFalse(decoded.scaleEnabled)
      assert.isTrue(decoded.targets.mesh.enabled, "each target's own switch is kept")
      assert.deepStrictEqual(priorityOf(decoded), [])
    })

    it("reads one saved on as it was, with the magnet on", () => {
      const decoded = Schema.decodeSync(SnapConfig)(gated(true))
      assert.isTrue(decoded.magnet)
      assert.isTrue(decoded.targets.grid.enabled)
      assert.isTrue(decoded.rotationEnabled)
      assert.isTrue(decoded.scaleEnabled)
    })

    it("reads the old defaults as the new ones, so a map on the defaults snaps as it did", () => {
      const oldDefaults = {
        ...current,
        enabled: false,
        targets: { ...current.targets, grid: { ...current.targets.grid, enabled: true } }
      }
      assert.deepStrictEqual(Schema.decodeSync(SnapConfig)(oldDefaults), defaultSnapConfig)
    })

    it("is saved in the current form", () => {
      const decoded = Schema.decodeSync(SnapConfig)(gated(true))
      const saved = Schema.encodeSync(SnapConfig)(decoded)
      assert.propertyVal(saved, "magnet", true)
      assert.notProperty(saved, "enabled")
    })
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

describe("scale snap units", () => {
  it("uses the grid dimension for both size fields and handles, independently of percent snapping", () => {
    const config = { ...allSnapping, magnet: false, gridSize: 50 }
    assert.strictEqual(scaleSnapStep(config, 1000), 0.05, "the grid's own switch, magnet or not")
    assert.isUndefined(scaleSnapStep(config, undefined))
    assert.isUndefined(scaleSnapStep(config, 1000, true))
    assert.isUndefined(scaleSnapStep(defaultSnapConfig, 1000))
    assert.isUndefined(scaleSnapStep({ ...config, scaleToGrid: false }, 1000))
    assert.strictEqual(scaleSnapStep({ ...config, scaleToGrid: false, scaleEnabled: true, scaleStep: 10 }, 1000), 0.1)
  })
})
