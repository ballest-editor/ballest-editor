import { deflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { decodePng, differingPercent } from "./png.ts"

const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)])
}

const png = (width: number, height: number, rows: ReadonlyArray<ReadonlyArray<number>>) => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from(rows.flat()))),
    chunk("IEND", Buffer.alloc(0))
  ])
}

describe("decodePng", () => {
  it("undoes the sub and up filters", () => {
    const { data, height, width } = decodePng(png(2, 2, [[1, 10, 20, 30, 1, 1, 1], [2, 1, 1, 1, 0, 0, 0]]))
    expect([width, height]).toEqual([2, 2])
    expect([...data]).toEqual([10, 20, 30, 11, 21, 31, 11, 21, 31, 11, 21, 31])
  })
})

describe("differingPercent", () => {
  const image = (first: number) => decodePng(png(2, 1, [[0, first, 0, 0, 5, 5, 5]]))

  it("counts the pixels that differ", () => {
    expect(differingPercent(image(1), image(1))).toBe(0)
    expect(differingPercent(image(1), image(20))).toBe(50)
  })

  it("lets rasteriser noise through and no more", () => {
    expect(differingPercent(image(1), image(5))).toBe(0)
    expect(differingPercent(image(1), image(6))).toBe(50)
  })

  it("counts a change of size as everything", () => {
    expect(differingPercent(image(1), decodePng(png(1, 1, [[0, 1, 0, 0]])))).toBe(100)
  })
})
