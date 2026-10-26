import { Context, DateTime, Effect, Layer } from "effect"
import { currentCreatedAt, defaultEditorState, mapFileNameOf, userLevelNameOf } from "../domain/factory"
import { isPlayerStart, type MapFile, SYSTEM_LEVEL_NAME } from "../domain/MapFile"
import { ExportValidationError, type MapEncodeError } from "./errors"
import { MapCodec } from "./MapCodec"

export interface ExportedMap {
  readonly filename: string
  readonly text: string
  readonly blob: Blob
  /** The map as written (with the export-time level fields applied). */
  readonly map: MapFile
}

/** Characters Windows won't accept in a file name; the game saves under the user's profile on Windows. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what Windows rejects
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/

export class MapExporter extends Context.Service<MapExporter, {
  /** Applies the level-name fields the game expects, validates, and encodes to a `.balledit`. */
  prepare(map: MapFile): Effect.Effect<ExportedMap, ExportValidationError | MapEncodeError>
}>()("ballest/services/MapExporter") {
  static readonly layerNoDeps = Layer.effect(
    MapExporter,
    Effect.gen(function*() {
      const codec = yield* MapCodec
      const timeZone = yield* DateTime.CurrentTimeZone

      const prepare = Effect.fn("MapExporter.prepare")(function*(map: MapFile) {
        const levelData = map.worldSettings.levelData
        const displayName = levelData.levelDisplayName.trim()
        const creatorName = levelData.creatorName.trim()
        if (displayName.length === 0 || creatorName.length === 0) {
          return yield* new ExportValidationError({ message: "Map name and creator are required." })
        }
        if (INVALID_FILENAME_CHARS.test(displayName) || INVALID_FILENAME_CHARS.test(creatorName)) {
          return yield* new ExportValidationError({
            message: "Map name and creator can't contain < > : \" / \\ | ? * (they become the file name)."
          })
        }
        const playerStarts = map.items.filter(isPlayerStart).length
        if (playerStarts !== 1) {
          return yield* new ExportValidationError({
            message: `The game needs exactly one MP_PlayerStart; this map has ${playerStarts}.`
          })
        }
        const createdAt = yield* currentCreatedAt.pipe(Effect.provideService(DateTime.CurrentTimeZone, timeZone))
        const out: MapFile = {
          ...map,
          worldSettings: {
            ...map.worldSettings,
            levelData: {
              ...levelData,
              systemLevelName: SYSTEM_LEVEL_NAME,
              userLevelName: userLevelNameOf(displayName, creatorName),
              levelDisplayName: displayName,
              creatorName,
              createdAt
            }
          },
          // .ballmap files have no editorState; every .balledit the game writes does.
          editorState: map.editorState ?? defaultEditorState()
        }
        const text = yield* codec.encode(out)
        return {
          filename: mapFileNameOf(displayName, creatorName),
          text,
          blob: new Blob([text], { type: "application/json" }),
          map: out
        } satisfies ExportedMap
      })

      return MapExporter.of({ prepare })
    })
  )

  static readonly layer = this.layerNoDeps.pipe(
    Layer.provide([MapCodec.layer, DateTime.layerCurrentZoneLocal])
  )
}
