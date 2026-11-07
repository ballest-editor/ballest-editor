import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { hexToLinear } from "./color"
import { ARENA_RIM, evalCurve, SKY_GAIN, skyColorAt, skyIrradiance, skyOf, skyRadiance } from "./sky"
import { sunOf } from "./sunlight"

const EPSILON = 1e-4
const skyAt = (timeOfDay: number) => skyOf(sunOf({ timeOfDay, brightness: 12, angle: 0 }), timeOfDay)
const UP = { x: 0, y: 0, z: 1 }

describe("sky", () => {
  it("gives a swatch of the sky at a time: blue at noon, warm at sunrise, dark at midnight", () => {
    const [noon, sunrise, midnight] = [12, 6, 0].map((t) => Option.getOrThrow(hexToLinear(skyColorAt(t))))
    assert.isTrue(noon![2] > noon![1] && noon![1] > noon![0])
    assert.isTrue(sunrise![0] > sunrise![1] && sunrise![1] > sunrise![2])
    assert.isTrue(Math.max(...midnight!) < Math.min(noon![2], sunrise![0]))
  })

  // Sampled from the game (docs/qa/sky-horizon.md): the renderer's own tone mapping can't get from the curves to these.
  it("shows the horizon the game shows, through the day and at night", () => {
    const measured = [[5, "#d18548"], [6, "#d0884b"], [7.2997, "#cc9f8b"], [9, "#abbcce"], [12, "#abbcce"], [
      18,
      "#d0884b"
    ], [22, "#171b31"]] as const
    for (const [time, hex] of measured) {
      const expected = Option.getOrThrow(hexToLinear(hex))
      skyAt(time).shownHorizon.forEach((channel, i) => assert.closeTo(channel, expected[i]!, 0.01, `${time}:00`))
    }
  })

  it("evaluates UE curves through their keys and holds the ends", () => {
    const keys = [[0, 1, 0, 0], [1, 3, 2, 2], [2, 0, 0, 0]] as const
    assert.closeTo(evalCurve(keys, 0), 1, EPSILON)
    assert.closeTo(evalCurve(keys, 1), 3, EPSILON)
    assert.closeTo(evalCurve(keys, -5), 1, EPSILON)
    assert.closeTo(evalCurve(keys, 9), 0, EPSILON)
    const mid = evalCurve(keys, 0.5)
    assert.isTrue(mid > 1 && mid < 3)
  })

  it("follows the sun's height by day: the engine curves, clamped to 0-1", () => {
    const noon = skyAt(12)
    // past the curves' last keys
    assert.deepStrictEqual(noon.zenith.map((c) => +c.toFixed(4)), [0.0228, 0.049, 0.12])
    assert.deepStrictEqual(noon.horizon.map((c) => +c.toFixed(4)), [0.92, 1, 1])
    assert.closeTo(noon.horizonFalloff, 7, EPSILON)
    assert.strictEqual(noon.sunBrightness, 20)
    assert.strictEqual(noon.stars, 0)
    // at sunrise the horizon curve's red is 2, clamped to 1
    const [r, g, b] = skyAt(6).horizon
    assert.closeTo(r, 1, EPSILON)
    assert.isTrue(g < r && b < g, "an orange horizon")
  })

  it("switches to the fixed night look with stars before 4:00 and after 20:00", () => {
    const night = skyAt(22)
    assert.deepStrictEqual(night.zenith, [0, 0.067719, 0.135417])
    assert.strictEqual(night.sunBrightness, 0)
    assert.closeTo(night.horizonFalloff, 0.2, EPSILON)
    assert.closeTo(night.stars, 25 * (60 / 90), 1e-3) // the sun is 60° below the horizon at 22:00
  })

  it("blends from zenith to horizon by elevation", () => {
    const sky = skyAt(12)
    assert.closeTo(skyRadiance(sky, UP)[2], SKY_GAIN * sky.zenith[2], EPSILON)
    assert.closeTo(skyRadiance(sky, { x: 1, y: 0, z: 0 })[2], SKY_GAIN * sky.horizon[2], EPSILON)
  })

  it("measures the light on a surface: an even sky lights every face the same", () => {
    const even = { ...skyAt(12), zenith: [0.5, 0.5, 0.5], horizon: [0.5, 0.5, 0.5] } as const
    const radiance = SKY_GAIN * 0.5
    assert.closeTo(skyIrradiance(even, UP, radiance), radiance, 1e-3)
    assert.closeTo(skyIrradiance(even, { x: 1, y: 0, z: 0 }, radiance), radiance, 1e-3)
    // no ground: an upright face sees half as much
    assert.closeTo(skyIrradiance(even, { x: 1, y: 0, z: 0 }, 0), radiance / 2, 2e-2)
    // the arena takes the low sky too: a side face loses more of it than an up-facing one
    const side = skyIrradiance(even, { x: 1, y: 0, z: 0 }, 0, ARENA_RIM)
    const up = skyIrradiance(even, UP, 0, ARENA_RIM)
    assert.isBelow(side, radiance / 2)
    assert.isBelow(side / (radiance / 2), up / radiance)
  })
})
