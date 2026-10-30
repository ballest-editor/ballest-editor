import { describe, expect, it } from "@effect/vitest"
import { quatToRotator, rotatorToQuat } from "./ueMath"

describe("quatToRotator", () => {
  it.each([
    { pitch: 0, yaw: 0, roll: 0 },
    { pitch: 30, yaw: -45, roll: 60 },
    { pitch: -80, yaw: 170, roll: -120 },
    { pitch: 10, yaw: 90, roll: 0 }
  ])("inverts rotatorToQuat for %o", (r) => {
    const back = quatToRotator(rotatorToQuat(r))
    expect(back.pitch).toBeCloseTo(r.pitch, 6)
    expect(back.yaw).toBeCloseTo(r.yaw, 6)
    expect(back.roll).toBeCloseTo(r.roll, 6)
  })

  it("resolves gimbal lock to the same orientation", () => {
    const q = rotatorToQuat({ pitch: 90, yaw: 20, roll: 50 })
    const back = rotatorToQuat(quatToRotator(q))
    const dot = Math.abs(q.x * back.x + q.y * back.y + q.z * back.z + q.w * back.w)
    expect(dot).toBeCloseTo(1, 6)
  })
})
