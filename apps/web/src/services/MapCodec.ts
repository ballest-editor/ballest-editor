import { Context, Effect, Layer, Schema } from "effect"
import type { CatalogIndex } from "../domain/Catalog"
import { PREFAB_REFUSALS, prefabProblems } from "../domain/gameRules"
import { MapFile } from "../domain/MapFile"
import { MapSidecar } from "../domain/MapSidecar"
import { PrefabFile } from "../domain/PrefabFile"
import { stringifyUe } from "../domain/ueJson"
import { MapDecodeError, MapEncodeError, PrefabDecodeError, PrefabRefusedError, SidecarDecodeError } from "./errors"

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(MapFile))
const encodeObject = Schema.encodeEffect(MapFile)
const decodeSidecarJson = Schema.decodeUnknownEffect(Schema.fromJsonString(MapSidecar))
const encodeSidecarObject = Schema.encodeEffect(MapSidecar)
const decodePrefabJson = Schema.decodeUnknownEffect(Schema.fromJsonString(PrefabFile))
const encodePrefabObject = Schema.encodeEffect(PrefabFile)

/** UE writes no BOM, but tolerate one from other tools. */
const withoutBom = (text: string) => text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

/** What `encoded` gives, as `layout` writes it. */
const written = <E extends { readonly message: string }>(
  encoded: Effect.Effect<unknown, E>,
  layout: (value: unknown) => string
) =>
  encoded.pipe(
    Effect.mapError((error) => new MapEncodeError({ message: error.message })),
    Effect.flatMap((value) =>
      Effect.try({ try: () => layout(value), catch: (cause) => new MapEncodeError({ message: String(cause) }) })
    )
  )

/** Fails with what the game would say about `prefab`, when it wouldn't spawn it. */
const refusingPrefab = (prefab: PrefabFile, catalog: CatalogIndex | null) => {
  const problems = prefabProblems(prefab, catalog)
  return problems.length === 0 ? Effect.succeed(prefab) : Effect.fail(new PrefabRefusedError({ problems }))
}

/**
 * Text <-> MapFile, text <-> a map's sidecar and text <-> a prefab. A map or prefab is encoded in the game's own layout
 * (tabs, CRLF, Allman braces, %.17g), a sidecar as indented JSON like the project's other files. A prefab the game would
 * refuse fails both ways, so none is placed, opened or written.
 */
export class MapCodec extends Context.Service<MapCodec, {
  decode(text: string): Effect.Effect<MapFile, MapDecodeError>
  encode(map: MapFile): Effect.Effect<string, MapEncodeError>
  decodeSidecar(text: string): Effect.Effect<MapSidecar, SidecarDecodeError>
  encodeSidecar(sidecar: MapSidecar): Effect.Effect<string, MapEncodeError>
  decodePrefab(
    text: string,
    catalog: CatalogIndex | null
  ): Effect.Effect<PrefabFile, PrefabDecodeError | PrefabRefusedError>
  encodePrefab(
    prefab: PrefabFile,
    catalog: CatalogIndex | null
  ): Effect.Effect<string, MapEncodeError | PrefabRefusedError>
}>()("ballest/services/MapCodec") {
  static readonly layer = Layer.succeed(
    MapCodec,
    MapCodec.of({
      decode: Effect.fn("MapCodec.decode")(function*(text: string) {
        return yield* decodeJson(withoutBom(text)).pipe(
          Effect.mapError((error) => new MapDecodeError({ message: error.message }))
        )
      }),
      encode: Effect.fn("MapCodec.encode")(function*(map: MapFile) {
        return yield* written(encodeObject(map), stringifyUe)
      }),
      decodeSidecar: Effect.fn("MapCodec.decodeSidecar")(function*(text: string) {
        return yield* decodeSidecarJson(text).pipe(
          Effect.mapError((error) => new SidecarDecodeError({ message: error.message }))
        )
      }),
      encodeSidecar: Effect.fn("MapCodec.encodeSidecar")(function*(sidecar: MapSidecar) {
        return yield* written(encodeSidecarObject(sidecar), (value) => `${JSON.stringify(value, null, 2)}\n`)
      }),
      decodePrefab: Effect.fn("MapCodec.decodePrefab")(function*(text: string, catalog: CatalogIndex | null) {
        const prefab = yield* decodePrefabJson(withoutBom(text)).pipe(
          Effect.mapError((error) => new PrefabDecodeError({ message: `${PREFAB_REFUSALS.document} ${error.message}` }))
        )
        return yield* refusingPrefab(prefab, catalog)
      }),
      encodePrefab: Effect.fn("MapCodec.encodePrefab")(function*(prefab: PrefabFile, catalog: CatalogIndex | null) {
        yield* refusingPrefab(prefab, catalog)
        return yield* written(encodePrefabObject(prefab), stringifyUe)
      })
    })
  )
}
