import { assert, describe, it } from "@effect/vitest"
import { applyNumberEntry, parseNumberEntry, scrubbedValue, scrubSpeedOf } from "./numberEntry"

const applied = (text: string, current: number) => {
  const entry = parseNumberEntry(text)
  return entry === null ? null : applyNumberEntry(entry, current)
}

describe("parseNumberEntry", () => {
  it("reads an operation on the current value", () => {
    assert.deepStrictEqual(parseNumberEntry("+50"), { kind: "add", by: 50 })
    assert.deepStrictEqual(parseNumberEntry("-=20"), { kind: "add", by: -20 })
    assert.deepStrictEqual(parseNumberEntry("*2"), { kind: "multiply", by: 2 })
    assert.deepStrictEqual(parseNumberEntry("/2"), { kind: "multiply", by: 0.5 })
  })

  it("applies each operation to the current value", () => {
    assert.strictEqual(applied("+100", -2790), -2690)
    assert.strictEqual(applied("-=20", 100), 80)
    assert.strictEqual(applied("*2", 1.5), 3)
    assert.strictEqual(applied("/2", 9), 4.5)
    assert.strictEqual(applied("*-1", 40), -40)
  })

  it("takes spaces and decimals", () => {
    assert.strictEqual(applied(" + 2.5 ", 1), 3.5)
    assert.strictEqual(applied("-.5", 1), -0.5)
  })

  it("reads a plain number as a value, whatever the field holds", () => {
    assert.strictEqual(applied("12.5", 7), 12.5)
    assert.strictEqual(applied("0", 7), 0)
  })

  it("sets signed values and evaluates arithmetic with precedence", () => {
    assert.strictEqual(applied("-200", -100), -200)
    assert.strictEqual(applied("2 + 3 * 4", 7), 14)
    assert.strictEqual(applied("(2 + 3) * -4", 7), -20)
    assert.strictEqual(applied("1e2 / 4", 7), 25)
    for (const text of ["1 / 0", "(2+3", "2foo", "2**3", "1e999", "1/(1/0)", "1/1e999"]) {
      assert.isNull(parseNumberEntry(text))
    }
  })

  it("sets a negative value outright with =", () => {
    assert.deepStrictEqual(parseNumberEntry("=-20"), { kind: "set", value: -20 })
    assert.strictEqual(applied("= 5", 7), 5)
  })

  it("refuses what isn't a number, and dividing by zero", () => {
    for (const text of ["", " ", "+", "-", "*", "/", "=", "abc", "+abc", "/0", "*Infinity", "--"]) {
      assert.isNull(parseNumberEntry(text), text)
    }
  })
})

describe("scrubbing", () => {
  it("counts a pixel ×10 with Shift, ×0.1 with Alt", () => {
    assert.strictEqual(scrubSpeedOf({ shiftKey: false, altKey: false }), 1)
    assert.strictEqual(scrubSpeedOf({ shiftKey: true, altKey: false }), 10)
    assert.strictEqual(scrubSpeedOf({ shiftKey: false, altKey: true }), 0.1)
  })

  it("moves a step per pixel", () => {
    assert.strictEqual(scrubbedValue(-2790, 100, 1, undefined), -2690)
    assert.strictEqual(scrubbedValue(-2790, 1000, 1, undefined), -1790)
    assert.closeTo(scrubbedValue(1, 10, 0.01, undefined), 1.1, 1e-9)
  })

  it("lands on the snap, moving faster when it is coarse", () => {
    assert.strictEqual(scrubbedValue(0, 100, 1, 10), 100)
    assert.strictEqual(scrubbedValue(0, 10, 1, 100), 100)
    assert.strictEqual(scrubbedValue(0, 4, 1, 100), 0)
  })

  it("counts the snap from where its steps start, as a grid with an origin of its own", () => {
    assert.strictEqual(scrubbedValue(0, 100, 1, 10, 3), 103)
    assert.strictEqual(scrubbedValue(3, 0, 1, 10, 3), 3)
    assert.strictEqual(scrubbedValue(0, 100, 1, 10, -45), 105)
  })
})
