import { Context, Effect, Layer } from "effect"
import { emptyMaterialTable, type MaterialTable, parseMaterialsFile } from "../domain/Materials"
import type { FetchText } from "./CatalogLoader"
import { MaterialLibraryLoadError } from "./errors"

export const MATERIALS_URL = "/assets/materials.json"

/** Approximate PBR parameters for game materials (assets/materials.json). */
export class MaterialLibrary extends Context.Service<MaterialLibrary, {
  readonly fetch: Effect.Effect<MaterialTable, MaterialLibraryLoadError>
  /** Never fails: a missing or invalid file gives an empty table (everything renders neutral grey). */
  readonly load: Effect.Effect<MaterialTable>
}>()("ballest/services/MaterialLibrary") {
  static readonly make = (fetchText: FetchText, url: string = MATERIALS_URL) => {
    const fail = (message: string) => new MaterialLibraryLoadError({ url, message })
    const fetchTable = Effect.gen(function*() {
      const response = yield* Effect.tryPromise({ try: () => fetchText(url), catch: (c) => fail(String(c)) })
      if (!response.ok) return yield* fail(`HTTP ${response.status}`)
      const text = yield* Effect.tryPromise({ try: () => response.text(), catch: (c) => fail(String(c)) })
      const json = yield* Effect.try({ try: () => JSON.parse(text) as unknown, catch: () => fail("not JSON (materials.json missing?)") })
      const table = parseMaterialsFile(json)
      if (table.skipped > 0) yield* Effect.logWarning(`materials.json: skipped ${table.skipped} entries that didn't decode`)
      return table
    }).pipe(Effect.withSpan("MaterialLibrary.fetch"))

    const load = fetchTable.pipe(
      Effect.catchTag("MaterialLibraryLoadError", (error) =>
        Effect.logWarning(`Materials unavailable (${error.message}); rendering neutral grey`).pipe(
          Effect.as<MaterialTable>(emptyMaterialTable())
        ))
    )
    return MaterialLibrary.of({ fetch: fetchTable, load })
  }

  static readonly layer = Layer.sync(MaterialLibrary, () => MaterialLibrary.make((url) => globalThis.fetch(url)))
}
