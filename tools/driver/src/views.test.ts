import { describe, expect, it } from "vitest"
import { frame, ruler, STANDARD_VIEWS, studio } from "./views.ts"

const box = { min: [-100, -50, 0] as const, max: [100, 50, 40] as const }

describe("views", () => {
  it("looks at the centre from the view's side", () => {
    const front = frame(box, { name: "front", from: [-1, 0, 0] }, 60)
    expect(front.x).toBeLessThan(-100)
    expect(front.y).toBeCloseTo(0)
    expect(front.z).toBeCloseTo(20)
    expect(front.yaw).toBeCloseTo(0)
    expect(front.pitch).toBeCloseTo(0)
    const top = frame(box, { name: "top", from: [0, 0, 1] }, 60)
    expect(top.pitch).toBeCloseTo(-90)
    expect(top.z).toBeGreaterThan(40)
  })

  it("fits what an axis view sees, and the bounding sphere otherwise", () => {
    // From the left the box is 200 wide and 40 high: the width against the horizontal field of view decides.
    const left = frame(box, { name: "left", from: [0, -1, 0] }, 60)
    expect(-left.y - 50).toBeCloseTo(100 / Math.tan(Math.PI / 6) * 1.15, 6)
    const radius = Math.hypot(100, 50, 20)
    const quarter = frame(box, { name: "q", from: [-1, -1, 0.6] }, 60)
    const distance = Math.hypot(quarter.x, quarter.y, quarter.z - 20)
    const vertical = 2 * Math.atan(Math.tan(Math.PI / 6) * 9 / 16)
    expect(distance * Math.sin(vertical / 2)).toBeCloseTo(radius * 1.15, 6)
  })

  it("builds a studio the camera stays inside", () => {
    const walls = studio(box)
    expect(walls).toHaveLength(6)
    const radius = Math.hypot(100, 50, 20)
    const front = frame(box, { name: "front", from: [-1, 0, 0] }, 60)
    const behindFront = walls.find((w) => w.location[0] > 0)
    // The wall's near face (its middle less half its side) is beyond the far side of the piece.
    expect((behindFront?.location[0] ?? 0) - 15_000).toBeCloseTo(radius * 4)
    // And the camera is nearer than that on its own side.
    const behindCamera = walls.find((w) => w.location[0] < 0)
    expect(front.x).toBeGreaterThan((behindCamera?.location[0] ?? 0) + 15_000)
    const floor = walls.find((w) => w.location[2] < -20_000)
    expect((floor?.location[2] ?? 0) + 15_000 + 15_000).toBeCloseTo(20 - radius * 4)
    expect(ruler(box).scale).toEqual([0.1, 0.1, 0.1])
    expect(ruler(box).location[2]).toBe(0)
  })

  it("has eight standard views with distinct names", () => {
    expect(new Set(STANDARD_VIEWS.map((v) => v.name)).size).toBe(8)
  })
})
