// `materials list|build`.
//   list  WORK ASSETS -> WORK/materials.txt (union of sample, catalog and paint materials)
//   build WORK ASSETS -> ASSETS/materials.json from WORK/materials-dump.json (+ paint-dump.json, shaders.json)
// Parameters come from the cooked assets (instances override their parents down the chain). How textures are
// read (which UV space, at what scale, how strongly) comes from the compiled shaders (shaders.json), not from
// texture names or streaming estimates.
import { Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import type { Leaf } from "./dxil.ts"
import { arr, bool, get, type JsonObject, nameOf, num, obj, refPath, str } from "./json.ts"
import type { MaterialShaders, ShadersFile } from "./shaders.ts"

export class MaterialsError extends Schema.TaggedError<MaterialsError>()("MaterialsError", {
  message: Schema.String
}) {}

const parseJson = (text: string): unknown => JSON.parse(text)

const readJson = Effect.fn("readJson")(function*(file: string) {
  const fs = yield* FileSystem
  return parseJson(yield* fs.readFileString(file))
})

const readJsonIfExists = Effect.fn("readJsonIfExists")(function*(file: string) {
  const fs = yield* FileSystem
  return (yield* fs.exists(file)) ? yield* readJson(file) : undefined
})

// ------------------------------------------------------------------ paint (in-game picker)
// The level editor's "Paint" panel: MaterialCategories_Library lists PDA_MaterialCategory assets (smooth,
// rough, ...); each maps EBallestMaterialColors to one material. Category and colour names come from the
// enums' display names; the map order is the order the game lists them.
const PAINT_LIBRARY = "MaterialCategories_Library"

interface PaintColor {
  readonly color: string | undefined
  readonly material: string
  readonly displayColor?: [number, number, number]
}
interface PaintCategory {
  readonly name: string | undefined
  readonly colors: ReadonlyArray<PaintColor>
}

const paintOf = (dump: unknown): Array<PaintCategory> => {
  const exports = Object.values(obj(get(dump, "packages")) ?? {}).flatMap(arr)
  const byName = new Map(exports.map((e) => [str(get(e, "Name")), e] as const))
  const enumNames = (name: string) =>
    new Map(
      arr(get(byName.get(name), "Properties", "DisplayNameMap")).map((kv) =>
        [str(get(kv, "Key")), str(get(kv, "Value", "CultureInvariantString"))] as const
      )
    )
  const categoryNames = enumNames("EBallestMaterialCategories")
  const colorNames = enumNames("EBallestMaterialColors")
  const enumKey = (v: unknown) => str(v)?.split("::").pop()
  const library = byName.get(PAINT_LIBRARY)
  if (library === undefined) throw new MaterialsError({ message: `paint: ${PAINT_LIBRARY} not in the dump` })
  return arr(get(library, "Properties", "BallestMaterialCategories")).map((ref) => {
    const asset = byName.get(str(get(ref, "ObjectName"))?.split("'")[1])
    if (asset === undefined) {
      throw new MaterialsError({ message: `paint: ${String(get(ref, "ObjectName"))} not in the dump` })
    }
    const p = get(asset, "Properties")
    // An unset byte enum is its first enumerator (MaterialCategory_Smooth stores none).
    const name = categoryNames.get(enumKey(get(p, "MaterialCategory")) ?? "NewEnumerator0")
    const display = new Map(arr(get(p, "ColorColorMap")).map((kv) => [str(get(kv, "Key")), get(kv, "Value")] as const))
    return {
      name,
      colors: arr(get(p, "ColorMaterialMap")).map((kv) => {
        const value = get(kv, "Value")
        const cls = str(get(value, "ObjectName"))?.split("'")[0] ?? ""
        const shown = display.get(str(get(kv, "Key")))
        const r = num(get(shown, "R")), gg = num(get(shown, "G")), b = num(get(shown, "B"))
        const displayColor: [number, number, number] | undefined =
          r !== undefined && gg !== undefined && b !== undefined
            ? [r, gg, b]
            : undefined
        return {
          color: colorNames.get(enumKey(get(kv, "Key"))),
          // class-qualified, as map files store it
          material: `/Script/Engine.${cls}'${refPath(value)}'`,
          ...(displayColor === undefined ? {} : { displayColor })
        }
      })
    }
  })
}

const loadPaint = Effect.fn("loadPaint")(function*(work: string) {
  const path = yield* Path
  const dump = yield* readJsonIfExists(path.join(work, "paint-dump.json"))
  return dump === undefined ? null : paintOf(dump)
})

// ------------------------------------------------------------------ list
export const materialsList = Effect.fn("materialsList")(function*({ assets, work }: { work: string; assets: string }) {
  const fs = yield* FileSystem
  const path = yield* Path
  const set = new Set<string>()
  const add = (p: unknown) => {
    const s = str(p)
    if (s?.startsWith("/")) set.add(s)
  }
  for (const c of arr(get(yield* readJson(path.join(work, "samples.json")), "classes"))) {
    for (const slot of Object.values(obj(get(c, "materials")) ?? {})) {
      for (const p of Object.keys(obj(slot) ?? {})) add(p)
    }
  }
  const cat = yield* readJson(path.join(assets, "catalog.json"))
  const slots = (list: unknown) => {
    for (const s of arr(list)) {
      add(get(s, "defaultMaterial"))
      add(get(s, "meshMaterial"))
    }
  }
  for (const p of arr(get(cat, "pieces"))) {
    slots(get(p, "materialSlots"))
    for (const x of arr(get(p, "extraMeshes"))) slots(get(x, "materialSlots"))
  }
  for (const m of arr(get(cat, "meshes"))) slots(get(m, "materialSlots"))
  for (const c of (yield* loadPaint(work)) ?? []) for (const { material } of c.colors) add(material.split("'")[1])
  yield* fs.writeFileString(path.join(work, "materials.txt"), [...set].sort().join("\n") + "\n")
  yield* Effect.logInfo(`[materials] ${set.size} referenced materials`)
})

/** WORK/shader-materials.txt: every material the dump loaded (parents included), at its real path, for `shaders`. */
export const materialsShaderList = Effect.fn("materialsShaderList")(function*({ work }: { work: string }) {
  const fs = yield* FileSystem
  const path = yield* Path
  const dump = yield* readJson(path.join(work, "materials-dump.json"))
  const paths = Object.entries(obj(get(dump, "materials")) ?? {})
    .filter(([, v]) => get(v, "error") === undefined)
    .map(([k, v]) => str(get(v, "redirectedTo")) ?? k)
  yield* fs.writeFileString(path.join(work, "shader-materials.txt"), [...new Set(paths)].sort().join("\n") + "\n")
  yield* Effect.logInfo(`[materials] ${paths.length} materials for shader analysis`)
})

// ------------------------------------------------------------------ build: one asset's own data
type Rgba = [number, number, number, number]
const color = (c: unknown): Rgba | null => {
  const r = num(get(c, "R")), g = num(get(c, "G")), b = num(get(c, "B"))
  return r === undefined || g === undefined || b === undefined ? null : [r, g, b, num(get(c, "A")) ?? 1]
}
const strip = (v: unknown): string | undefined => str(v)?.replace(/^[A-Za-z_]+::/, "")

interface Own {
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

const ownOf = (dump: unknown, path: string): Own => {
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

// ------------------------------------------------------------------ build: texture reads from the shaders
export type Projection = "uv" | "object" | "world"
export type Role = "color" | "normal" | "orm" | "variation" | "opacity" | "mask"

export interface Read {
  readonly texture: string
  readonly role: Role
  readonly channels: string
  /** uv: the mesh UV0; object: object-aligned position (rotates and, see instanceScale, scales with the piece); world. */
  readonly projection: Projection
  /** Repeats per UV unit (uv) or per centimetre (object / world), for u and v. */
  readonly scale: [number, number]
  /** 1: u, v also multiply by the instance's x, y scale; -1: divide; 0: no. */
  readonly instanceScale: number
  /** Normal maps: layer strength (1 = full), from the unpack constant. */
  readonly strength: number
  /** Constant-buffer values on the coordinate path the preshader did not resolve to a plain parameter. */
  readonly unresolved: ReadonlyArray<string>
}

interface Merged {
  readonly scalars: Record<string, number | null>
  readonly vectors: Record<string, Rgba | null>
  readonly textures: Record<string, string | null>
  readonly switches: Record<string, boolean | null>
}

interface Source {
  readonly projection: Projection
  readonly factor: number
  readonly depth: number
}
// The deeper of two equal-factor paths decides: a position that went local -> world -> object is object-aligned
// even though the plain local -> world path is in the sum too.
const better = (a: Source | undefined, b: Source): boolean =>
  a === undefined || b.factor > a.factor || (b.factor === a.factor && b.depth > a.depth)

const sourceOf = (sh: MaterialShaders, leaf: Leaf): Source | undefined => {
  if (leaf.kind !== "input") return undefined
  // SV_Position reconstructs the world position; one transform on top of it is the object's inverse.
  if (leaf.source === "SV_Position") {
    return {
      projection: leaf.sceneDepth >= 1 ? "object" : "world",
      factor: Math.abs(leaf.factor),
      depth: leaf.sceneDepth
    }
  }
  if (!/^TEXCOORD\d+$/.test(leaf.source)) return undefined
  // An interpolant: what the vertex shader put in it. ATTRIBUTE0 is the local position: one transform makes
  // it world, two bring it back object-aligned (scaled); none is local.
  let best: Source | undefined
  for (const vl of sh.interpolants[`${leaf.source}.${leaf.component}`] ?? []) {
    const f = Math.abs(leaf.factor * vl.factor)
    const candidate: Source | undefined = vl.kind === "buffer"
      ? { projection: "uv", factor: f, depth: 0 }
      : vl.kind === "input" && vl.source === "ATTRIBUTE0"
      ? { projection: vl.sceneDepth === 1 ? "world" : "object", factor: f, depth: vl.sceneDepth }
      : undefined
    if (candidate && better(best, candidate)) best = candidate
  }
  return best
}

/** A constant-buffer ref (`cb3[2].w`) -> its value through the preshader slot table and the merged parameters. */
const paramValue = (sh: MaterialShaders, merged: Merged, ref: string): number | undefined => {
  const buffer = sh.materialBuffer
  if (buffer === null || !ref.startsWith(buffer + "[")) return undefined
  const slot = sh.slots.find((s) => s.ref === ref.slice(buffer.length))
  if (slot?.expression !== undefined) return undefined
  if (slot?.constant !== undefined) return slot.constant
  const name = slot?.param ?? ""
  const scalar = merged.scalars[name]
  if (typeof scalar === "number") return scalar
  const m = name.match(/^(.*)\.([xyzw])$/)
  if (m === null) return undefined
  const vec = merged.vectors[m[1] ?? ""]
  return vec == null ? undefined : vec["xyzw".indexOf(m[2] ?? "")]
}

const readsOf = (
  sh: MaterialShaders,
  merged: Merged,
  textureOf: (i: number) => string | null,
  dump: unknown,
  translucent: boolean
): Array<Read> => {
  const out: Array<Read> = []
  for (const r of sh.reads) {
    const tex = r.texture >= 0 ? textureOf(r.texture) : null
    if (tex === null) continue
    let projection: Projection | undefined
    let instanceScale = 0
    const unresolved = new Set<string>()
    const scale = r.coords.slice(0, 2).map((c) => {
      let best = 0
      for (const leaf of c.leaves) {
        const src = sourceOf(sh, leaf)
        if (src === undefined) continue
        let f = src.factor
        for (const p of leaf.params) {
          const v = paramValue(sh, merged, p)
          if (v === undefined) {
            if (sh.materialBuffer !== null && p.startsWith(sh.materialBuffer)) unresolved.add(p)
          } else f *= Math.abs(v)
        }
        if (f > best || (f === best && projection === undefined)) {
          best = f
          projection = src.projection
        }
        if (leaf.sceneScale !== 0) instanceScale = leaf.sceneScale
      }
      return best
    })
    if (projection === undefined) continue
    const info = get(dump, "textures", tex)
    const compression = str(get(info, "compression")) ?? ""
    const name = nameOf(tex)
    const role: Role = compression === "TC_Normalmap"
      ? "normal"
      : /MacroVariation/i.test(name)
      ? "variation"
      : compression === "TC_Masks"
      ? "orm"
      : translucent && r.channels.length === 1
      ? "opacity"
      : r.channels.length === 1 && get(info, "sRGB") === false
      ? "mask"
      : "color"
    const u = scale[0] ?? 0, v = scale[1] ?? u
    // A projected read at more than one repeat per 5 cm is not a surface texture: the coordinate went
    // through a cell function (floor/frac) the trace does not follow (M_PlasticBase's hex-cell lookups).
    if (projection !== "uv" && Math.max(u, v) > 0.2) unresolved.add("scale")
    out.push({
      texture: tex,
      role,
      channels: r.channels,
      projection,
      scale: [u, v === 0 ? u : v],
      instanceScale,
      strength: role === "normal" && r.resultFactor !== null ? Math.abs(r.resultFactor) / 2 : 1,
      unresolved: [...unresolved].sort()
    })
  }
  return out
}

// ------------------------------------------------------------------ build
/** shaders.json's materials, if the file is one this version wrote. */
const shaderMaterialsOf = (file: unknown): ShadersFile["materials"] => {
  if (get(file, "version") !== 1) return {}
  const materials = obj(get(file, "materials")) ?? {}
  return Object.fromEntries(
    Object.entries(materials).map(([k, v]) => [k, isMaterialShaders(v) ? v : { error: str(get(v, "error")) ?? "?" }])
  )
}
const isMaterialShaders = (v: unknown): v is MaterialShaders =>
  typeof get(v, "pixel") === "string" && Array.isArray(get(v, "reads")) && Array.isArray(get(v, "textures"))

const pick = <T>(
  entries: Record<string, T | null>,
  patterns: ReadonlyArray<RegExp>,
  exclude = /$^/
): [string | null, T | null] => {
  for (const re of patterns) {
    for (const [k, v] of Object.entries(entries)) if (re.test(k) && !exclude.test(k) && v != null) return [k, v]
  }
  return [null, null]
}

export const materialsBuild = Effect.fn("materialsBuild")(
  function*({ assets, work }: { work: string; assets: string }) {
    const fs = yield* FileSystem
    const path = yield* Path
    const dump = yield* readJson(path.join(work, "materials-dump.json"))
    const shaderMaterials = shaderMaterialsOf(yield* readJsonIfExists(path.join(work, "shaders.json")))
    const paint = yield* loadPaint(work)
    const texPath = (p: string | null): string | null => {
      const png = p === null ? undefined : str(get(dump, "textures", p, "png"))
      return png === undefined ? null : `textures/${png}`
    }
    const roots = (yield* fs.readFileString(path.join(work, "materials.txt"))).split("\n").filter((l) => l !== "")
    const records: Array<JsonObject> = []
    let withShaders = 0
    for (const materialPath of roots) {
      const chainOwn: Array<Own> = []
      for (let p: string | null = materialPath, guard = 0; p !== null && guard < 16; guard++) {
        const o = ownOf(dump, p)
        chainOwn.push(o)
        p = o.parent
      }
      const self = chainOwn[0] ?? ownOf(dump, materialPath)
      const root = chainOwn[chainOwn.length - 1] ?? self
      // Merge root -> leaf (instances only store overrides).
      const merged: Merged = { scalars: {}, vectors: {}, textures: {}, switches: {} }
      let blendMode = "BLEND_Opaque", shadingModel = "MSM_DefaultLit", twoSided = false
      for (const o of chainOwn.toReversed()) {
        Object.assign(merged.scalars, o.scalars)
        Object.assign(merged.vectors, o.vectors)
        Object.assign(merged.textures, o.textures)
        Object.assign(merged.switches, o.switches)
        if (o.blendMode !== undefined) blendMode = o.blendMode
        if (o.shadingModel !== undefined) shadingModel = o.shadingModel
        if (o.twoSided !== undefined) twoSided = o.twoSided
      }
      const recovered = self.error === undefined &&
        Object.keys(merged.scalars).length + Object.keys(merged.vectors).length + Object.keys(merged.textures).length >
          0
      const isTranslucent = /Translucent|Additive|Modulate/.test(blendMode)

      // ---- parameters -> PBR values (names: the graph's wiring is not in the cooked asset)
      const S = merged.scalars, V = merged.vectors
      const conn = root.connectedOutputs ?? null
      const emissiveOnly = conn !== null && conn.includes("EmissiveColor") && !conn.includes("BaseColor")
      const [bcKey, bc] = pick(V, [
        /^base ?colou?r$/i,
        /^(albedo|diffuse)( ?colou?r)?$/i,
        /^colou?r$/i,
        /^tint$/i,
        /base ?colou?r|albedo|diffuse/i,
        /colou?r ?glass|glass ?colou?r/i,
        /colou?r|tint/i
      ], /emiss|fresnel|edge|outline|light|grunge|highlight|angle|secondary|direction|noise|blend/i)
      const [metKey, met] = pick(
        S,
        [/^metal(lic)?$/i, /^metal(lic)?[ _]?(value|amount)?$/i],
        /mult|min|max|angle|mask/i
      )
      const [rouKey, rou] = pick(S, [
        /^roughness$/i,
        /^roughness[ _]?(value|amount)?$/i,
        /^roughness[ _]?(min|low)$/i,
        /rough/i
      ], /mult|max|high|contrast|offset|grunge|edge|angle|rain/i)
      const [opKey, op] = pick(S, [/^opacity$/i, /^opacity[ _]?(value|amount)?$/i, /opacity/i], /DT\d|detail|mask/i)
      // Not /light colou?r/ unanchored: it matched M_OutlineEdges' HighlightColor, an inactive highlight tint.
      const [emKey, em] = pick(V, [/emiss/i, /glow/i, /^light[ _]?colou?r$/i], /highlight/i)
      const [emiKey, emi] = pick(S, [
        /emm?iss?ive[ _]?(intensity|strength|power|mult|brightness)/i,
        /light[ _]?emissive[ _]?intensity/i,
        /glow[ _]?(intensity|strength)/i,
        /^(intensity|brightness)$/i
      ])
      const emissiveColor = em?.slice(0, 3).some((x) => x > 0)
        ? em.slice(0, 3).map((x) => x * (emi ?? 1))
        : null

      // ---- textures, from the compiled shaders
      const sh = chainOwn.flatMap((o) => [o.path, ...(o.redirectedTo === undefined ? [] : [o.redirectedTo])])
        .map((p) => shaderMaterials[p])
        .find((s): s is MaterialShaders => s !== undefined && !Object.hasOwn(s, "error"))
      const textureOf = (slot: number): string | null => {
        const t = sh?.textures[slot]
        if (t === undefined) return null
        const override = t.param === null ? undefined : merged.textures[t.param]
        return override ?? root.referencedTextures[t.index] ?? null
      }
      const reads = sh === undefined ? [] : readsOf(sh, merged, textureOf, dump, isTranslucent)
      if (sh !== undefined) withShaders++
      // Only reads whose coordinates are fully known can stand for a role.
      const byRole = (role: Role) => reads.filter((r) => r.role === role && r.unresolved.length === 0)
      // The main normal layer: strongest, then the coarsest (the Env masters add a fine x12 layer at full strength).
      const normals = byRole("normal").sort((a, b) => b.strength - a.strength || a.scale[0] - b.scale[0])
      const primary = (role: Role) => byRole(role)[0]
      const baseColorRead = primary("color")
      const normalRead = normals[0]
      const variationRead = primary("variation")
      const opacityRead = primary("opacity")
      const ormRead = primary("orm")
      const projection: Projection = (baseColorRead ?? normalRead ?? variationRead ?? opacityRead)?.projection ?? "uv"
      // M_OutlineEdges: a band of OutlineBase grey along the UV border, `Size` being the un-banded fraction.
      const outlineBase = V["OutlineBase"]
      const sizeX = S["Size X"], sizeY = S["Size Y"]
      const outline = outlineBase != null && sizeX != null && sizeY != null
        ? { inset: [(1 - sizeX) / 2, (1 - sizeY) / 2], color: outlineBase.slice(0, 3) }
        : null
      const tex = (r: Read | undefined) => (r === undefined ? null : texPath(r.texture))
      const approx = {
        // Emissive-only masters (BaseColor pin unconnected) render black + emissive in UE.
        baseColor: emissiveOnly && emissiveColor ? [0, 0, 0] : (bc ?? [0.8, 0.8, 0.8, 1]).slice(0, 3),
        metallic: met ?? 0,
        roughness: rou ?? 0.6,
        opacity: op ?? (isTranslucent ? 0.5 : 1),
        emissive: emissiveColor,
        baseColorTexture: tex(baseColorRead),
        normalTexture: tex(normalRead),
        ormTexture: tex(ormRead),
        variationTexture: tex(variationRead),
        opacityTexture: tex(opacityRead),
        tiling: {
          baseColor: baseColorRead?.scale ?? [1, 1],
          normal: normalRead?.scale ?? [1, 1],
          variation: variationRead?.scale ?? [1, 1],
          opacity: opacityRead?.scale ?? [1, 1]
        },
        projection,
        instanceScale: (baseColorRead ?? normalRead)?.instanceScale ?? 0,
        // Every texture read the base pass makes, in shader order (all layers; the fields above are the primary ones).
        reads: reads.map((r) => ({ ...r, texture: texPath(r.texture) ?? `missing:${r.texture}` })),
        outline,
        keys: {
          baseColor: bcKey,
          metallic: metKey,
          roughness: rouKey,
          opacity: opKey,
          emissive: emKey,
          emissiveIntensity: emiKey
        }
      }
      const errors = chainOwn.filter((o) => o.error !== undefined || o.errors !== undefined)
      records.push({
        path: materialPath,
        kind: self.kind ?? null,
        parent: self.parent,
        chain: chainOwn.slice(1).map((o) => o.path),
        root: root.path,
        ...(self.redirectedTo === undefined ? {} : { redirectedTo: self.redirectedTo }),
        recovered,
        shaders: sh?.pixel ?? null,
        scalars: merged.scalars,
        vectors: merged.vectors,
        textures: Object.fromEntries(
          Object.entries(merged.textures).map(([k, v]) => [k, texPath(v) ?? (v === null ? null : `missing:${v}`)])
        ),
        switches: merged.switches,
        blendMode,
        shadingModel,
        twoSided,
        connectedOutputs: root.connectedOutputs ?? null,
        referencedTextures: root.referencedTextures.map(texPath).filter((x) => x !== null),
        approx,
        ...(errors.length === 0 ? {} : {
          errors: errors.map((o) => ({ path: o.path, error: o.error, parseErrors: o.errors }))
        })
      })
    }
    records.sort((a, b) => String(a["path"]).localeCompare(String(b["path"])))
    const texList = Object.entries(obj(get(dump, "textures")) ?? {}).map(([p, t]) => ({
      path: p,
      png: texPath(p),
      width: num(get(t, "width")) ?? null,
      height: num(get(t, "height")) ?? null,
      compression: str(get(t, "compression")) ?? null,
      sRGB: bool(get(t, "sRGB")) ?? null,
      format: str(get(t, "format")) ?? null,
      bytes: num(get(t, "bytes")) ?? null,
      error: str(get(t, "error")) ?? null
    }))
    const out = {
      version: 2,
      notes: [
        "scalars/vectors/textures/switches are effective values: root UMaterial defaults (from CachedExpressionData) overridden by each instance down the chain.",
        "vectors are linear RGBA as stored by UE. baseColor/emissive in approx are linear; set three.js colors with Color.setRGB(r,g,b, THREE.LinearSRGBColorSpace) (or the default working space).",
        "approx.baseColor/metallic/roughness/opacity/emissive come from parameters picked by name (approx.keys says which; null = neutral default): the cooked material has no expression graph.",
        "approx.reads are the base-pass pixel shader's texture reads, traced through the compiled shader (tools/extract shaders): projection uv = mesh UV0 (scale in repeats per UV unit); object = object-aligned position, pivot at the object origin, rotating with the piece (scale in repeats per cm; instanceScale 1 = u, v also multiply by the piece's x, y scale); world. strength is a normal layer's blend strength. approx.*Texture/tiling/projection/instanceScale are the primary read per role; tiling is [u, v].",
        "Textures are PNG, largest mip <= --tex-max (2048) px. Normal maps had Z rebuilt from BC5 X/Y and keep UE's DirectX convention (green = -Y); in three.js use normalScale (1, -1) or flip G. sRGB flag per texture in `textures` (sRGB false => load with NoColorSpace).",
        "approx.outline is M_OutlineEdges' grey band along the UV border ({inset: [u, v] fraction, color}).",
        "paint is the in-game editor's material picker (MaterialCategories_Library): categories in the game's order, each with its colours and the class-qualified material a map file stores for that choice. displayColor (linear RGB) is the swatch colour where the game sets one explicitly (ColorColorMap)."
      ],
      materials: records,
      ...(paint === null ? {} : { paint }),
      textures: texList.sort((a, b) => a.path.localeCompare(b.path))
    }
    yield* fs.writeFileString(path.join(assets, "materials.json"), JSON.stringify(out, null, 2) + "\n")
    const withTex = records.filter((r) => arr(get(r, "approx", "reads")).length > 0)
    yield* Effect.logInfo(
      `[materials] ${records.length} materials, ${
        records.filter((r) => r["recovered"] === true).length
      } recovered, ${withShaders} with shaders, ${withTex.length} with texture reads, ${
        texList.filter((t) => t.png !== null).length
      }/${texList.length} textures decoded`
    )
  }
)
