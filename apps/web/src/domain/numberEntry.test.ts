import { assert, describe, it } from "@effect/vitest"
import { applyNumberEntry, parseNumberEntry, scrubbedValue, scrubSpeedOf, workOutEntry } from "./numberEntry"

const applied = (text: string, current: number) => {
  const entry = parseNumberEntry(text)
  return entry === null ? null : applyNumberEntry(entry, current)
}

describe("parseNumberEntry", () => {
  it("applies each operation to the current value", () => {
    assert.strictEqual(applied("+100", -2790), -2690)
    assert.strictEqual(applied("+=100", -2790), -2690)
    assert.strictEqual(applied("-=20", 100), 80)
    assert.strictEqual(applied("*2", 1.5), 3)
    assert.strictEqual(applied("*=2", 1.5), 3)
    assert.strictEqual(applied("/2", 9), 4.5)
    assert.strictEqual(applied("/=2", 9), 4.5)
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

  it("sets a negative value outright, with = or without", () => {
    assert.strictEqual(applied("=-20", 7), -20)
    assert.strictEqual(applied("-20", 7), -20)
    assert.strictEqual(applied("= 5", 7), 5)
  })

  it("raises to a power, tighter than a sign and from the right", () => {
    assert.strictEqual(applied("2^3", 0), 8)
    assert.strictEqual(applied("-2^2", 0), -4)
    assert.strictEqual(applied("2^3^2", 0), 512)
    assert.strictEqual(applied("2^-1", 0), 0.5)
    assert.closeTo(applied("+= 300 * 1.2^2", 0)!, 432, 1e-9)
  })

  it("refuses what isn't a number, and dividing by zero", () => {
    for (
      const text of [
        "",
        " ",
        "+",
        "-",
        "*",
        "/",
        "=",
        "abc",
        "+abc",
        "/0",
        "/=0",
        "*Infinity",
        "--",
        "$",
        "$foo",
        "L(1)",
        "L(1,",
        "$index",
        "2^",
        "+=-=1"
      ]
    ) {
      assert.isNull(parseNumberEntry(text), text)
    }
  })
})

describe("workOutEntry, over several things", () => {
  const over = (text: string, values: ReadonlyArray<number | undefined>) =>
    workOutEntry(parseNumberEntry(text)!, values)

  it("sets every thing to a plain number or plain arithmetic", () => {
    assert.deepStrictEqual(over("100", [1, 2, 3]), [100, 100, 100])
    assert.deepStrictEqual(over("100+50", [1, 2, 3]), [150, 150, 150])
    assert.deepStrictEqual(over("-20", [1, 2, 3]), [-20, -20, -20])
  })

  it("works a relative entry out for each thing from its own value", () => {
    assert.deepStrictEqual(over("+= 100", [0, 50, -200]), [100, 150, -100])
    assert.deepStrictEqual(over("+100", [0, 50, -200]), [100, 150, -100])
    assert.deepStrictEqual(over("-= 10", [0, 50]), [-10, 40])
    assert.deepStrictEqual(over("*= 2", [1, 3]), [2, 6])
    assert.deepStrictEqual(over("*2", [1, 3]), [2, 6])
    assert.deepStrictEqual(over("/= 2", [1, 3]), [0.5, 1.5])
    assert.deepStrictEqual(over("/4", [1, 3]), [0.25, 0.75])
  })

  it("spreads L(a, b) evenly from a to b across the things, in order", () => {
    assert.deepStrictEqual(over("L(0, 1000)", [7, 7, 7, 7, 7]), [0, 250, 500, 750, 1000])
    assert.deepStrictEqual(over("l(10, -10)", [0, 0, 0]), [10, 0, -10])
    assert.deepStrictEqual(over("L(0, 1000)", [7]), [0], "one thing takes a")
    assert.deepStrictEqual(over("+= L(0, 30)", [1, 1, 1, 1]), [1, 11, 21, 31])
  })

  it("counts $i from 0, and takes $prev as the value just worked out for the thing before", () => {
    assert.deepStrictEqual(over("$i * 10", [5, 5, 5]), [0, 10, 20])
    assert.deepStrictEqual(over("$prev + 300", [100, 7, -40]), [100, 400, 700], "the first stays: even spacing from it")
    assert.deepStrictEqual(over("$prev * 2", [3, 0, 0, 0]), [3, 6, 12, 24], "a geometric series")
    assert.deepStrictEqual(over("+= 300 * 2^$i", [0, 0, 0]), [300, 600, 1200], "growing gaps")
  })

  it("leaves a thing without a value as it is, and gives the next the last value worked out", () => {
    assert.deepStrictEqual(over("$prev + 1", [10, undefined, 0]), [10, undefined, 11])
    assert.deepStrictEqual(over("+= 1", [10, undefined]), [11, undefined])
  })

  it("leaves a thing as it is when its value works out to nothing finite", () => {
    assert.deepStrictEqual(over("/= $i", [10, 10]), [10, 10])
    assert.deepStrictEqual(over("1 / $i", [5, 5]), [5, 1])
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
