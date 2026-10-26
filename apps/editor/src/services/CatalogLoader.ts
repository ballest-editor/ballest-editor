import { Context, Effect, Layer } from "effect"
import { type Catalog, decodeCatalog } from "../domain/Catalog"
import fixtureJson from "../test/fixtures/catalog.json"
import { CatalogLoadError } from "./errors"

export interface LoadedCatalog {
  readonly catalog: Catalog
  readonly source: "assets" | "fixture"
  /** Set when we fell back to the bundled fixture. */
  readonly warning?: string
}

export const CATALOG_URL = "/assets/catalog.json"

export type FetchText = (url: string) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>

export class CatalogLoader extends Context.Service<CatalogLoader, {
  /** Fetch and decode `assets/catalog.json`. */
  readonly fetch: Effect.Effect<Catalog, CatalogLoadError>
  /** `fetch`, falling back to the bundled 3-piece fixture (with a warning) if that fails. */
  readonly load: Effect.Effect<LoadedCatalog>
}>()("ballest/services/CatalogLoader") {
  static readonly make = (fetchText: FetchText, url: string = CATALOG_URL) => {
    const fail = (message: string) => new CatalogLoadError({ url, message })

    const fetchCatalog = Effect.gen(function*() {
      const response = yield* Effect.tryPromise({
        try: () => fetchText(url),
        catch: (cause) => fail(`request failed: ${String(cause)}`)
      })
      if (!response.ok) return yield* fail(`HTTP ${response.status}`)
      const text = yield* Effect.tryPromise({ try: () => response.text(), catch: (cause) => fail(String(cause)) })
      const json = yield* Effect.try({
        // Dev servers answer unknown paths with the HTML shell, so a non-JSON body means "missing".
        try: () => JSON.parse(text) as unknown,
        catch: () => fail("response is not JSON (catalog.json missing?)")
      })
      return yield* decodeCatalog(json).pipe(Effect.mapError((error) => fail(error.message)))
    }).pipe(Effect.withSpan("CatalogLoader.fetch"))

    const fixture = decodeCatalog(fixtureJson).pipe(Effect.orDie)

    const load = fetchCatalog.pipe(
      Effect.map((catalog): LoadedCatalog => ({ catalog, source: "assets" })),
      Effect.catchTag("CatalogLoadError", (error) =>
        Effect.gen(function*() {
          yield* Effect.logWarning(`Falling back to fixture catalog: ${error.message}`)
          const catalog = yield* fixture
          return {
            catalog,
            source: "fixture",
            warning: `Couldn't load ${url} (${error.message}). Using the 3-piece development fixture.`
          } satisfies LoadedCatalog
        })
      )
    )

    return CatalogLoader.of({ fetch: fetchCatalog, load })
  }

  static readonly layer = Layer.sync(CatalogLoader, () => CatalogLoader.make((url) => globalThis.fetch(url)))
}
