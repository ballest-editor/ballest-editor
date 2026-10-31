// apps/desktop/resources/icon.svg → the icons electron-builder wants: `icon.ico` for Windows (exe, installer,
// shortcuts) and `icons/<n>x<n>.png` for Linux (the AppImage's desktop entry).
import { Resvg } from "@resvg/resvg-js"
import { Effect, FileSystem, Path } from "effect"

export const linuxSizes = [16, 32, 48, 64, 128, 256, 512] as const
export const windowsSizes = [16, 24, 32, 48, 64, 128, 256] as const

export interface Bitmap {
  readonly size: number
  /** RGBA, top row first. */
  readonly rgba: Uint8Array
  readonly png: Uint8Array
}

export const renderIcon = (svg: string, size: number): Bitmap => {
  const image = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render()
  return { size, rgba: new Uint8Array(image.pixels), png: new Uint8Array(image.asPng()) }
}

/**
 * A 32-bit DIB as an ICO entry stores it: BITMAPINFOHEADER with the height doubled (colour rows, then the AND
 * mask), BGRA rows bottom-up, and an all-zero mask since the alpha channel already says what's transparent.
 */
const dib = ({ rgba, size }: Bitmap): Uint8Array => {
  const maskRow = Math.ceil(size / 32) * 4
  const out = new Uint8Array(40 + size * size * 4 + maskRow * size)
  const view = new DataView(out.buffer)
  view.setUint32(0, 40, true)
  view.setInt32(4, size, true)
  view.setInt32(8, size * 2, true)
  view.setUint16(12, 1, true)
  view.setUint16(14, 32, true)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = ((size - 1 - y) * size + x) * 4
      const to = 40 + (y * size + x) * 4
      out[to] = rgba[from + 2] ?? 0
      out[to + 1] = rgba[from + 1] ?? 0
      out[to + 2] = rgba[from] ?? 0
      out[to + 3] = rgba[from + 3] ?? 0
    }
  }
  return out
}

/** An ICO with every bitmap: 256 px as PNG (the format Windows expects at that size), smaller ones as DIBs. */
export const ico = (bitmaps: ReadonlyArray<Bitmap>): Uint8Array => {
  const images = bitmaps.map((bitmap) => bitmap.size >= 256 ? bitmap.png : dib(bitmap))
  const header = 6 + 16 * bitmaps.length
  const out = new Uint8Array(header + images.reduce((total, image) => total + image.byteLength, 0))
  const view = new DataView(out.buffer)
  view.setUint16(2, 1, true)
  view.setUint16(4, bitmaps.length, true)
  let offset = header
  bitmaps.forEach(({ size }, index) => {
    const image = images[index] ?? new Uint8Array()
    const entry = 6 + 16 * index
    // 0 means 256 in the one-byte width and height.
    out[entry] = size >= 256 ? 0 : size
    out[entry + 1] = size >= 256 ? 0 : size
    view.setUint16(entry + 4, 1, true)
    view.setUint16(entry + 6, 32, true)
    view.setUint32(entry + 8, image.byteLength, true)
    view.setUint32(entry + 12, offset, true)
    out.set(image, offset)
    offset += image.byteLength
  })
  return out
}

/** Writes `icon.ico` and `icons/<n>x<n>.png` into `directory`. */
export const writeIcons = Effect.fn("writeIcons")(function*(svgFile: string, directory: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const svg = yield* fs.readFileString(svgFile)
  yield* fs.makeDirectory(path.join(directory, "icons"), { recursive: true })
  for (const size of linuxSizes) {
    yield* fs.writeFile(path.join(directory, "icons", `${size}x${size}.png`), renderIcon(svg, size).png)
  }
  yield* fs.writeFile(path.join(directory, "icon.ico"), ico(windowsSizes.map((size) => renderIcon(svg, size))))
})
