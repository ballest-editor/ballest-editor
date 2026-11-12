import { describe, expect, it } from "vitest"
import { angleOf, DEFAULT_SITE_ANGLE, framingOf } from "./siteAngle"

const centre = [120, 40, -300] as const
const radius = 250

describe("the site's angle", () => {
  it("reads back the angle a camera was framed with", () => {
    const angle = { from: [0.6, 0.48, -0.64], zoom: 1.7, pan: [0.1, 0, -0.25] } as const
    const { position, target } = framingOf(angle, [...centre], radius, 1)
    expect(angleOf(position, target, [...centre], radius, 1)).toEqual(angle)
  })

  it("frames the default view three-quarters from above, at the distance that just fits", () => {
    const { position, target } = framingOf(DEFAULT_SITE_ANGLE, [...centre], radius, 1)
    expect(target).toEqual([...centre])
    expect(position[1]).toBeGreaterThan(centre[1])
    const read = angleOf(position, target, [...centre], radius, 1)
    expect(read.zoom).toBe(1)
  })

  it("clamps a view past the site's limits to the nearest it takes", () => {
    const read = angleOf([1e7, 0, 0], [centre[0] + radius * 50, centre[1], centre[2]], [...centre], radius, 1)
    expect(read.zoom).toBe(20)
    expect(read.pan).toEqual([10, 0, 0])
  })
})
