/**
 * Schema of the game's prefab file, `Saved/SaveGames/Prefabs/<name>.json` (docs/FORMAT.md § Prefab file). Every object is
 * "open" (schema.ts), with its fields in the order the game writes them, so what the game adds survives a round trip.
 * What the game refuses beyond the file's shape is in `gameRules.ts`, and the conversions to map items in `prefab.ts`.
 */
import { Schema } from "effect"
import { open } from "./schema"

const Triple = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])
/** Three numbers: `[x, y, z]`, or a rotation's `[pitch, yaw, roll]` in degrees. */
export type Triple = typeof Triple.Type

export class PrefabTransform extends Schema.Opaque<PrefabTransform>()(
  open({ location: Triple, rotation: Triple, scale: Triple })
) {}

/** `mesh` is "" where a map writes "", and `materials` are bare paths in slot order. */
export class PrefabMesh extends Schema.Opaque<PrefabMesh>()(
  open({ tag: Schema.String, mesh: Schema.String, materials: Schema.Array(Schema.String) })
) {}

/** The Paint panel's choice per slot. It has no field in a map, and wins over `meshes` where it names a category. */
export class PrefabPaint extends Schema.Opaque<PrefabPaint>()(
  open({ categories: Schema.Array(Schema.NullOr(Schema.String)), colors: Schema.Array(Schema.Finite) })
) {}

export const PrefabPropertyValue = Schema.Union([Schema.Boolean, Schema.Finite, Schema.String])
export type PrefabPropertyValue = typeof PrefabPropertyValue.Type

export class PrefabItem extends Schema.Opaque<PrefabItem>()(
  open({
    class: Schema.String,
    transform: PrefabTransform,
    /** One map for every type, where a map has a list per type. */
    properties: Schema.Record(Schema.String, PrefabPropertyValue),
    meshes: Schema.Array(PrefabMesh),
    paint: Schema.optionalKey(PrefabPaint)
  })
) {}

/** The frame of the group a spawn makes, less its position, which the game picks anew. */
export class PrefabGroup extends Schema.Opaque<PrefabGroup>()(
  open({ rotation: Triple, scale: Triple, name: Schema.optionalKey(Schema.String) })
) {}

export const PREFAB_FORMAT = "BallestPrefab"
export const PREFAB_VERSION = 1

export class PrefabFile extends Schema.Opaque<PrefabFile>()(
  open({
    format: Schema.Literal(PREFAB_FORMAT),
    version: Schema.Literal(PREFAB_VERSION),
    group: PrefabGroup,
    items: Schema.Array(PrefabItem)
  })
) {}
