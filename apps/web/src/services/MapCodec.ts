import { Context, Effect, Layer, Schema } from "effect"
import { MapFile } from "../domain/MapFile"
import { MapSidecar } from "../domain/MapSidecar"
import { stringifyUe } from "../domain/ueJson"
import { MapDecodeError, MapEncodeError, SidecarDecodeError } from "./errors"

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(MapFile))
const encodeObject = Schema.encodeEffect(MapFile)
const decodeSidecarJson = Schema.decodeUnknownEffect(Schema.fromJsonString(MapSidecar))
const encodeSidecarObject = Schema.encodeEffect(MapSidecar)

/**
 * Text <-> MapFile, and text <-> a map's sidecar. A map is encoded in the game's own layout (tabs, CRLF, Allman braces,
 * %.17g), a sidecar as indented JSON like the project's other files.
 */
export class MapCodec extends Context.Service<MapCodec, {
  decode(text: string): Effect.Effect<MapFile, MapDecodeError>
  encode(map: MapFile): Effect.Effect<string, MapEncodeError>
  decodeSidecar(text: string): Effect.Effect<MapSidecar, SidecarDecodeError>
  encodeSidecar(sidecar: MapSidecar): Effect.Effect<string, MapEncodeError>
}>()("ballest/services/MapCodec") {
  static readonly layer = Layer.succeed(
    MapCodec,
    MapCodec.of({
      decode: Effect.fn("MapCodec.decode")(function*(text: string) {
        // UE writes no BOM, but tolerate one from other tools.
        const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
        return yield* decodeJson(body).pipe(
          Effect.mapError((error) => new MapDecodeError({ message: error.message }))
        )
      }),
      encode: Effect.fn("MapCodec.encode")(function*(map: MapFile) {
        const encoded = yield* encodeObject(map).pipe(
          Effect.mapError((error) => new MapEncodeError({ message: error.message }))
        )
        return yield* Effect.try({
          try: () => stringifyUe(encoded),
          catch: (cause) => new MapEncodeError({ message: String(cause) })
        })
      }),
      decodeSidecar: Effect.fn("MapCodec.decodeSidecar")(function*(text: string) {
        return yield* decodeSidecarJson(text).pipe(
          Effect.mapError((error) => new SidecarDecodeError({ message: error.message }))
        )
      }),
      encodeSidecar: Effect.fn("MapCodec.encodeSidecar")(function*(sidecar: MapSidecar) {
        const encoded = yield* encodeSidecarObject(sidecar).pipe(
          Effect.mapError((error) => new MapEncodeError({ message: error.message }))
        )
        return `${JSON.stringify(encoded, null, 2)}\n`
      })
    })
  )
}
