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
const png = (
  width: number,
  height: number,
  depth: number,
  colorType: number,
  rows: ReadonlyArray<number>
): Uint8Array => {
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr.set([depth, colorType, 0, 0, 0], 8)
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
// A 2x2 RGB PNG: red, green / blue, white, with a "Sub" filter on the second row.
const rgb8 = () => png(2, 2, 8, 2, [0, 255, 0, 0, 0, 255, 0, 1, 0, 0, 255, 255, 255, 0])
// A 2x1 16-bit grey PNG: 0x4000 and 0xC000 (big-endian samples), and a 1x1 grey+alpha one at mid grey.
const grey16 = () => png(2, 1, 16, 0, [0, 0x40, 0x00, 0xc0, 0x00])
const greyAlpha16 = () => png(1, 1, 16, 4, [0, 0x80, 0x00, 0xff, 0xff])

describe("png", () => {
  it("averages the decoded pixels, in linear space for sRGB textures", () => {
    const linear = pngMean(rgb8(), false)
    assert.deepStrictEqual(linear?.mean, [0.5, 0.5, 0.5, 1])
    const srgb = pngMean(rgb8(), true)
    assert.closeTo(srgb?.mean[0] ?? 0, 0.5, 1e-9) // 1 and 0 are fixed points of the sRGB curve
    assert.isNull(pngMean(Uint8Array.from([1, 2, 3]), true))
  })

  it("reads 16-bit samples big-endian, grey as r = g = b, and leaves alpha linear", () => {
    const grey = pngMean(grey16(), false)
    assert.deepStrictEqual([grey?.width, grey?.height], [2, 1])
    assert.closeTo(grey?.mean[0] ?? 0, 0.5, 1e-4)
    assert.deepStrictEqual(grey?.mean.slice(0, 3), [grey?.mean[0], grey?.mean[0], grey?.mean[0]])
    assert.strictEqual(grey?.mean[3], 1)
    const ga = pngMean(greyAlpha16(), true)
    assert.closeTo(ga?.mean[0] ?? 0, 0.2140, 1e-3) // mid grey, linearised
    assert.strictEqual(ga?.mean[3], 1) // alpha is not colour
  })
})
