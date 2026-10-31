import { assert, describe, it } from "@effect/vitest"
import { dayLabel, formatAgo } from "./time"

// Local times, so the tests pass in any time zone.
const now = new Date(2026, 9, 31, 15, 0).getTime()
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString()

describe("time", () => {
  it("says how long ago, coarser as it gets older", () => {
    assert.strictEqual(formatAgo(at(31, 14, 59), now), "1 min ago")
    assert.strictEqual(formatAgo(new Date(now - 20_000).toISOString(), now), "just now")
    assert.strictEqual(formatAgo(at(31, 14, 4), now), "56 min ago")
    assert.strictEqual(formatAgo(at(31, 1), now), "14 h ago")
    assert.strictEqual(formatAgo(at(30, 23), now), "yesterday")
    assert.strictEqual(formatAgo(at(28, 9), now), "3 d ago")
    assert.match(formatAgo(at(1, 9), now), /2026/)
    // a clock that went backwards isn't "in the future"
    assert.strictEqual(formatAgo(at(31, 16), now), "just now")
    assert.strictEqual(formatAgo("not a time", now), "at an unknown time")
  })

  it("groups by local day", () => {
    assert.strictEqual(dayLabel(at(31, 0, 1), now), "Today")
    assert.strictEqual(dayLabel(at(30, 23, 59), now), "Yesterday")
    assert.notInclude(["Today", "Yesterday"], dayLabel(at(29, 12), now))
  })
})
