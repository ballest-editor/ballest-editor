// `release mock-server` (`pnpm release:mock-server`): serves a directory of release artifacts on localhost, the feed
// a `--mock-updates` build (or any installed build run with BALLEST_MOCK_UPDATES=1) checks instead of GitHub.
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Path } from "effect"
import { HttpRouter, HttpStaticServer } from "effect/http"
import { createServer } from "node:http"
import { platforms, updateManifestName } from "./config.ts"

/** A static file server on `directory`: GET only, nothing outside it. Provides the server, for its address. */
export const mockUpdateServerLayer = (options: { readonly directory: string; readonly port: number }) =>
  HttpRouter.serve(HttpStaticServer.layer({ root: options.directory })).pipe(
    Layer.provideMerge(NodeHttpServer.layer(createServer, { host: "127.0.0.1", port: options.port }))
  )

export const serveMockUpdates = Effect.fn("serveMockUpdates")(function*(options: {
  readonly directory: string
  readonly port: number
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const manifests = yield* Effect.filter(
    platforms.map(updateManifestName),
    (name) => fs.exists(path.join(options.directory, name))
  )
  if (manifests.length === 0) {
    yield* Effect.logWarning(
      `${options.directory} has no update manifest yet: build into it with \`pnpm dist:desktop:<platform> --mock-updates\``
    )
  }
  yield* Effect.logInfo(`Serving ${options.directory} on http://127.0.0.1:${options.port}/ (${manifests.join(", ")})`)
  return yield* Layer.launch(mockUpdateServerLayer(options))
})
