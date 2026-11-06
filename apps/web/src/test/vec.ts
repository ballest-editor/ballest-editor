import { assert, expect } from "@effect/vitest"
import type { Vec3 } from "../domain/coords"

/** Each component equal to `digits` decimal places. */
export const expectVec = (actual: Vec3, expected: Vec3, digits = 9) => {
  expect(actual.x).toBeCloseTo(expected.x, digits)
  expect(actual.y).toBeCloseTo(expected.y, digits)
  expect(actual.z).toBeCloseTo(expected.z, digits)
}

/** Each component within `epsilon`, with `message` naming what is being compared. */
export const assertVec = (actual: Vec3, expected: Vec3, message: string, epsilon = 1e-6) => {
  for (const k of ["x", "y", "z"] as const) assert.closeTo(actual[k], expected[k], epsilon, `${message}: ${k}`)
}
