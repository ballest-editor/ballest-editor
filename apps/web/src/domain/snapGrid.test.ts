import { assert, describe, it } from "@effect/vitest"
import { expectVec } from "../test/vec"
import { defaultSnapConfig, type SnapConfig } from "./snapConfig"
import { gridAxes, gridInView, gridLanding, gridSpacingPixels, nearestGridPoint } from "./snapGrid"

const config = (grid: Partial<SnapConfig["targets"]["grid"]>, gridSize = 100): SnapConfig => ({
  ...defaultSnapConfig,
  gridSize,
  targets: { ...defaultSnapConfig.targets, grid: { ...defaultSnapConfig.targets.grid, ...grid } }
})

describe("snapGrid", () => {
  it("lands on the world's multiples by default, as it always has", () => {
    expectVec(nearestGridPoint(config({}), { x: 149, y: -151, z: 40 }), { x: 100, y: -200, z: 0 })
  })

  it("counts from the origin", () => {
    expectVec(nearestGridPoint(config({ origin: { x: 37, y: 0, z: 5 } }), { x: 150, y: 0, z: 0 }), {
      x: 137,
      y: 0,
      z: 5
    })
  })

  it("turns with the grid's yaw, about its origin", () => {
    const turned = config({ yaw: 90 })
    expectVec(nearestGridPoint(turned, { x: 149, y: 40, z: 0 }), { x: 100, y: 0, z: 0 })
    const thirty = config({ yaw: 30, origin: { x: 10, y: 20, z: 0 } })
    const [x] = gridAxes(thirty)
    expectVec(nearestGridPoint(thirty, { x: 10 + x.x * 210, y: 20 + x.y * 210, z: 0 }), {
      x: 10 + x.x * 200,
      y: 20 + x.y * 200,
      z: 0
    })
  })

  it("gives the grid's axes, Z staying up", () => {
    const [x, y, z] = gridAxes(config({ yaw: 90 }))
    expectVec(x, { x: 0, y: 1, z: 0 })
    expectVec(y, { x: -1, y: 0, z: 0 })
    expectVec(z, { x: 0, y: 0, z: 1 })
  })

  it("rounds a move in whole steps along the given axes, for a handle on the item's own", () => {
    const axis = { x: 0, y: 1, z: 0 }
    expectVec(gridLanding(config({}), { x: 3, y: 3, z: 3 }, { x: 0, y: 149, z: 0 }, [axis]), { x: 3, y: 103, z: 3 })
  })

  it("draws in a top view turned with the grid, from its origin", () => {
    const view = gridInView(config({ origin: { x: 30, y: 40, z: 5 }, yaw: 30 }), { x: 1, y: 0, z: 0 }, {
      x: 0,
      y: 1,
      z: 0
    })
    assert.deepStrictEqual(view.origin, { x: 30, y: 40 })
    assert.closeTo(view.across.x, Math.cos(Math.PI / 6), 1e-9)
    assert.closeTo(view.across.y, Math.sin(Math.PI / 6), 1e-9)
    assert.closeTo(view.along.x, -Math.sin(Math.PI / 6), 1e-9)
  })

  it("spreads a turned grid's lines in a view that sees it edge on", () => {
    const view = gridInView(config({ yaw: 30 }), { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 })
    assert.closeTo(view.across.x, Math.cos(Math.PI / 6), 1e-9)
    assert.deepStrictEqual(view.along, { x: 0, y: 1 })
  })

  it("measures its spacing on screen", () => {
    assert.strictEqual(gridSpacingPixels(config({}), 2), 50)
  })
})
