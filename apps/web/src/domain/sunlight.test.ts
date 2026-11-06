import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { setLighting } from "./edits"
import { newMapFile } from "./factory"
import {
  DEFAULT_LIGHT_ANGLE,
  formatTimeOfDay,
  lightingOf,
  parseTimeOfDay,
  skyLightIntensity,
  sunOf,
  sunPitch,
  viewLightOf
} from "./sunlight"

const EPSILON = 1e-4

const map = newMapFile({ displayName: "A", creatorName: "B", createdAt: "" })

describe("sunlight", () => {
  it("shows a time of day as a clock and reads one back", () => {
    assert.strictEqual(formatTimeOfDay(7.5), "07:30")
    assert.strictEqual(formatTimeOfDay(7.2997), "07:18")
    assert.strictEqual(formatTimeOfDay(23.999), "24:00")
    assert.strictEqual(formatTimeOfDay(0), "00:00")
    assert.strictEqual(formatTimeOfDay(-1.5), "-01:30")
    assert.strictEqual(parseTimeOfDay("7:30"), 7.5)
    assert.strictEqual(parseTimeOfDay(" 18:15 "), 18.25)
    assert.strictEqual(parseTimeOfDay("7.5"), 7.5)
    assert.isNull(parseTimeOfDay("7:75"))
    assert.isNull(parseTimeOfDay(""))
    assert.isNull(parseTimeOfDay("noon"))
  })

  it("puts the sun where the editor map's light is for the default time", () => {
    // Map_LevelEditorMain's light: pitch -19.495638, yaw -20.647455, for timeOfDay 7.2997093
    assert.closeTo(sunPitch(lightingOf(map.worldSettings).timeOfDay), -19.495638, EPSILON)
    const sun = sunOf(lightingOf(map.worldSettings))
    assert.closeTo(sun.elevation, 19.495638, EPSILON)
    // the sun is behind the light's forward vector, so its yaw is the light's plus 180
    assert.closeTo(Math.atan2(sun.toSun.y, sun.toSun.x) * (180 / Math.PI), -20.647455 + 180, EPSILON)
  })

  it("rises at 6, peaks at noon, sets at 18 and is straight below at midnight", () => {
    const elevation = (timeOfDay: number) => sunOf({ timeOfDay, brightness: 12, angle: 0 }).elevation
    assert.closeTo(elevation(6), 0, EPSILON)
    assert.closeTo(elevation(12), 90, EPSILON)
    assert.closeTo(elevation(18), 0, EPSILON)
    assert.closeTo(elevation(0), -90, EPSILON)
    assert.closeTo(elevation(24), -90, EPSILON)
    assert.closeTo(elevation(21), -45, EPSILON)
  })

  // The light's forward vector in a race (Map_TrackUGCPlayback, GetActorForwardVector) for maps at yaw 37, read through
  // the driver: docs/qa/save-roundtrip.md. The sun is behind it.
  it.each([
    [3, 0.565, 0.426, Math.SQRT1_2],
    [5, 0.771, 0.581, 0.259],
    [8, 0.692, 0.521, -0.5],
    [11, 0.207, 0.156, -0.966],
    [13, 0.207, 0.156, -0.966],
    [15, 0.565, 0.426, -Math.SQRT1_2],
    [17, 0.771, 0.581, -0.259],
    [19, 0.771, 0.581, 0.259],
    [22, 0.399, 0.301, 0.866]
  ])("puts the sun where a race has it at %d:00", (timeOfDay, x, y, z) => {
    const { toSun } = sunOf({ timeOfDay, brightness: 12, angle: 37 })
    assert.closeTo(-toSun.x, x, 1e-3)
    assert.closeTo(-toSun.y, y, 1e-3)
    assert.closeTo(-toSun.z, z, 1e-3)
  })

  it("stays on the side it rose on: the afternoon mirrors the morning", () => {
    const morning = sunOf({ timeOfDay: 9, brightness: 12, angle: 90 }).toSun
    const afternoon = sunOf({ timeOfDay: 15, brightness: 12, angle: 90 }).toSun
    assert.closeTo(morning.x, 0, EPSILON)
    assert.closeTo(morning.y, -Math.SQRT1_2, EPSILON) // yaw 90 points the light along +Y; the sun is behind it
    assert.closeTo(afternoon.y, morning.y, EPSILON)
    assert.closeTo(afternoon.z, morning.z, EPSILON)
  })

  it("shows a warm low sun, and a weaker one at noon", () => {
    const light = (timeOfDay: number, brightness = 12) => viewLightOf(sunOf({ timeOfDay, brightness, angle: 0 }))
    const low = light(7.3), noon = light(12)
    assert.isAbove(low.sun[0], low.sun[2] * 2)
    assert.isBelow(noon.sun[0], low.sun[0])
    assert.closeTo(light(7.3, 6).sun[0], low.sun[0] / 2, EPSILON) // the sun follows the brightness slider
    assert.deepStrictEqual(light(0).sun, [0, 0, 0]) // night: the sun is gone
  })

  it("dims the sun towards the horizon and hides it below", () => {
    const at = (timeOfDay: number) => sunOf({ timeOfDay, brightness: 8, angle: 0 })
    assert.strictEqual(at(12).intensity, 8)
    assert.strictEqual(at(3).intensity, 0)
    assert.isTrue(at(6).intensity > 0 && at(6).intensity < 8)
    const [r, g, b] = at(6.2).color
    assert.isTrue(r > g && g > b, "a low sun is warm")
  })

  it("sets the sky light from the time of day like the game: 3 at noon, 1 at midnight", () => {
    assert.closeTo(skyLightIntensity(12), 3, EPSILON)
    assert.closeTo(skyLightIntensity(0), 1, EPSILON)
    assert.closeTo(skyLightIntensity(24), 1, EPSILON)
    assert.closeTo(skyLightIntensity(6), 2, EPSILON)
    assert.closeTo(skyLightIntensity(18), 2, EPSILON)
    assert.closeTo(skyLightIntensity(6, 0), 1.5, EPSILON)
    assert.closeTo(skyLightIntensity(1, 0), 1, EPSILON) // clamped to at least 1
  })

  it("edits the lighting in worldSettings and rejects non-finite values", () => {
    const next = Option.getOrThrow(setLighting(map, { timeOfDay: 15, brightness: 4, angle: 90 }))
    assert.deepStrictEqual(next.worldSettings.directionalLight, { timeOfDay: 15, brightness: 4 })
    assert.strictEqual(next.worldSettings.directionalLightAngle, 90)
    assert.strictEqual(next.items, map.items)
    assert.isTrue(Option.isNone(setLighting(map, { timeOfDay: Number.NaN, brightness: 4, angle: 0 })))
  })

  it("only adds directionalLightAngle to an older file when the yaw changes", () => {
    const { directionalLightAngle: _, ...world } = map.worldSettings
    const old = { ...map, worldSettings: world }
    assert.strictEqual(lightingOf(old.worldSettings).angle, DEFAULT_LIGHT_ANGLE)
    const sameYaw = Option.getOrThrow(setLighting(old, { timeOfDay: 9, brightness: 12, angle: DEFAULT_LIGHT_ANGLE }))
    assert.isFalse("directionalLightAngle" in sameYaw.worldSettings)
    const turned = Option.getOrThrow(setLighting(old, { timeOfDay: 9, brightness: 12, angle: 10 }))
    assert.strictEqual(turned.worldSettings.directionalLightAngle, 10)
  })
})
