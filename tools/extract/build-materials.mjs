#!/usr/bin/env node
// usage:
//   node build-materials.mjs list  WORK ASSETS_DIR  -> WORK/materials.txt (union of sample, catalog and paint materials)
//   node build-materials.mjs build WORK ASSETS_DIR  -> ASSETS_DIR/materials.json (from WORK/materials-dump.json)
// Both read WORK/paint-dump.json (the in-game material picker's data assets) when it exists.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [mode, work, assets] = process.argv.slice(2)
if (!["list", "build"].includes(mode) || !assets) {
  console.error("usage: build-materials.mjs list|build WORK ASSETS_DIR")
  process.exit(2)
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"))
// `{ObjectName: "Class'Name'", ObjectPath: "/Game/X/Name.0"}` -> `/Game/X/Name.Name`
const refPath = (r) => {
  if (!r?.ObjectName || !r?.ObjectPath) return null
  const name = r.ObjectName.split("'")[1]?.split(":").pop()
  return `${r.ObjectPath.slice(0, r.ObjectPath.lastIndexOf("."))}.${name}`
}

// ------------------------------------------------------------------ paint (in-game picker)
// The level editor's "Paint" panel: MaterialCategories_Library lists PDA_MaterialCategory
// assets (smooth, rough, ...); each maps EBallestMaterialColors to one material. Category and
// colour names come from the enums' display names; the map order is the order the game lists them.
const PAINT_LIBRARY = "MaterialCategories_Library"
function paintOf(dump) {
  const exports = Object.values(dump.packages).flat()
  const byName = new Map(exports.map((e) => [e.Name, e]))
  const enumNames = (name) =>
    new Map((byName.get(name)?.Properties?.DisplayNameMap ?? []).map((kv) => [kv.Key, kv.Value.CultureInvariantString]))
  const categoryNames = enumNames("EBallestMaterialCategories")
  const colorNames = enumNames("EBallestMaterialColors")
  const enumKey = (v) => v?.split("::").pop()
  const library = byName.get(PAINT_LIBRARY)
  if (!library) throw new Error(`paint: ${PAINT_LIBRARY} not in the dump`)
  return library.Properties.BallestMaterialCategories.map((ref) => {
    const asset = byName.get(ref.ObjectName.split("'")[1])
    if (!asset) throw new Error(`paint: ${ref.ObjectName} not in the dump`)
    const p = asset.Properties
    // An unset byte enum is its first enumerator (MaterialCategory_Smooth stores none).
    const name = categoryNames.get(enumKey(p.MaterialCategory) ?? "NewEnumerator0")
    const display = new Map((p.ColorColorMap ?? []).map((kv) => [kv.Key, kv.Value]))
    return {
      name,
      colors: p.ColorMaterialMap.map((kv) => {
        const cls = kv.Value.ObjectName.split("'")[0]
        const path = refPath(kv.Value)
        const shown = display.get(kv.Key)
        return {
          color: colorNames.get(enumKey(kv.Key)),
          // class-qualified, as map files store it
          material: `/Script/Engine.${cls}'${path}'`,
          ...(shown ? { displayColor: [shown.R, shown.G, shown.B] } : {})
        }
      })
    }
  })
}
const paintDump = join(work, "paint-dump.json")
const paint = existsSync(paintDump) ? paintOf(readJson(paintDump)) : null

if (mode === "list") {
  const set = new Set()
  const add = (p) => p && p.startsWith("/") && set.add(p)
  for (const c of readJson(join(work, "samples.json")).classes) {
    for (const slot of Object.values(c.materials)) for (const p of Object.keys(slot)) add(p)
  }
  const cat = readJson(join(assets, "catalog.json"))
  const slots = (list) => (list ?? []).forEach((s) => (add(s.defaultMaterial), add(s.meshMaterial)))
  for (const p of cat.pieces) {
    slots(p.materialSlots)
    for (const x of p.extraMeshes ?? []) slots(x.materialSlots)
  }
  for (const m of cat.meshes) slots(m.materialSlots)
  for (const c of paint ?? []) for (const { material } of c.colors) add(material.split("'")[1])
  writeFileSync(join(work, "materials.txt"), [...set].sort().join("\n") + "\n")
  console.error(`[materials] ${set.size} referenced materials`)
  process.exit(0)
}

// ------------------------------------------------------------------ build
const dump = readJson(join(work, "materials-dump.json"))
const texPath = (p) => (p && dump.textures[p]?.png ? `textures/${dump.textures[p].png}` : null)
const color = (c) => (c ? [c.R, c.G, c.B, c.A ?? 1] : null)
const strip = (v) => (typeof v === "string" ? v.replace(/^[A-Za-z_]+::/, "") : v)

// Own (non-inherited) data of one asset.
function own(path) {
  const entry = dump.materials[path]
  if (!entry || entry.error) return { path, error: entry?.error ?? "not loaded" }
  const e = entry.export
  const p = e.Properties ?? {}
  const isInstance = /MaterialInstance/.test(e.Type)
  const o = {
    path,
    kind: isInstance ? "instance" : "material",
    type: e.Type,
    parent: refPath(p.Parent),
    scalars: {},
    vectors: {},
    textures: {},
    switches: {},
    errors: entry.errors,
    redirectedTo: entry.redirectedTo
  }
  if (isInstance) {
    for (const s of p.ScalarParameterValues ?? []) o.scalars[s.ParameterInfo.Name] = s.ParameterValue
    for (const s of p.VectorParameterValues ?? []) o.vectors[s.ParameterInfo.Name] = color(s.ParameterValue)
    for (const s of p.TextureParameterValues ?? []) o.textures[s.ParameterInfo.Name] = refPath(s.ParameterValue)
    for (const s of p.StaticParametersRuntime?.StaticSwitchParameters ?? []) {
      o.switches[s.ParameterInfo?.Name] = !!s.Value
    }
    const b = p.BasePropertyOverrides ?? {}
    if (b.bOverride_BlendMode) o.blendMode = strip(b.BlendMode ?? "BLEND_Opaque")
    if (b.bOverride_ShadingModel) o.shadingModel = strip(b.ShadingModel ?? "MSM_DefaultLit")
    if (b.bOverride_TwoSided) o.twoSided = !!b.TwoSided
    if (b.bOverride_OpacityMaskClipValue) o.opacityMaskClipValue = b.OpacityMaskClipValue
  } else {
    // Cooked UMaterial: no expression graph, but CachedExpressionData keeps the
    // parameter names (RuntimeEntries[type].ParameterInfoSet) and default values.
    const c = e.CachedExpressionData ?? {}
    const names = (i) =>
      (c[i === 0 ? "RuntimeEntries" : `RuntimeEntries[${i}]`]?.ParameterInfoSet ?? []).map((x) => x.Name)
    // EMaterialParameterType (5.8): 0 Scalar, 1 Vector, 2 DoubleVector, 3 Texture, ..., 8 StaticSwitch
    names(0).forEach((n, i) => (o.scalars[n] = c.ScalarValues?.[i] ?? null))
    names(1).forEach((n, i) => (o.vectors[n] = color(c.VectorValues?.[i])))
    names(3).forEach((n, i) => (o.textures[n] = refPath(c.TextureValues?.[i])))
    names(8).forEach((n, i) => (o.switches[n] = c.StaticSwitchValues?.[i] ?? null))
    o.blendMode = strip(p.BlendMode ?? "BLEND_Opaque")
    o.shadingModel = strip(p.ShadingModel ?? (p.ShadingModels ? "MSM_FromMaterialExpression?" : "MSM_DefaultLit"))
    o.twoSided = !!p.TwoSided
    if (p.OpacityMaskClipValue != null) o.opacityMaskClipValue = p.OpacityMaskClipValue
    o.hasCachedExpressionData = !!e.CachedExpressionData
    if (c.PropertyConnectedMask != null) o.connectedOutputs = connected(c.PropertyConnectedMask)
  }
  // Every texture the cooked export references (incl. textures sampled directly in
  // the graph, not exposed as parameters): CachedExpressionData.ReferencedTextures etc.
  o.referencedTextures = [...JSON.stringify(e).matchAll(/"ObjectName":"Texture[^']*'([^']+)'","ObjectPath":"([^"]+)"/g)]
    .map((m) => `${m[2].slice(0, m[2].lastIndexOf("."))}.${m[1].split(":").pop()}`)
  // TextureStreamingData: the UV multiplier each sampled texture is read with (texture name -> scale).
  // It is the only trace of the graph's UV tiling that survives cooking.
  o.textureScales = Object.fromEntries((p.TextureStreamingData ?? []).map((t) => [t.TextureName, t.SamplingScale]))
  // Material functions the graph calls: MF_Triplanar_* / WorldAligned* mean the textures are projected in
  // world space, not read through the mesh UVs.
  o.functions = (e.CachedExpressionData?.FunctionInfos ?? [])
    .map((f) => f.Function?.ObjectName?.split("'")[1])
    .filter(Boolean)
  return o
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
function connected(mask) {
  const out = []
  const m = BigInt(mask)
  MP.forEach((n, i) => (m >> BigInt(i)) & 1n && out.push(n))
  return out
}

const pick = (obj, patterns, exclude = /$^/) => {
  for (const re of patterns) {
    for (const [k, v] of Object.entries(obj)) if (re.test(k) && !exclude.test(k) && v != null) return [k, v]
  }
  return [null, null]
}
const linearToNum = (v) => (Array.isArray(v) ? v : null)

const records = []
const roots = readFileSync(join(work, "materials.txt"), "utf8").split("\n").filter(Boolean)
for (const path of roots) {
  const chainOwn = []
  for (let p = path, guard = 0; p && guard < 16; guard++) {
    const o = own(p)
    chainOwn.push(o)
    p = o.parent
  }
  const self = chainOwn[0]
  // Merge root -> leaf (instances only store overrides).
  const merged = { scalars: {}, vectors: {}, textures: {}, switches: {} }
  let blendMode = "BLEND_Opaque", shadingModel = "MSM_DefaultLit", twoSided = false
  for (const o of [...chainOwn].reverse()) {
    for (const k of ["scalars", "vectors", "textures", "switches"]) Object.assign(merged[k], o[k] ?? {})
    if (o.blendMode) blendMode = o.blendMode
    if (o.shadingModel) shadingModel = o.shadingModel
    if (o.twoSided != null) twoSided = o.twoSided
  }
  const root = chainOwn[chainOwn.length - 1]
  const recovered = !self.error &&
    Object.keys(merged.scalars).length + Object.keys(merged.vectors).length + Object.keys(merged.textures).length > 0

  // ---- approx PBR
  const S = merged.scalars, V = merged.vectors, T = merged.textures
  const conn = root.connectedOutputs ?? null
  const emissiveOnly = conn && conn.includes("EmissiveColor") && !conn.includes("BaseColor")
  const [bcKey, bc] = pick(V, [
    /^base ?colou?r$/i,
    /^(albedo|diffuse)( ?colou?r)?$/i,
    /^colou?r$/i,
    /^tint$/i,
    /base ?colou?r|albedo|diffuse/i,
    /colou?r ?glass|glass ?colou?r/i,
    /colou?r|tint/i
  ], /emiss|fresnel|edge|outline|light|grunge|highlight|angle|secondary|direction|noise|blend/i)
  const [metKey, met] = pick(S, [/^metal(lic)?$/i, /^metal(lic)?[ _]?(value|amount)?$/i], /mult|min|max|angle|mask/i)
  const [rouKey, rou] = pick(S, [
    /^roughness$/i,
    /^roughness[ _]?(value|amount)?$/i,
    /^roughness[ _]?(min|low)$/i,
    /rough/i
  ], /mult|max|high|contrast|offset|grunge|edge|angle|rain/i)
  const [opKey, op] = pick(S, [/^opacity$/i, /^opacity[ _]?(value|amount)?$/i, /opacity/i], /DT\d|detail|mask/i)
  // Not /light colou?r/ unanchored: it matched M_OutlineEdges' HighlightColor, an inactive highlight tint,
  // and painted every outlined face orange.
  const [emKey, em] = pick(V, [/emiss/i, /glow/i, /^light[ _]?colou?r$/i], /highlight/i)
  const [emiKey, emi] = pick(S, [
    /emm?iss?ive[ _]?(intensity|strength|power|mult|brightness)/i,
    /light[ _]?emissive[ _]?intensity/i,
    /glow[ _]?(intensity|strength)/i,
    /^(intensity|brightness)$/i
  ])
  const [bctKey, bct] = pick(T, [
    /^base ?colou?r( ?(map|tex(ture)?))?$/i,
    /^albedo$/i,
    /albedo|diffuse|base ?colou?r/i,
    /^(texture|tex|colou?r map)$/i
  ], /normal|rough|mask|detail|orm|rma|mra|emiss|grunge/i)
  const [nKey, nTex] = pick(T, [/^normal( ?map)?$/i, /normal/i], /detail|DT\d/i)
  // Packed occlusion/roughness/metallic masks only: match whole name tokens (ORM, RMA, MRA, ARM,
  // OcclusionRoughnessMetallic), never substrings (e.g. "N-orm-al"). Anything else -> null.
  const tokens = (k) => k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const [ormKey, orm] = Object.entries(T).find(([k, v]) =>
    v && !/normal/i.test(k) && tokens(k).some((t) =>
      ["orm", "rma", "mra", "arm", "occlusionroughnessmetallic"].includes(t)
    )
  ) ?? [null, null]
  const emissiveColor = em && em.slice(0, 3).some((x) => x > 0)
    ? em.slice(0, 3).map((x) => x * (typeof emi === "number" ? emi : 1))
    : null
  const isTranslucent = /Translucent|Additive|Modulate/.test(blendMode)

  // Textures the graph samples without exposing a parameter. The cooked material keeps the list
  // (ReferencedTextures) and each one's UV multiplier (TextureStreamingData) but not the wiring, so
  // what follows is name-based guessing, used only where no parameter answered above.
  const referenced = [...new Set(chainOwn.flatMap((o) => o.referencedTextures ?? []))]
  const scales = Object.assign({}, ...[...chainOwn].reverse().map((o) => o.textureScales ?? {}))
  const nameOf = (p) => p.split(".").pop()
  const scaleOf = (p) => (p && scales[nameOf(p)]) ?? 1
  const findRef = (re, exclude = /$^/) => referenced.find((p) => re.test(nameOf(p)) && !exclude.test(nameOf(p))) ?? null
  const switchedOff = (re) => Object.entries(merged.switches).some(([k, v]) => re.test(k) && v === false)
  const connects = (prop) => !conn || conn.includes(prop)
  // M_ArenaColorBase samples its concrete maps behind a `ConcreteValue` lerp, 0 in every instance seen.
  const concreteOff = Object.entries(S).some(([k, v]) => /concrete/i.test(k) && v === 0)
  // A normal map read straight from the graph (T_Concrete_Tiles_N, T_SmoothConcreteWall_N, Macro_N_normal).
  // An instance that switches tiles off (MI_Env_*_Smooth: UseTiles=false) gets no tile normal.
  const normalTex = nTex ??
    (connects("Normal") && !switchedOff(/normal map/i) && !concreteOff
      ? findRef(/(_N|_Normal|Normal)$/i, switchedOff(/tiles/i) ? /tile/i : /$^/)
      : null)
  // T_MacroVariation: a grey mottle the Ballest masters multiply into their base colour.
  const variationTex = connects("BaseColor") && !concreteOff ? findRef(/MacroVariation/i) : null
  // No colour parameter and no colour texture parameter: the graph reads a texture directly
  // (M_Metal_Steel's T_Metal_Steel_D, M_AirventBlock's slat gradient). Skip data/noise/VFX maps.
  const NOT_COLOR =
    /(_N|_Normal|Normal|_M|_R|Roughness|Metallic|Falloff)$|noise|mask|macro|ray|wind|dirt|perlin|cloud|grid/i
  const baseColorTex = bct ?? (bc == null && connects("BaseColor") ? findRef(/./, NOT_COLOR) : null)
  // Translucent effects (air-vent wind, light beams) shape their opacity with a streak/falloff texture.
  const opacityTex = isTranslucent && op == null ? findRef(/ray|falloff|gradient|beam|glow/i) : null
  const triplanar = chainOwn.some((o) => (o.functions ?? []).some((f) => /Triplanar|WorldAligned/i.test(f)))
  // M_OutlineEdges: a band of OutlineBase grey along the UV border, `Size` being the un-banded fraction.
  const outline = V.OutlineBase && S["Size X"] != null && S["Size Y"] != null
    ? { inset: [(1 - S["Size X"]) / 2, (1 - S["Size Y"]) / 2], color: V.OutlineBase.slice(0, 3) }
    : null
  const approx = {
    // Emissive-only masters (BaseColor pin unconnected) render black + emissive in UE.
    baseColor: emissiveOnly && emissiveColor ? [0, 0, 0] : (linearToNum(bc) ?? [0.8, 0.8, 0.8]).slice(0, 3),
    metallic: typeof met === "number" ? met : 0,
    roughness: typeof rou === "number" ? rou : 0.6,
    opacity: typeof op === "number" ? op : isTranslucent ? 0.5 : 1,
    emissive: emissiveColor,
    baseColorTexture: texPath(baseColorTex),
    normalTexture: texPath(normalTex),
    ormTexture: texPath(orm),
    variationTexture: texPath(variationTex),
    opacityTexture: texPath(opacityTex),
    // UV multiplier per texture (TextureStreamingData; 1 when unknown) and how UVs are made:
    // "uv" = the mesh's own, "triplanar" = world-space projection (MF_Triplanar_UVs / WorldAligned*).
    tiling: {
      baseColor: scaleOf(baseColorTex),
      normal: scaleOf(normalTex),
      variation: scaleOf(variationTex),
      opacity: scaleOf(opacityTex)
    },
    projection: triplanar ? "triplanar" : "uv",
    outline,
    keys: {
      baseColor: bcKey,
      metallic: metKey,
      roughness: rouKey,
      opacity: opKey,
      emissive: emKey,
      emissiveIntensity: emiKey,
      baseColorTexture: bctKey ?? (baseColorTex ? "referenced" : null),
      normalTexture: nKey ?? (normalTex ? "referenced" : null),
      ormTexture: ormKey
    }
  }
  records.push({
    path,
    kind: self.kind ?? null,
    parent: self.parent ?? null,
    chain: chainOwn.slice(1).map((o) => o.path),
    root: root.path,
    ...(self.redirectedTo ? { redirectedTo: self.redirectedTo } : {}),
    recovered,
    scalars: merged.scalars,
    vectors: merged.vectors,
    textures: Object.fromEntries(
      Object.entries(merged.textures).map(([k, v]) => [k, texPath(v) ?? (v ? `missing:${v}` : null)])
    ),
    switches: merged.switches,
    blendMode,
    shadingModel,
    twoSided,
    connectedOutputs: root.connectedOutputs ?? null,
    referencedTextures: referenced.map(texPath).filter(Boolean),
    approx,
    ...(chainOwn.some((o) => o.error || o.errors)
      ? {
        errors: chainOwn.filter((o) => o.error || o.errors).map((o) => ({
          path: o.path,
          error: o.error,
          parseErrors: o.errors
        }))
      }
      : {})
  })
}
records.sort((a, b) => a.path.localeCompare(b.path))
const texList = Object.entries(dump.textures).map(([p, t]) => ({
  path: p,
  png: t.png ? `textures/${t.png}` : null,
  width: t.width,
  height: t.height,
  compression: t.compression,
  sRGB: t.sRGB,
  format: t.format,
  bytes: t.bytes,
  error: t.error
}))
const out = {
  version: 1,
  notes: [
    "scalars/vectors/textures/switches are effective values: root UMaterial defaults (from CachedExpressionData) overridden by each instance down the chain.",
    "vectors are linear RGBA as stored by UE. baseColor/emissive in approx are linear; set three.js colors with Color.setRGB(r,g,b, THREE.LinearSRGBColorSpace) (or the default working space).",
    "approx is a heuristic: cooked UMaterials have no expression graph, so how parameters are combined (UV tiling, detail textures, fresnel, world-aligned textures, vertex colour) is unknown. approx.keys names the parameter each value came from (null = neutral default).",
    "Textures are PNG, largest mip <= --tex-max (2048) px. Normal maps had Z rebuilt from BC5 X/Y and keep UE's DirectX convention (green = -Y); in three.js use normalScale (1, -1) or flip G. sRGB flag per texture in `textures` (sRGB false => load with NoColorSpace).",
    "approx.tiling is each texture's UV multiplier from the cooked TextureStreamingData (1 when unknown); approx.projection is 'triplanar' for masters that call MF_Triplanar_*/WorldAligned* functions (sampled in world space, period unknown) and 'uv' otherwise. UV Scale / Tile scalars are listed but not applied.",
    "approx.variationTexture is the grey mottle (T_MacroVariation) the Ballest masters multiply into the base colour; approx.opacityTexture shapes a translucent effect's alpha; approx.outline is M_OutlineEdges' grey band along the UV border ({inset: [u, v] fraction, color}).",
    "paint is the in-game editor's material picker (MaterialCategories_Library): categories in the game's order, each with its colours and the class-qualified material a map file stores for that choice. displayColor (linear RGB) is the swatch colour where the game sets one explicitly (ColorColorMap)."
  ],
  materials: records,
  ...(paint ? { paint } : {}),
  textures: texList.sort((a, b) => a.path.localeCompare(b.path))
}
writeFileSync(join(assets, "materials.json"), JSON.stringify(out, null, 2) + "\n")
const withTex = records.filter((r) =>
  r.approx.baseColorTexture || r.approx.normalTexture ||
  Object.values(r.textures).some((t) => t && !t.startsWith("missing:"))
)
console.error(
  `[materials] ${records.length} materials, ${
    records.filter((r) => r.recovered).length
  } recovered, ${withTex.length} with textures, ${
    texList.filter((t) => t.png).length
  }/${texList.length} textures decoded`
)
