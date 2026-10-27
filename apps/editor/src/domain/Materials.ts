/**
 * Schema for `assets/materials.json` (tools/extract, see its README):
 * `{ materials: [{ path, blendMode, twoSided, redirectedTo?, recovered, approx: { baseColor,
 * metallic, roughness, opacity, emissive, baseColorTexture, normalTexture, ormTexture } }],
 * textures: [{ png, sRGB }] }`. A `{ path: entry }` map is accepted too.
 *
 * Decoding is per entry, so one odd material never sinks the file; unknown keys are kept.
 * Paths are UE object paths (`/Game/Art/X.X`); map files store them class-qualified, so
 * look-ups go through `objectPathOf` first. Colours are linear; emissive may exceed 1 (HDR).
 */
import { Option, Predicate, Schema } from "effect"
import { objectPathOf } from "./MapFile"
import { open } from "./schema"

const Num = Schema.optionalKey(Schema.NullOr(Schema.Finite))
const Str = Schema.optionalKey(Schema.NullOr(Schema.String))
const Rgb = Schema.Union([
  Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]),
  Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite])
])

export const MaterialApprox = open({
  baseColor: Schema.optionalKey(Schema.NullOr(Rgb)),
  metallic: Num,
  roughness: Num,
  opacity: Num,
  emissive: Schema.optionalKey(Schema.NullOr(Schema.Union([Rgb, Schema.Finite]))),
  baseColorTexture: Str,
  normalTexture: Str,
  ormTexture: Str,
  metallicRoughnessTexture: Str,
  emissiveTexture: Str
})

export const MaterialEntry = open({
  path: Schema.optionalKey(Schema.String),
  redirectedTo: Schema.optionalKey(Schema.NullOr(Schema.String)),
  blendMode: Schema.optionalKey(Schema.NullOr(Schema.String)),
  twoSided: Schema.optionalKey(Schema.Boolean),
  approx: Schema.optionalKey(Schema.NullOr(MaterialApprox)),
  recovered: Schema.optionalKey(Schema.Boolean)
})

const TextureEntry = open({ png: Schema.String, sRGB: Schema.optionalKey(Schema.Boolean) })
const decodeTexture = Schema.decodeUnknownOption(TextureEntry)

const decodeEntry = Schema.decodeUnknownOption(MaterialEntry)

/** What the renderer needs for one material, with defaults filled in. Colours are linear RGB. */
export interface MaterialSpec {
  readonly path: string
  readonly baseColor: readonly [number, number, number]
  readonly metallic: number
  readonly roughness: number
  readonly opacity: number
  readonly emissive: readonly [number, number, number]
  readonly baseColorTexture: string | undefined
  readonly normalTexture: string | undefined
  /** Occlusion/roughness/metallic in R/G/B (glTF convention). */
  readonly ormTexture: string | undefined
  readonly emissiveTexture: string | undefined
  /** Translucent blend modes render transparent. */
  readonly translucent: boolean
  /** The game material is two-sided (open/thin geometry such as glass panes). */
  readonly twoSided: boolean
  readonly recovered: boolean
}

export interface MaterialTable {
  readonly materials: ReadonlyMap<string, MaterialSpec>
  /** Asset name (`MI_Env_Glossy_Blue`) -> spec, for paths that moved (redirects, old maps). */
  readonly byName: ReadonlyMap<string, MaterialSpec>
  /** PNG path -> whether it holds sRGB colour data (false = linear data). */
  readonly textureSrgb: ReadonlyMap<string, boolean>
  readonly skipped: number
}

export const emptyMaterialTable = (): MaterialTable => ({
  materials: new Map(),
  byName: new Map(),
  textureSrgb: new Map(),
  skipped: 0
})

/** `/Game/A/B/MI_X.MI_X` -> `MI_X`. */
export const assetNameOf = (path: string): string => {
  const last = objectPathOf(path).split("/").at(-1) ?? ""
  return last.split(".")[0] ?? last
}

