/** A prefab file for tests, in the shape and layout of docs/FORMAT.md § Prefab file. */
import * as fs from "node:fs"
import * as path from "node:path"

export const PREFAB_TEXT = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "Bridge.prefab"), "utf8")

interface PrefabItemJson {
  class?: string
  transform: { location: Array<number>; rotation: Array<number>; scale: Array<number> }
  properties?: Record<string, unknown>
  meshes?: Array<unknown>
  paint?: unknown
  future?: string
}

/** A prefab as a test takes it apart: every field may go or be something the game refuses. */
export interface PrefabJson {
  format: string
  version: number
  group?: { rotation?: Array<number>; scale?: Array<number>; name?: string }
  items: Array<PrefabItemJson>
  fromAPlugin?: number
}

/** The fixture as JSON, to change. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fixture is this shape, and tests change it freely
export const prefabJson = (): PrefabJson => JSON.parse(PREFAB_TEXT) as PrefabJson

/** The fixture's text with `change` applied. */
export const changedPrefab = (change: (json: PrefabJson) => void): string => {
  const json = prefabJson()
  change(json)
  return JSON.stringify(json)
}

/** An instance's overrides as which members override what: `[{ member: 0, fields: ["hidden", "transform"] }]`. */
export const overrideFields = (
  overrides: ReadonlyArray<{ readonly member: number }> | undefined
): ReadonlyArray<{ readonly member: number; readonly fields: ReadonlyArray<string> }> | undefined =>
  overrides?.map(({ member, ...rest }) => ({ member, fields: Object.keys(rest).sort() }))
