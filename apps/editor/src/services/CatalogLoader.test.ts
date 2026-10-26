import * as fs from "node:fs"
import * as path from "node:path"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { repoRoot } from "../test/samples"
import { CatalogLoader, type FetchText } from "./CatalogLoader"

const respond = (status: number, body: string): FetchText => () =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body) })

describe("CatalogLoader", () => {
  it.effect("falls back to the fixture on 404 or an HTML body", () =>
    Effect.gen(function*() {
      for (const fetchText of [respond(404, ""), respond(200, "<!doctype html>"), () => Promise.reject(new Error("offline"))]) {
        const loaded = yield* CatalogLoader.make(fetchText).load
        assert.strictEqual(loaded.source, "fixture")
        assert.isDefined(loaded.warning)
        assert.strictEqual(loaded.catalog.pieces.length, 3)
      }
    }))

  it.effect("reports a decode error for a malformed catalog", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(CatalogLoader.make(respond(200, "{\"pieces\":[{}]}")).fetch)
      assert.strictEqual(error._tag, "CatalogLoadError")
    }))

  const realCatalog = path.join(repoRoot, "assets", "catalog.json")
  it.effect.skipIf(!fs.existsSync(realCatalog))("decodes assets/catalog.json", () =>
    Effect.gen(function*() {
      const loaded = yield* CatalogLoader.make(respond(200, fs.readFileSync(realCatalog, "utf8"))).load
      assert.strictEqual(loaded.source, "assets")
      assert.isAbove(loaded.catalog.pieces.length, 0)
    }))
})