export const NEUTRAL: Omit<MaterialSpec, "path"> = {
  baseColor: [0.55, 0.57, 0.6],
  metallic: 0,
  roughness: 0.75,
  opacity: 1,
  emissive: [0, 0, 0],
  baseColorTexture: undefined,
  normalTexture: undefined,
  ormTexture: undefined,
  emissiveTexture: undefined,
  translucent: false,
  twoSided: false,
  recovered: false
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const orUndefined = (s: string | null | undefined) => (s === null || s === undefined || s.length === 0 ? undefined : s)

export const toSpec = (path: string, entry: typeof MaterialEntry.Type): MaterialSpec => {
  const a = entry.approx ?? {}
  const rgb = (v: ReadonlyArray<number> | null | undefined, fallback: readonly [number, number, number]) =>
    v === null || v === undefined ? fallback : ([v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] as const)
  const emissive = Predicate.isNumber(a.emissive)
    ? ([a.emissive, a.emissive, a.emissive] as const)
    : rgb(a.emissive, NEUTRAL.emissive)
  const normalTexture = orUndefined(a.normalTexture)
  // The extractor sometimes reports the normal map as ORM; that would wreck roughness/metalness.
  const orm = orUndefined(a.ormTexture ?? a.metallicRoughnessTexture)
  const opacity = clamp01(a.opacity ?? NEUTRAL.opacity)
  return {
    path,
    baseColor: rgb(a.baseColor, NEUTRAL.baseColor),
    metallic: clamp01(a.metallic ?? NEUTRAL.metallic),
    roughness: clamp01(a.roughness ?? NEUTRAL.roughness),
    opacity,
    emissive,
    baseColorTexture: orUndefined(a.baseColorTexture),
    normalTexture,
    ormTexture: orm === normalTexture ? undefined : orm,
    emissiveTexture: orUndefined(a.emissiveTexture),
    translucent: opacity < 1 || /translucen|additive|modulate/i.test(entry.blendMode ?? ""),
    twoSided: entry.twoSided ?? false,
    recovered: entry.recovered ?? false
  }
}

/** Accepts the extractor's `{ materials: [...], textures: [...] }`, or a `{ path: entry }` map. */
export const parseMaterialsFile = (json: unknown): MaterialTable => {
  if (!Predicate.isObject(json)) return emptyMaterialTable()
  const root = json
  const materials = new Map<string, MaterialSpec>()
  const byName = new Map<string, MaterialSpec>()
  const textureSrgb = new Map<string, boolean>()
  let skipped = 0
  const add = (key: string | undefined, value: unknown) => {
    const entry = decodeEntry(value)
    const path = entry._tag === "Some" ? (entry.value.path ?? key) : undefined
    if (Option.isNone(entry) || path === undefined) {
      skipped++
      return
    }
    const spec = toSpec(objectPathOf(path), entry.value)
    materials.set(spec.path, spec)
    const redirect = entry.value.redirectedTo
    if (redirect !== null && redirect !== undefined && !materials.has(objectPathOf(redirect))) {
      materials.set(objectPathOf(redirect), { ...spec, path: objectPathOf(redirect) })
    }
  }
  const list = root["materials"]
  if (Array.isArray(list)) {
    for (const value of list) add(undefined, value)
  } else {
    const map = Predicate.isObject(list) ? list : root
    for (const [key, value] of Object.entries(map)) if (key.startsWith("/")) add(key, value)
  }
  if (Array.isArray(root["textures"])) {
    for (const value of root["textures"]) {
      const texture = decodeTexture(value)
      if (Option.isSome(texture)) textureSrgb.set(texture.value.png, texture.value.sRGB ?? true)
    }
  }
  for (const spec of materials.values()) {
    const name = assetNameOf(spec.path)
    if (!byName.has(name)) byName.set(name, spec)
  }
  return { materials, byName, textureSrgb, skipped }
}

/** Exact object path first, then by asset name (handles redirected/moved materials). */
export const lookupMaterial = (table: MaterialTable | null, path: string | undefined): MaterialSpec | undefined => {
  if (path === undefined || table === null) return undefined
  return table.materials.get(objectPathOf(path)) ?? table.byName.get(assetNameOf(path))
}
