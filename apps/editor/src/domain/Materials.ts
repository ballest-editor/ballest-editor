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

/** A texture's UV multiplier: one number (older files) or [u, v]. */
const Pair = Schema.optionalKey(
  Schema.NullOr(Schema.Union([Schema.Finite, Schema.Tuple([Schema.Finite, Schema.Finite])]))
)
const Tiling = open({
  baseColor: Pair,
  normal: Pair,
  variation: Pair,
  opacity: Pair
})
const Projection = Schema.Literals(["uv", "object", "world", "triplanar"])
/** One texture read of the game's base pass, traced through its compiled shader (tools/extract shaders). */
const Read = open({
  texture: Str,
  role: Str,
  scale: Pair,
  projection: Schema.optionalKey(Schema.NullOr(Projection)),
  instanceScale: Num,
  strength: Num
})

const Outline = open({
  inset: Schema.Tuple([Schema.Finite, Schema.Finite]),
  color: Rgb
})

/** The grey mottle as the base pass applies it: `colour *= 1 + gain * product(read(tilings[i]) + offsets[i])`. */
const Variation = open({
  texture: Schema.String,
  tilings: Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite])),
  offsets: Schema.Array(Schema.Finite),
  gain: Schema.Finite
})

/** A texture added to the base colour: `colour += gain * read(tiling)`. */
const ColorLayer = open({
  texture: Schema.String,
  tiling: Pair,
  projection: Schema.optionalKey(Schema.NullOr(Projection)),
  instanceScale: Num,
  gain: Rgb,
  mean: Schema.optionalKey(Schema.NullOr(Rgb))
})

/** A texture a translucent pass's alpha depends on: `alpha += gain * (read.r - mean)`. */
const OpacityLayer = open({
  texture: Schema.String,
  tiling: Pair,
  projection: Schema.optionalKey(Schema.NullOr(Projection)),
  gain: Schema.Finite,
  mean: Num
})

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
  emissiveTexture: Str,
  /** Grey mottle multiplied into the base colour (T_MacroVariation). */
  variationTexture: Str,
  /** Alpha shape of a translucent effect (wind streaks, beam falloff). */
  opacityTexture: Str,
  /** UV multiplier per texture (repeats per UV unit, or per cm when projected); 1 when unknown. */
  tiling: Schema.optionalKey(Schema.NullOr(Tiling)),
  /**
   * "uv": the mesh's own UVs. "object": object-aligned projection (pivot at the piece's origin, turning and
   * scaling with it). "world": world-aligned. "triplanar" is what older files called "object".
   */
  projection: Schema.optionalKey(Schema.NullOr(Projection)),
  /** Projected UVs also multiply by the piece's x and y scale (1), or divide (-1). */
  instanceScale: Num,
  variation: Schema.optionalKey(Schema.NullOr(Variation)),
  colorLayers: Schema.optionalKey(Schema.NullOr(Schema.Array(ColorLayer))),
  opacityLayers: Schema.optionalKey(Schema.NullOr(Schema.Array(OpacityLayer))),
  /** Every texture read of the base pass, including the secondary layers the fields above don't name. */
  reads: Schema.optionalKey(Schema.NullOr(Schema.Array(Read))),
  /** M_OutlineEdges' grey band along the UV border: `inset` is its width as a fraction of U and V. */
  outline: Schema.optionalKey(Schema.NullOr(Outline))
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

export type Pair = readonly [number, number]
export type TextureProjection = "uv" | "object" | "world"

/** A texture the base colour depends on: `colour += gain * (read - mean)`. */
export interface ColorLayer {
  readonly texture: string
  readonly tiling: Pair
  readonly gain: readonly [number, number, number]
  readonly mean: readonly [number, number, number]
}

/** A texture the alpha of a translucent material depends on: `alpha += gain * (read - mean)`. */
export interface OpacityLayer {
  readonly texture: string
  readonly tiling: Pair
  readonly gain: number
  readonly mean: number
}

/** The grey mottle: `colour *= 1 + gain * product over i of (texture read at tilings[i] + offsets[i])`. */
export interface Variation {
  readonly texture: string
  readonly tilings: ReadonlyArray<Pair>
  readonly offsets: ReadonlyArray<number>
  readonly gain: number
}

