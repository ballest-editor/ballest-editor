// The shape of tools/extract/connectors.json (docs/qa/connectors.md § What an end is): what the survey writes and the
// tests read. The app's own schema for an end is `Connector` in apps/web/src/domain/Catalog.ts.
import { Schema } from "effect"

export const Vector = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])

const centre = { centre: Schema.optionalKey(Vector) }

/** The flat cap an end is cut by, in its plane. */
export const Cap = Schema.Union([
  Schema.Struct({
    shape: Schema.Literals(["rect", "polygon"]),
    width: Schema.Finite,
    height: Schema.Finite,
    ...centre
  }),
  Schema.Struct({ shape: Schema.Literal("circle"), radius: Schema.Finite, ...centre }),
  Schema.Struct({ shape: Schema.Literal("annulus"), radius: Schema.Finite, innerRadius: Schema.Finite, ...centre })
])
export type Cap = typeof Cap.Type

export const End = Schema.Struct({
  position: Vector,
  forward: Vector,
  up: Vector,
  profile: Schema.String,
  hand: Schema.optionalKey(Schema.Literals(["left", "right"])),
  cap: Cap
})
export type End = typeof End.Type

export const ConnectorsFile = Schema.Struct({
  game: Schema.String,
  measured: Schema.String,
  method: Schema.String,
  pieces: Schema.Record(Schema.String, Schema.Array(End))
})
