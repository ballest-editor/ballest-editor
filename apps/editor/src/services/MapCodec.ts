import { Context, Effect, Layer, Schema } from "effect"
import { MapFile } from "../domain/MapFile"
import { stringifyUe } from "../domain/ueJson"
import { MapDecodeError, MapEncodeError } from "./errors"

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(MapFile))
const encodeObject = Schema.encodeEffect(MapFile)

/** Text <-> MapFile. Encoding writes the game's own layout (tabs, CRLF, Allman braces, %.17g). */
export class MapCodec extends Context.Service<MapCodec, {
  decode(text: string): Effect.Effect<MapFile, MapDecodeError>
  encode(map: MapFile): Effect.Effect<string, MapEncodeError>
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
      })
    })
  )
}
