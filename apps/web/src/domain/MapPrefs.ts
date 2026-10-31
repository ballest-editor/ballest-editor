/**
 * Editor state kept per map, outside the map file: the file has no field for it, and the
 * game validates `editorState` and rewrites it on every save. Persisted by MapPrefsStore,
 * keyed by `userLevelName` (`<displayName>_<creator>`, which is also the file name), so a
 * re-imported export finds its prefs again.
 */
import { Option, Predicate, Schema } from "effect"
import type { MapFile } from "./MapFile"

export const MapPrefs = Schema.Struct({
  /** The grid's height in UE cm; absent: the player start's height on load. */
  gridHeight: Schema.optionalKey(Schema.Finite),
  /** Save also exports the map to the game (desktop); absent: off. */
  exportOnSave: Schema.optionalKey(Schema.Boolean)
})
export type MapPrefs = typeof MapPrefs.Type

export const mapPrefsKeyOf = (map: MapFile): string => map.worldSettings.levelData.userLevelName

const decodePrefs = Schema.decodeUnknownOption(MapPrefs)

/** Stored JSON -> prefs by map key; entries that don't decode are dropped. */
export const parseMapPrefs = (stored: unknown): Record<string, MapPrefs> =>
  Predicate.isObject(stored)
    ? Object.fromEntries(
      Object.entries(stored).flatMap(([key, value]) =>
        Option.match(decodePrefs(value), { onNone: () => [], onSome: (prefs) => [[key, prefs] as const] })
      )
    )
    : {}
