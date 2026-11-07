// A checked-in JSON file beside tools/extract, or under it, decoded by `schema`: what the tests over measured data read.
import { Schema } from "effect"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export const readJson = <A, I>(schema: Schema.Codec<A, I>, ...path: ReadonlyArray<string>): A =>
  Schema.decodeSync(Schema.fromJsonString(schema))(readFileSync(join(import.meta.dirname, "..", ...path), "utf8"))
