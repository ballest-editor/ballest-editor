import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { serveStatic, type StaticSite } from "./serveStatic"

/** A renderer build in `web/` and a separate asset tree in `assets/`, as a packaged app lays them out. */
const makeSite = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.makeTempDirectoryScoped()
  const web = path.join(root, "web")
  const assets = path.join(root, "assets")
  yield* fs.makeDirectory(path.join(web, "assets"), { recursive: true })
  yield* fs.makeDirectory(path.join(assets, "pieces"), { recursive: true })
  yield* fs.writeFileString(path.join(web, "index.html"), "<!doctype html>")
  yield* fs.writeFileString(path.join(web, "assets", "index-abc.js"), "console.log(1)")
  yield* fs.writeFileString(path.join(assets, "catalog.json"), "{}")
  yield* fs.writeFileString(path.join(assets, "pieces", "a b.glb"), "glb")
  yield* fs.writeFileString(path.join(root, "secret.txt"), "secret")
  const site: StaticSite = {
    mounts: [{ prefix: "/", directory: web }, { prefix: "/assets/", directory: assets }],
    fallback: path.join(web, "index.html")
  }
  return site
})

const get = (site: StaticSite, pathname: string, init?: RequestInit) =>
  serveStatic(new Request(`ballest://app${pathname}`, init), pathname, site).pipe(
    Effect.flatMap((response) =>
      Effect.promise(async () => ({
        status: response.status,
        type: response.headers.get("content-type"),
        body: await response.text()
      }))
    )
  )

describe("serveStatic", () => {
  it.effect("serves files from the mounts in order, with a MIME type", () =>
    Effect.gen(function*() {
      const site = yield* makeSite
      assert.deepStrictEqual(yield* get(site, "/assets/index-abc.js"), {
        status: 200,
        type: "text/javascript",
        body: "console.log(1)"
      })
      assert.deepStrictEqual(yield* get(site, "/assets/catalog.json"), {
        status: 200,
        type: "application/json",
        body: "{}"
      })
      assert.deepInclude(yield* get(site, "/assets/pieces/a%20b.glb"), { status: 200, type: "model/gltf-binary" })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("falls back to index.html for page navigations only", () =>
    Effect.gen(function*() {
      const site = yield* makeSite
      assert.deepInclude(yield* get(site, "/"), { status: 200, type: "text/html", body: "<!doctype html>" })
      assert.deepInclude(yield* get(site, "/editor/settings"), { status: 200, body: "<!doctype html>" })
      assert.deepInclude(yield* get(site, "/x.html", { headers: { accept: "text/html" } }), { status: 200 })
      assert.deepInclude(yield* get(site, "/assets/missing.glb"), { status: 404 })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("refuses paths that escape their mount", () =>
    Effect.gen(function*() {
      const site = yield* makeSite
      for (const escape of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2F..%2Fsecret.txt"]) {
        assert.notStrictEqual((yield* get(site, escape)).body, "secret")
      }
      assert.deepInclude(yield* get(site, "/%E0%A4%A"), { status: 400 })
      assert.deepInclude(yield* get(site, "/a%00.js"), { status: 400 })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("answers HEAD without a body and refuses other methods", () =>
    Effect.gen(function*() {
      const site = yield* makeSite
      assert.deepStrictEqual(yield* get(site, "/assets/catalog.json", { method: "HEAD" }), {
        status: 200,
        type: "application/json",
        body: ""
      })
      assert.deepInclude(yield* get(site, "/assets/catalog.json", { method: "POST", body: "x" }), { status: 405 })
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
