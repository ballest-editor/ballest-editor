import { Context, Effect, Layer, Option } from "effect"
import type { CatalogIndex } from "../domain/Catalog"
import { currentCreatedAt, defaultEditorState, mapFileNameOf, userLevelNameOf } from "../domain/factory"
import { fileTextProblems, gameLoadProblems } from "../domain/limits"
import { type MapFile, SYSTEM_LEVEL_NAME } from "../domain/MapFile"
import { mapNameProblem } from "../domain/validateMap"
import { ExportValidationError, type MapEncodeError } from "./errors"
import { MapCodec } from "./MapCodec"

export interface ExportedMap {
  readonly filename: string
  readonly text: string
  /** The map as written (with the export-time level fields applied). */
  readonly map: MapFile
}

export class MapExporter extends Context.Service<MapExporter, {
  /** Applies the level-name fields the game expects, checks the game's load rules (domain/limits), and encodes to a `.balledit`. */
  prepare(
    map: MapFile,
    catalog?: CatalogIndex | null
  ): Effect.Effect<ExportedMap, ExportValidationError | MapEncodeError>
}>()("ballest/services/MapExporter") {
  static readonly layerNoDeps = Layer.effect(
    MapExporter,
    Effect.gen(function*() {
      const codec = yield* MapCodec

      const prepare = Effect.fn("MapExporter.prepare")(function*(map: MapFile, catalog: CatalogIndex | null = null) {
        const levelData = map.worldSettings.levelData
        const displayName = levelData.levelDisplayName.trim()
        const creatorName = levelData.creatorName.trim()
        const nameProblem = mapNameProblem(displayName, creatorName)
        if (Option.isSome(nameProblem)) return yield* new ExportValidationError({ message: nameProblem.value })
        // Stamped once: a save keeps the map's date, so Created stays the day it was made.
        const createdAt = levelData.createdAt === "" ? yield* currentCreatedAt : levelData.createdAt
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
          // Only a published .ballmap flags its items: the editor leaves such an item out of its list of pieces.
          items: map.items.map((item) => item.bIsBaseItem ? { ...item, bIsBaseItem: false } : item),
          // .ballmap files have no editorState, and neither do 0.4.1's saves, but the game loads a draft that has one.
          editorState: map.editorState ?? defaultEditorState()
        }
        const problems = gameLoadProblems(out, catalog)
        if (problems.length > 0) {
          return yield* new ExportValidationError({ message: problems.slice(0, 3).join(" ") })
        }
        const text = yield* codec.encode(out)
        const textProblems = fileTextProblems(text)
        if (textProblems.length > 0) {
          return yield* new ExportValidationError({ message: textProblems.join(" ") })
        }
        return {
          filename: mapFileNameOf(displayName, creatorName),
          text,
          map: out
        } satisfies ExportedMap
      })

      return MapExporter.of({ prepare })
    })
  )

  static readonly layer = this.layerNoDeps.pipe(
    Layer.provide(MapCodec.layer)
  )
}
