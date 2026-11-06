/** Enough PNG to compare two captures: 8-bit RGB or RGBA, not interlaced, which is what Chromium writes. */
import { inflateSync } from "node:zlib"

export interface Pixels {
  readonly width: number
  readonly height: number
  readonly channels: number
  readonly data: Uint8Array
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export const decodePng = (file: Buffer): Pixels => {
  const width = file.readUInt32BE(16)
  const height = file.readUInt32BE(20)
  const depth = file[24]
  const colour = file[25]
  if (depth !== 8 || (colour !== 2 && colour !== 6) || file[28] !== 0) throw new Error("not an 8-bit RGB(A) PNG")
  const channels = colour === 6 ? 4 : 3
  const chunks: Array<Buffer> = []
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at)
    if (file.toString("latin1", at + 4, at + 8) === "IDAT") chunks.push(file.subarray(at + 8, at + 8 + length))
    at += length + 12
  }
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const data = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const row = y * (stride + 1) + 1
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? data[y * stride + x - channels] ?? 0 : 0
      const up = y > 0 ? data[(y - 1) * stride + x] ?? 0 : 0
      const corner = x >= channels && y > 0 ? data[(y - 1) * stride + x - channels] ?? 0 : 0
      const predicted = filter === 1
        ? left
        : filter === 2
        ? up
        : filter === 3
        ? (left + up) >> 1
        : filter === 4
        ? paeth(left, up, corner)
        : 0
      data[y * stride + x] = ((raw[row + x] ?? 0) + predicted) & 255
    }
  }
  return { width, height, channels, data }
}

/**
 * How far a channel may move and still be the same picture. Identical runs were measured moving by up to 2 of 255, on a
 * few pixels (software WebGL and text rasterising); anything a person could see moves far more.
 */
const CHANNEL_TOLERANCE = 4

/** The share of pixels that differ, in percent. A change of size counts as all of them. */
export const differingPercent = (a: Pixels, b: Pixels): number => {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) return 100
  let differing = 0
  const total = a.width * a.height
  for (let i = 0; i < total; i++) {
    for (let c = 0; c < a.channels; c++) {
      const at = i * a.channels + c
      if (Math.abs((a.data[at] ?? 0) - (b.data[at] ?? 0)) > CHANNEL_TOLERANCE) {
        differing++
        break
      }
    }
  }
  return Number(((100 * differing) / total).toFixed(3))
}

/** Whether two PNG files show the same picture, within the tolerance. */
export const samePicture = (a: Buffer, b: Buffer): boolean =>
  a.equals(b) || differingPercent(decodePng(a), decodePng(b)) === 0
