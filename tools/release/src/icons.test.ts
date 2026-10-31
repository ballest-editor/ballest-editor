import { assert, describe, it } from "@effect/vitest"
import { ico, renderIcon, windowsSizes } from "./icons.ts"

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="2" height="4" fill="#ff0000"/></svg>`

describe("ico", () => {
  const bitmaps = windowsSizes.map((size) => renderIcon(svg, size))
  const file = ico(bitmaps)
  const view = new DataView(file.buffer)
  const entry = (index: number) => {
    const at = 6 + 16 * index
    return {
      width: file[at],
      height: file[at + 1],
      bitCount: view.getUint16(at + 6, true),
      bytes: view.getUint32(at + 8, true),
      offset: view.getUint32(at + 12, true)
    }
  }

  it("has a directory entry per size, each pointing at its image", () => {
    assert.strictEqual(view.getUint16(0, true), 0)
    assert.strictEqual(view.getUint16(2, true), 1)
    assert.strictEqual(view.getUint16(4, true), windowsSizes.length)
    let end = 6 + 16 * windowsSizes.length
    windowsSizes.forEach((size, index) => {
      const { bitCount, bytes, height, offset, width } = entry(index)
      assert.strictEqual(width, size === 256 ? 0 : size)
      assert.strictEqual(height, width)
      assert.strictEqual(bitCount, 32)
      assert.strictEqual(offset, end)
      end += bytes
    })
    assert.strictEqual(end, file.byteLength)
  })

  it("stores 256 px as PNG and smaller sizes as bottom-up BGRA bitmaps with a mask", () => {
    const last = entry(windowsSizes.length - 1)
    assert.deepStrictEqual([...file.subarray(last.offset, last.offset + 4)], [0x89, 0x50, 0x4e, 0x47])

    const { bytes, offset } = entry(0)
    const header = new DataView(file.buffer, offset)
    assert.strictEqual(header.getUint32(0, true), 40)
    assert.strictEqual(header.getInt32(4, true), 16)
    assert.strictEqual(header.getInt32(8, true), 32)
    assert.strictEqual(bytes, 40 + 16 * 16 * 4 + 4 * 16)
    // Left half red and opaque, right half transparent; row order doesn't matter for a vertical split.
    const pixel = (x: number) => [...file.subarray(offset + 40 + x * 4, offset + 44 + x * 4)]
    assert.deepStrictEqual(pixel(0), [0, 0, 255, 255])
    assert.deepStrictEqual(pixel(15), [0, 0, 0, 0])
  })
})
