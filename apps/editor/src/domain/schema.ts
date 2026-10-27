/**
 * Shared schema helpers for the game-derived JSON files (map, catalog, materials,
 * keybinds). Every object in those files is "open": known fields are typed and validated,
 * and any field we don't model is kept in an index signature so data survives
 * import -> export without loss. Known fields keep their declared order; unknown fields
 * are appended after them on encode.
 */
import { Schema } from "effect"

const Rest = [Schema.Record(Schema.String, Schema.Unknown)] as const

/** A struct that keeps unknown keys. `Schema.Class` can't carry an index signature in Effect v4, so named types wrap this in `Schema.Opaque`. */
export const open = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), Rest)
