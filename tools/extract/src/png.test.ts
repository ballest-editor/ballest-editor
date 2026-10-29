import { assert, describe, it } from "@effect/vitest"
import { deflateSync } from "node:zlib"
import { pngMean } from "./png.ts"

// A 2x2 RGB PNG: red, green / blue, white, with a "Sub" filter on the second row.
const crc = (bytes: Uint8Array): number => {
  let c = ~0
  for (const b of bytes) {
    c ^= b
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  out.set(Buffer.from(type, "ascii"), 4)
  out.set(data, 8)
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
  return out
}
const png = (): Uint8Array => {
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, 2)
  v.setUint32(4, 2)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const rows = Uint8Array.from([0, 255, 0, 0, 0, 255, 0, 1, 0, 0, 255, 255, 255, 0])
  return Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", Uint8Array.from(deflateSync(Buffer.from(rows)))),
    ...chunk("IEND", new Uint8Array())
  ])
}

describe("png", () => {
  it("averages the decoded pixels, in linear space for sRGB textures", () => {
    const linear = pngMean(png(), false)
    assert.deepStrictEqual(linear?.mean, [0.5, 0.5, 0.5, 1])
    const srgb = pngMean(png(), true)
    assert.closeTo(srgb?.mean[0] ?? 0, 0.5, 1e-9) // 1 and 0 are fixed points of the sRGB curve
    assert.isNull(pngMean(Uint8Array.from([1, 2, 3]), true))
  })
})
