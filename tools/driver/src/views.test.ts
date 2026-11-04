import { describe, expect, it } from "vitest"
import { frame, STANDARD_VIEWS } from "./views.ts"

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

  it("fits the bounding sphere in the vertical field of view", () => {
    const radius = Math.hypot(100, 50, 20)
    const camera = frame(box, { name: "left", from: [0, -1, 0] }, 60)
    const distance = Math.hypot(camera.x - 0, camera.y - 0, camera.z - 20)
    const vertical = 2 * Math.atan(Math.tan(Math.PI / 6) * 9 / 16)
    expect(distance * Math.sin(vertical / 2)).toBeCloseTo(radius * 1.15, 6)
  })

  it("has eight standard views with distinct names", () => {
    expect(new Set(STANDARD_VIEWS.map((v) => v.name)).size).toBe(8)
  })
})
