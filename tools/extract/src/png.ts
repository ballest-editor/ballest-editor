// Mean colour of a PNG (8/16-bit grey, grey+alpha, RGB, RGBA; no palettes), in linear space when the
// texture holds sRGB data. The shader evaluation reads each texture at its mean, so the base colour it
// derives is the surface's average and each read's contribution is measured around it.
import { inflateSync } from "node:zlib"

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export interface PngMean {
  readonly width: number
  readonly height: number
  /** r, g, b, a in 0..1 */
  readonly mean: readonly [number, number, number, number]
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export const pngMean = (file: Uint8Array, srgb: boolean): PngMean | null => {
  if (SIGNATURE.some((b, i) => file[i] !== b)) return null
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  let at = 8
  let width = 0, height = 0, depth = 8, colorType = 2
  const idat: Array<Uint8Array> = []
  while (at + 8 <= file.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(file[at + 4] ?? 0, file[at + 5] ?? 0, file[at + 6] ?? 0, file[at + 7] ?? 0)
    const data = file.subarray(at + 8, at + 8 + length)
    if (type === "IHDR") {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      depth = file[at + 16] ?? 8
      colorType = file[at + 17] ?? 2
      if ((file[at + 20] ?? 0) !== 0) return null // interlaced
    } else if (type === "IDAT") idat.push(data)
    else if (type === "IEND") break
    at += 12 + length
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (channels === undefined || (depth !== 8 && depth !== 16) || width === 0) return null
  const raw = inflateSync(Buffer.concat(idat.map((d) => Buffer.from(d))))
  const bpp = (channels * depth) / 8
  const stride = width * bpp
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  const sums = [0, 0, 0, 0]
  const max = depth === 8 ? 255 : 65535
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const x = line[i] ?? 0
      const a = i >= bpp ? cur[i - bpp] ?? 0 : 0
      const b = prev[i] ?? 0
      const c = i >= bpp ? prev[i - bpp] ?? 0 : 0
      const v = filter === 0
        ? x
        : filter === 1
        ? x + a
        : filter === 2
        ? x + b
        : filter === 3
        ? x + ((a + b) >> 1)
        : x + paeth(a, b, c)
      cur[i] = v & 0xff
    }
    for (let px = 0; px < width; px++) {
      for (let ch = 0; ch < channels; ch++) {
        const off = px * bpp + ch * (depth / 8)
        const value = depth === 8 ? cur[off] ?? 0 : ((cur[off] ?? 0) << 8) | (cur[off + 1] ?? 0)
        const n = value / max
        const isColor = colorType === 2 || colorType === 6 || ch === 0
        const lin = srgb && isColor && !(colorType === 4 && ch === 1) && !(colorType === 6 && ch === 3)
          ? srgbToLinear(n)
          : n
        sums[ch] = (sums[ch] ?? 0) + lin
      }
    }
    prev.set(cur)
  }
  const count = width * height
  const m = sums.map((s) => s / count)
  const mean: [number, number, number, number] = colorType === 0
    ? [m[0] ?? 0, m[0] ?? 0, m[0] ?? 0, 1]
    : colorType === 4
    ? [m[0] ?? 0, m[0] ?? 0, m[0] ?? 0, m[1] ?? 1]
    : [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, colorType === 6 ? m[3] ?? 1 : 1]
  return { width, height, mean }
}
