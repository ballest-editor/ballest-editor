import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Context, Effect, FileSystem, Layer, Path } from "effect"
import { HttpServer } from "effect/http"
import { mockUpdateServerLayer } from "./mockUpdateServer.ts"

describe("mock update server", () => {
  it.effect("serves the directory's files and nothing outside it", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fs.makeTempDirectoryScoped()
      const directory = path.join(root, "release-mock")
      yield* fs.makeDirectory(directory)
      yield* fs.writeFileString(path.join(directory, "latest-linux.yml"), "version: 0.2.1\n")
      yield* fs.writeFileString(path.join(root, "secret.txt"), "no")

      // Port 0: the OS picks a free one. Built into this test's scope, so it listens until the test ends.
      const services = yield* Layer.build(mockUpdateServerLayer({ directory, port: 0 }))
      const { address } = Context.get(services, HttpServer.HttpServer)
      assert.strictEqual(address._tag, "InetAddressV4")
      const base = address._tag === "InetAddressV4" ? `http://127.0.0.1:${address.port}` : ""

      const get = (file: string) =>
        Effect.promise(() => fetch(`${base}${file}`).then(async (r) => [r.status, await r.text()]))
      assert.deepStrictEqual(yield* get("/latest-linux.yml"), [200, "version: 0.2.1\n"])
      assert.strictEqual((yield* get("/missing.yml"))[0], 404)
      assert.strictEqual((yield* get("/%2e%2e/secret.txt"))[0], 404)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
