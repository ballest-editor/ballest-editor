/**
 * The Inspector's Validate: the map against docs/FORMAT.md, without the game. An error is what stops the map being saved
 * or opening in the game, the same rules Save, Export and Play refuse it by. A warning is what the game lets through
 * and the player would still want to know.
 *
 * This isn't the game's validation run, a race in the in-game editor that sets `bValidated` and the medal times.
 */
import { Option, Schema } from "effect"
import type { CatalogIndex } from "./Catalog"
import { isValidName, NAME_RULE, userLevelNameOf } from "./factory"
import { fileTextProblems, gameLoadProblems } from "./limits"
import { classNameOf, GOAL_CLASS, type Item, MapFile } from "./MapFile"
import { stringifyUe } from "./ueJson"

export interface MapValidation {
  readonly errors: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<string>
}

const GOAL = classNameOf(GOAL_CLASS)

/** Why `displayName` and `creatorName` can't name a map's file; none when they can. */
export const mapNameProblem = (displayName: string, creatorName: string): Option.Option<string> => {
  const display = displayName.trim()
  const creator = creatorName.trim()
  if (display.length === 0 || creator.length === 0) return Option.some("Map name and creator are required.")
  return isValidName(display) && isValidName(creator)
    ? Option.none()
    : Option.some(`Map name and creator: ${NAME_RULE} (they become the file name).`)
}

/** The character limit is on the file's text, in the game's layout, so the map is written out to count it. */
const fileProblems = (map: MapFile): ReadonlyArray<string> =>
  Option.match(Schema.encodeOption(MapFile)(map), {
    onNone: () => ["The map can't be written to a file."],
    onSome: (encoded) => fileTextProblems(stringifyUe(encoded))
  })

/** An item that exactly covers an earlier one of the same piece: the game loads both, and one is usually a mistake. */
const copyWarnings = (items: ReadonlyArray<Item>): ReadonlyArray<string> => {
  const first = new Map<string, number>()
  return items.flatMap((item, index) => {
    const key = JSON.stringify([item.actorToSpawn, item.itemTransform])
    const original = first.get(key)
    if (original !== undefined) return [`Item ${index} is a copy of item ${original} in the same place.`]
    first.set(key, index)
    return []
  })
}

const mapWarnings = (map: MapFile): ReadonlyArray<string> => {
  const { bValidated, creatorName, levelDisplayName, userLevelName } = map.worldSettings.levelData
  return [
    ...map.items.some((item) => classNameOf(item.actorToSpawn) === GOAL)
      ? []
      : ["The map has no goal, so Play in the in-game editor does nothing."],
    ...userLevelName === userLevelNameOf(levelDisplayName, creatorName)
      ? []
      : [`The level is saved as "${userLevelName}", which doesn't match its name and creator.`],
    ...bValidated ? [] : ["Nobody has finished a validation run, so the map has no medal times."],
    ...copyWarnings(map.items)
  ]
}

/** `map` as the game gets it (`gameMapOf`). Rules about classes, properties and meshes need a catalog. */
export const validateMap = (map: MapFile, catalog: CatalogIndex | null): MapValidation => {
  const { creatorName, levelDisplayName } = map.worldSettings.levelData
  // One line per problem, so the count is what the list shows: a rule can find the same thing twice.
  return {
    errors: [
      ...new Set([
        ...Option.toArray(mapNameProblem(levelDisplayName, creatorName)),
        ...gameLoadProblems(map, catalog),
        ...fileProblems(map)
      ])
    ],
    warnings: mapWarnings(map)
  }
}
