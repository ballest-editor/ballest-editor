import { Context, Effect, Layer } from "effect"
import { type Catalog, decodeCatalog, decodeVerification, NO_VERIFICATION, type VerificationTable } from "../domain/Catalog"
import fixtureJson from "../test/fixtures/catalog.json"
import { CatalogLoadError } from "./errors"
import { browserFetch, type FetchText, fetchJson } from "./fetchJson"

export type { FetchText } from "./fetchJson"

export interface LoadedCatalog {
  readonly catalog: Catalog
  readonly source: "assets" | "fixture"
  /** In-game load results for hidden pieces (assets/verified.json); empty when missing. */
  readonly verified: VerificationTable
  /** Set when we fell back to the bundled fixture. */
  readonly warning?: string
}

export const CATALOG_URL = "/assets/catalog.json"
export const VERIFIED_URL = "/assets/verified.json"

export class CatalogLoader extends Context.Service<CatalogLoader, {
  /** Fetch and decode `assets/catalog.json`. */
  readonly fetch: Effect.Effect<Catalog, CatalogLoadError>
  /** `fetch`, falling back to the bundled 3-piece fixture (with a warning) if that fails. */
  readonly load: Effect.Effect<LoadedCatalog>
}>()("ballest/services/CatalogLoader") {
  static readonly make = (fetchText: FetchText, url: string = CATALOG_URL) => {
    const fail = (message: string) => new CatalogLoadError({ url, message })

    const fetchCatalog = fetchJson(fetchText, url, fail).pipe(
      Effect.flatMap((json) => decodeCatalog(json).pipe(Effect.mapError((error) => fail(error.message)))),
      Effect.withSpan("CatalogLoader.fetch")
    )

    const fixture = decodeCatalog(fixtureJson).pipe(Effect.orDie)

    // Optional: a missing or malformed verified.json just means "nothing verified".
    const verifiedUrl = url.replace(/[^/]+$/, VERIFIED_URL.slice(VERIFIED_URL.lastIndexOf("/") + 1))
    const fetchVerified = fetchJson(fetchText, verifiedUrl, (message) => new CatalogLoadError({ url: verifiedUrl, message })).pipe(
      Effect.flatMap(decodeVerification),
      Effect.map((file) => file.results),
      Effect.catch((error) => Effect.logWarning(`No in-game verification table: ${error.message}`).pipe(Effect.as(NO_VERIFICATION)))
    )

    const load = Effect.gen(function*() {
      const verified = yield* fetchVerified
      return yield* fetchCatalog.pipe(
        Effect.map((catalog): LoadedCatalog => ({ catalog, source: "assets", verified })),
        Effect.catchTag("CatalogLoadError", (error) =>
          Effect.gen(function*() {
            yield* Effect.logWarning(`Falling back to fixture catalog: ${error.message}`)
            const catalog = yield* fixture
            return {
              catalog,
              source: "fixture",
              verified,
              warning: `Couldn't load ${url} (${error.message}). Using the 3-piece development fixture.`
            } satisfies LoadedCatalog
          })
        )
      )
    })

    return CatalogLoader.of({ fetch: fetchCatalog, load })
  }

  static readonly layer = Layer.sync(CatalogLoader, () => CatalogLoader.make(browserFetch))
}
