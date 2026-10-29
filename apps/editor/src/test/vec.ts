import { expect } from "@effect/vitest"
import type { Vec3 } from "../domain/coords"

/** Each component equal to `digits` decimal places. */
export const expectVec = (actual: Vec3, expected: Vec3, digits = 9) => {
  expect(actual.x).toBeCloseTo(expected.x, digits)
  expect(actual.y).toBeCloseTo(expected.y, digits)
  expect(actual.z).toBeCloseTo(expected.z, digits)
}
