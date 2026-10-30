import { describe, expect, it } from "@effect/vitest"
import { formatNumber, stringifyUe } from "./ueJson"

describe("ueJson", () => {
  it.each([
    [0, "0"],
    [-0, "-0"],
    [10, "10"],
    [-3955, "-3955"],
    [0.276538, "0.27653800000000001"],
    [-Math.SQRT1_2, "-0.70710678118654757"],
    [184.154937744140625, "184.15493774414062"], // exact tie -> even
    [708.87933349609375, "708.87933349609375"],
    [1e-5, "1.0000000000000001e-05"],
    [-4.47121194779352e-12, "-4.4712119477935202e-12"],
    [1e21, "1e+21"],
    [123456789012345680000, "1.2345678901234568e+20"]
  ])("formats %d as %s like C printf", (n, expected) => {
    expect(formatNumber(n)).toBe(expected)
  })

  it("lays out objects and arrays like UE", () => {
    expect(stringifyUe({ a: { b: 1 }, c: [], d: [{ e: "x" }, 2] })).toBe(
      "{\r\n\t\"a\":\r\n\t{\r\n\t\t\"b\": 1\r\n\t},\r\n\t\"c\": [],\r\n\t\"d\": [\r\n\t\t{\r\n\t\t\t\"e\": \"x\"\r\n\t\t},\r\n\t\t2\r\n\t]\r\n}"
    )
  })

  it("rejects non-finite numbers", () => {
    expect(() => stringifyUe({ a: Number.NaN })).toThrow("Cannot write non-finite number NaN to JSON")
  })
})
