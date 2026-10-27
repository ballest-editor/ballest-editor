import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { Catalog, indexCatalog } from "../domain/Catalog"
import fixture from "../test/fixtures/catalog.json"
import { glbUrlsForPiece, preloadGlb, warmCatalog } from "./preload"

const catalog = Schema.decodeUnknownSync(Catalog)(fixture)

describe("glb preloading", () => {
  it("lists a piece's main and visible extra meshes", () => {
    const index = indexCatalog(catalog)
    const track = catalog.pieces.find((p) => p.className === "BP_Track_Short1")!
    expect(glbUrlsForPiece(track, index)).toEqual(["/assets/pieces/Maps/_GENERATED/PC/SM_500.glb"])
  })

  it("requests each url once, and warms the catalog a few urls per idle tick", () => {
    const seen: Array<string> = []
    preloadGlb("/assets/x.glb", (u) => seen.push(u))
    preloadGlb("/assets/x.glb", (u) => seen.push(u))
    expect(seen).toEqual(["/assets/x.glb"])

    const ticks: Array<() => void> = []
    const warmed: Array<string> = []
    warmCatalog(catalog, indexCatalog(catalog), { perTick: 1, idle: (run) => ticks.push(run), preload: (u) => warmed.push(u) })
    expect(warmed).toEqual([]) // nothing happens until the browser is idle
    while (ticks.length > 0) {
      ticks.shift()!()
      expect(warmed.length).toBeLessThanOrEqual(3)
    }
    expect(new Set(warmed).size).toBe(warmed.length)
    expect(warmed.length).toBeGreaterThan(0)
  })
})
