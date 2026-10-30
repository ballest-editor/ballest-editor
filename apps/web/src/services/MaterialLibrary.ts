import { Context, Effect, Layer } from "effect"
import { emptyMaterialTable, type MaterialTable, parseMaterialsFile } from "../domain/Materials"
import { type PaintPicker, parsePaint } from "../domain/Paint"
import { MaterialLibraryLoadError } from "./errors"
import { browserFetch, fetchJson, type FetchText } from "./fetchJson"

export const MATERIALS_URL = "/assets/materials.json"

export interface LoadedMaterials {
  readonly table: MaterialTable
  /** The in-game material picker; empty when the file has none. */
  readonly paint: PaintPicker
}

/** Approximate PBR parameters for game materials, and the game's material picker (assets/materials.json). */
export class MaterialLibrary extends Context.Service<MaterialLibrary, {
  readonly fetch: Effect.Effect<LoadedMaterials, MaterialLibraryLoadError>
  /** Never fails: a missing or invalid file gives an empty table (everything renders neutral grey) and no picker. */
  readonly load: Effect.Effect<LoadedMaterials>
}>()("ballest/services/MaterialLibrary") {
  static readonly make = (fetchText: FetchText, url: string = MATERIALS_URL) => {
    const fail = (message: string) => new MaterialLibraryLoadError({ url, message })
    const fetchTable = Effect.gen(function*() {
      const json = yield* fetchJson(fetchText, url, fail)
      const table = parseMaterialsFile(json)
      if (table.skipped > 0) {
        yield* Effect.logWarning(`materials.json: skipped ${table.skipped} entries that didn't decode`)
      }
      return { table, paint: parsePaint(json) }
    }).pipe(Effect.withSpan("MaterialLibrary.fetch"))

    const load = fetchTable.pipe(
      Effect.catchTag(
        "MaterialLibraryLoadError",
        (error) =>
          Effect.logWarning(`Materials unavailable (${error.message}); rendering neutral grey`).pipe(
            Effect.as<LoadedMaterials>({ table: emptyMaterialTable(), paint: [] })
          )
      )
    )
    return MaterialLibrary.of({ fetch: fetchTable, load })
  }

  static readonly layer = Layer.sync(MaterialLibrary, () => MaterialLibrary.make(browserFetch))
}
