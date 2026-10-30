import { Context, DateTime, Effect, Layer } from "effect"
import {
  currentCreatedAt,
  defaultEditorState,
  isValidName,
  mapFileNameOf,
  NAME_RULE,
  userLevelNameOf
} from "../domain/factory"
import { gameLoadProblems } from "../domain/limits"
import { type MapFile, SYSTEM_LEVEL_NAME } from "../domain/MapFile"
import { ExportValidationError, type MapEncodeError } from "./errors"
import { MapCodec } from "./MapCodec"

export interface ExportedMap {
  readonly filename: string
  readonly text: string
  readonly blob: Blob
  /** The map as written (with the export-time level fields applied). */
  readonly map: MapFile
}

export class MapExporter extends Context.Service<MapExporter, {
  /** Applies the level-name fields the game expects, checks the game's load rules (domain/limits), and encodes to a `.balledit`. */
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
        if (!isValidName(displayName) || !isValidName(creatorName)) {
          return yield* new ExportValidationError({
            message: `Map name and creator: ${NAME_RULE} (they become the file name).`
          })
        }
        const problems = gameLoadProblems(map)
        if (problems.length > 0) {
          return yield* new ExportValidationError({ message: problems.slice(0, 3).join(" ") })
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