/** A second normal map blended over the first (the Env masters' fine x12 layer, the metal's coarse one). */
export interface NormalLayer {
  readonly texture: string
  readonly tiling: Pair
  /** 1 = full strength. */
  readonly strength: number
}

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
  readonly variationTexture: string | undefined
  readonly opacityTexture: string | undefined
  /** UV multiplier per texture slot, [u, v]: repeats per UV unit, or per centimetre when projected. */
  readonly tiling: {
    readonly baseColor: Pair
    readonly normal: Pair
    readonly variation: Pair
    readonly opacity: Pair
  }
  /** How texture coordinates are made: the mesh UVs, or a projection of the object/world position. */
  readonly projection: TextureProjection
  /** Projected coordinates also scale with the piece's x (u) and y (v) scale, as the game's instances do. */
  readonly instanceScale: boolean
  readonly normalLayer: NormalLayer | undefined
  /** Textures the base colour depends on (the pipes' grid, the vent's slats), in the material's projection. */
  readonly colorLayers: ReadonlyArray<ColorLayer>
  /** Translucent materials: the texture the alpha follows (the vent's air streaks, the checkpoint's glow). */
  readonly opacityLayer: OpacityLayer | undefined
  /** The mottle, as the game computes it; undefined when the shader has none (then no mottle is drawn). */
  readonly variation: Variation | undefined
  /** Grey band along the UV border (M_OutlineEdges): width per axis as a fraction, and its linear colour. */
  readonly outline:
    | { readonly inset: readonly [number, number]; readonly color: readonly [number, number, number] }
    | undefined
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
  variationTexture: undefined,
  opacityTexture: undefined,
  tiling: { baseColor: [1, 1], normal: [1, 1], variation: [1, 1], opacity: [1, 1] },
  projection: "uv",
  instanceScale: false,
  normalLayer: undefined,
  colorLayers: [],
  opacityLayer: undefined,
  variation: undefined,
  outline: undefined,
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
  const t = a.tiling ?? {}
  const pair = (n: number | Pair | null | undefined, fallback: Pair): Pair => {
    if (Predicate.isNumber(n)) return n > 0 ? [n, n] : fallback
    if (n === null || n === undefined) return fallback
    return n[0] > 0 ? [n[0], n[1] > 0 ? n[1] : n[0]] : fallback
  }
  const outline = a.outline ?? undefined
  const projectionOf = (p: typeof Projection.Type | null | undefined): TextureProjection =>
    p === "object" || p === "triplanar" ? "object" : p === "world" ? "world" : "uv"
  const projection = projectionOf(a.projection)
  const reads = (a.reads ?? []).filter((r) => projectionOf(r.projection) === projection)
  const normals = reads.filter((r) => r.role === "normal" && orUndefined(r.texture) !== undefined)
  // The primary normal map is `normalTexture`; the next distinct read is its second layer.
  const second = normals.find((r) =>
    r.texture !== normalTexture || pair(r.scale, [1, 1])[0] !== pair(t.normal, [1, 1])[0]
  )
  const colorLayers: Array<ColorLayer> = (a.colorLayers ?? [])
    .filter((l) => projectionOf(l.projection) === projection && orUndefined(l.texture) !== undefined)
    .slice(0, 2)
    .map((l) => ({
      texture: l.texture,
      tiling: pair(l.tiling, [1, 1]),
      gain: rgb(l.gain, [0, 0, 0]),
      mean: rgb(l.mean, [0.5, 0.5, 0.5])
    }))
  const ol = (a.opacityLayers ?? []).find((l) =>
    projectionOf(l.projection) === projection && orUndefined(l.texture) !== undefined
  )
  const opacityLayer: OpacityLayer | undefined = ol === undefined
    ? undefined
    : { texture: ol.texture, tiling: pair(ol.tiling, [1, 1]), gain: ol.gain, mean: ol.mean ?? 0.5 }
  const v = a.variation
  const variation: Variation | undefined = v == null || v.tilings.length === 0 || v.gain === 0
    ? undefined
    : {
      texture: v.texture,
      tilings: v.tilings.map((tt) => pair(tt, [1, 1])),
      offsets: v.tilings.map((_, i) => v.offsets[i] ?? 0),
      gain: v.gain
    }
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
    variationTexture: orUndefined(a.variationTexture),
    opacityTexture: orUndefined(a.opacityTexture),
    tiling: {
      baseColor: pair(t.baseColor, [1, 1]),
      normal: pair(t.normal, [1, 1]),
      variation: pair(t.variation, [1, 1]),
      opacity: pair(t.opacity, [1, 1])
    },
    projection,
    instanceScale: (a.instanceScale ?? 0) > 0,
    colorLayers,
    opacityLayer,
    normalLayer: second === undefined || normalTexture === undefined
      ? undefined
      : {
        texture: second.texture ?? normalTexture,
        tiling: pair(second.scale, [1, 1]),
        strength: clamp01(second.strength ?? 1)
      },
    variation,
    outline: outline === undefined || (outline.inset[0] <= 0 && outline.inset[1] <= 0)
      ? undefined
      : { inset: [clamp01(outline.inset[0]), clamp01(outline.inset[1])], color: rgb(outline.color, [0.5, 0.5, 0.5]) },
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
