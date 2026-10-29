// A material's effective parameters: the root UMaterial's defaults (CachedExpressionData) overridden by
// each instance down the parent chain, and how the compiled shader's slots (constant-buffer floats, texture
// registers) resolve against them. Shared by the shader analysis (which evaluates the compiled shaders with
// these values) and the materials.json build.
import { arr, bool, get, num, obj, refPath, str } from "./json.ts"
import { type Slot, slotValue } from "./preshader.ts"

export type Rgba = [number, number, number, number]
const color = (c: unknown): Rgba | null => {
  const r = num(get(c, "R")), g = num(get(c, "G")), b = num(get(c, "B"))
  return r === undefined || g === undefined || b === undefined ? null : [r, g, b, num(get(c, "A")) ?? 1]
}
const strip = (v: unknown): string | undefined => str(v)?.replace(/^[A-Za-z_]+::/, "")

export interface Own {
  readonly path: string
  readonly error?: string
  readonly kind?: "instance" | "material"
  readonly parent: string | null
  readonly scalars: Record<string, number | null>
  readonly vectors: Record<string, Rgba | null>
  readonly textures: Record<string, string | null>
  readonly switches: Record<string, boolean | null>
  readonly errors?: unknown
  readonly redirectedTo?: string
  readonly blendMode?: string
  readonly shadingModel?: string
  readonly twoSided?: boolean
  readonly opacityMaskClipValue?: number
  readonly connectedOutputs?: ReadonlyArray<string>
  /**
   * The root material's texture table, in the order the shaders' texture slots index it (cooked
   * `ReferencedDefaultTextures`; null where the slot is not a texture).
   */
  readonly referencedTextures: ReadonlyArray<string | null>
}

// EMaterialProperty order (UE 5.8 SceneTypes.h), used for PropertyConnectedMask bits.
const MP = [
  "EmissiveColor",
  "Opacity",
  "OpacityMask",
  "DiffuseColor",
  "SpecularColor",
  "BaseColor",
  "Metallic",
  "Specular",
  "Roughness",
  "Anisotropy",
  "Normal",
  "Tangent",
  "WorldPositionOffset",
  "WorldDisplacement_DEPRECATED",
  "TessellationMultiplier_DEPRECATED",
  "SubsurfaceColor",
  "CustomData0",
  "CustomData1",
  "AmbientOcclusion",
  "Refraction",
  "CustomizedUVs0"
]
const connected = (mask: unknown): Array<string> => {
  const m = BigInt(typeof mask === "number" || typeof mask === "string" ? mask : 0)
  return MP.filter((_, i) => ((m >> BigInt(i)) & 1n) === 1n)
}

export const ownOf = (dump: unknown, path: string): Own => {
  const entry = get(dump, "materials", path)
  const base = { path, parent: null, scalars: {}, vectors: {}, textures: {}, switches: {}, referencedTextures: [] }
  if (entry === undefined || get(entry, "error") !== undefined) {
    return { ...base, error: str(get(entry, "error")) ?? "not loaded" }
  }
  const e = get(entry, "export")
  const p = obj(get(e, "Properties")) ?? {}
  const isInstance = (str(get(e, "Type")) ?? "").includes("MaterialInstance")
  const o: {
    -readonly [K in keyof Own]: Own[K]
  } = {
    ...base,
    kind: isInstance ? "instance" : "material",
    parent: refPath(p["Parent"]),
    referencedTextures: arr(p["ReferencedDefaultTextures"] ?? get(e, "ReferencedTextures")).map(refPath)
  }
  const errors = get(entry, "errors")
  if (errors !== undefined) o.errors = errors
  const redirected = str(get(entry, "redirectedTo"))
  if (redirected !== undefined) o.redirectedTo = redirected
  const paramName = (s: unknown) => str(get(s, "ParameterInfo", "Name")) ?? ""
  if (isInstance) {
    for (const s of arr(p["ScalarParameterValues"])) o.scalars[paramName(s)] = num(get(s, "ParameterValue")) ?? null
    for (const s of arr(p["VectorParameterValues"])) o.vectors[paramName(s)] = color(get(s, "ParameterValue"))
    for (const s of arr(p["TextureParameterValues"])) o.textures[paramName(s)] = refPath(get(s, "ParameterValue"))
    for (const s of arr(get(p["StaticParametersRuntime"], "StaticSwitchParameters"))) {
      o.switches[paramName(s)] = bool(get(s, "Value")) ?? false
    }
    const b = obj(p["BasePropertyOverrides"]) ?? {}
    if (b["bOverride_BlendMode"] === true) o.blendMode = strip(b["BlendMode"]) ?? "BLEND_Opaque"
    if (b["bOverride_ShadingModel"] === true) o.shadingModel = strip(b["ShadingModel"]) ?? "MSM_DefaultLit"
    if (b["bOverride_TwoSided"] === true) o.twoSided = b["TwoSided"] === true
    const clip = num(b["OpacityMaskClipValue"])
    if (b["bOverride_OpacityMaskClipValue"] === true && clip !== undefined) o.opacityMaskClipValue = clip
  } else {
    // Cooked UMaterial: no expression graph, but CachedExpressionData keeps the parameter names
    // (RuntimeEntries[type].ParameterInfoSet) and default values.
    const c = obj(get(e, "CachedExpressionData")) ?? {}
    const names = (i: number) =>
      arr(get(c[i === 0 ? "RuntimeEntries" : `RuntimeEntries[${i}]`], "ParameterInfoSet")).map((x) =>
        str(get(x, "Name")) ?? ""
      )
    // EMaterialParameterType (5.8): 0 Scalar, 1 Vector, 2 DoubleVector, 3 Texture, ..., 8 StaticSwitch
    names(0).forEach((n, i) => (o.scalars[n] = num(arr(c["ScalarValues"])[i]) ?? null))
    names(1).forEach((n, i) => (o.vectors[n] = color(arr(c["VectorValues"])[i])))
    names(3).forEach((n, i) => (o.textures[n] = refPath(arr(c["TextureValues"])[i])))
    names(8).forEach((n, i) => (o.switches[n] = bool(arr(c["StaticSwitchValues"])[i]) ?? null))
    o.blendMode = strip(p["BlendMode"]) ?? "BLEND_Opaque"
    o.shadingModel = strip(p["ShadingModel"]) ??
      (p["ShadingModels"] !== undefined ? "MSM_FromMaterialExpression?" : "MSM_DefaultLit")
    o.twoSided = p["TwoSided"] === true
    const clip = num(p["OpacityMaskClipValue"])
    if (clip !== undefined) o.opacityMaskClipValue = clip
    if (c["PropertyConnectedMask"] !== undefined) o.connectedOutputs = connected(c["PropertyConnectedMask"])
  }
  return o
}

