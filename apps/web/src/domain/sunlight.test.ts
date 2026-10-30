import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { setLighting } from "./edits"
import { newMapFile } from "./factory"
import { DEFAULT_LIGHT_ANGLE, lightingOf, skyLightIntensity, sunOf, sunPitch } from "./sunlight"

const EPSILON = 1e-4

const map = newMapFile({ displayName: "A", creatorName: "B", createdAt: "" })

describe("sunlight", () => {
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

  it("crosses the sky along the light's yaw", () => {
    const morning = sunOf({ timeOfDay: 9, brightness: 12, angle: 90 }).toSun
    const evening = sunOf({ timeOfDay: 15, brightness: 12, angle: 90 }).toSun
    assert.closeTo(morning.x, 0, EPSILON)
    assert.closeTo(morning.y, -Math.SQRT1_2, EPSILON) // yaw 90 points the light along +Y; the morning sun is behind it
    assert.closeTo(evening.y, Math.SQRT1_2, EPSILON)
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