export interface Merged {
  readonly scalars: Record<string, number | null>
  readonly vectors: Record<string, Rgba | null>
  readonly textures: Record<string, string | null>
  readonly switches: Record<string, boolean | null>
}

export interface Chain {
  readonly chain: ReadonlyArray<Own>
  readonly self: Own
  readonly root: Own
  readonly merged: Merged
  readonly blendMode: string
  readonly shadingModel: string
  readonly twoSided: boolean
}

/** The parent chain of `path` (leaf first) and its merged, effective parameters. */
export const chainOf = (dump: unknown, path: string): Chain => {
  const chain: Array<Own> = []
  for (let p: string | null = path, guard = 0; p !== null && guard < 16; guard++) {
    const o = ownOf(dump, p)
    chain.push(o)
    p = o.parent
  }
  const self = chain[0] ?? ownOf(dump, path)
  const root = chain[chain.length - 1] ?? self
  // Merge root -> leaf (instances only store overrides).
  const merged: Merged = { scalars: {}, vectors: {}, textures: {}, switches: {} }
  let blendMode = "BLEND_Opaque", shadingModel = "MSM_DefaultLit", twoSided = false
  for (const o of chain.toReversed()) {
    Object.assign(merged.scalars, o.scalars)
    Object.assign(merged.vectors, o.vectors)
    Object.assign(merged.textures, o.textures)
    Object.assign(merged.switches, o.switches)
    if (o.blendMode !== undefined) blendMode = o.blendMode
    if (o.shadingModel !== undefined) shadingModel = o.shadingModel
    if (o.twoSided !== undefined) twoSided = o.twoSided
  }
  return { chain, self, root, merged, blendMode, shadingModel, twoSided }
}

/** A parameter's value by the name the preshader gives a constant-buffer slot (`Name` or `Name.x`). */
export const paramValueOf = (merged: Merged, name: string): number | undefined => {
  const scalar = merged.scalars[name]
  if (typeof scalar === "number") return scalar
  const m = name.match(/^(.*)\.([xyzw])$/)
  if (m === null) return undefined
  const vec = merged.vectors[m[1] ?? ""]
  return vec == null ? undefined : vec["xyzw".indexOf(m[2] ?? "")]
}

/** A material texture slot of the compiled shader: the root's texture it holds and the parameter that may override it. */
export interface TextureSlot {
  /** Index into the root material's ReferencedTextures. */
  readonly index: number
  readonly param: string | null
}

/** The texture a shader slot holds for a material: the instance's override of its parameter, else the root's table. */
export const slotTexture = (chain: Pick<Chain, "merged" | "root">, slot: TextureSlot | undefined): string | null => {
  if (slot === undefined) return null
  const override = slot.param === null ? undefined : chain.merged.textures[slot.param]
  return override ?? chain.root.referencedTextures[slot.index] ?? null
}

/**
 * The material constant buffer's values for a material: `buffer[reg].c` (the register `cb3`, or the type
 * `Material`, whichever the caller's IR walk names it) through the preshader slot table and the merged
 * parameters; undefined for a reference outside the buffer or a slot the parameters cannot fill.
 */
export const materialParams = (
  buffer: string,
  table: { readonly slots: ReadonlyArray<Slot>; readonly paramNames: ReadonlyArray<string> },
  merged: Merged
): (ref: string) => number | undefined => {
  const byRef = new Map(table.slots.map((s) => [s.ref, s]))
  const prefix = `${buffer}[`
  return (ref) => {
    if (!ref.startsWith(prefix)) return undefined
    const slot = byRef.get(ref.slice(buffer.length))
    if (slot === undefined) return undefined
    return slotValue(
      slot,
      table.paramNames,
      (name) => paramValueOf(merged, name),
      (name) => merged.vectors[name] ?? undefined
    )
  }
}
