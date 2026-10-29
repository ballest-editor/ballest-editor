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
import { chainOf, type Merged, paramValueOf } from "./params.ts"
import { slotValue } from "./preshader.ts"
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
  if (dump === undefined) return null
  return yield* Effect.try({
    try: () => paintOf(dump),
    catch: (e) => (e instanceof MaterialsError ? e : new MaterialsError({ message: `paint: ${String(e)}` }))
  })
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
  /** Colour reads: what the read adds to the base colour going 0 -> 1 (from the evaluated surface); null = unknown. */
  readonly gain: readonly [number, number, number] | null
  /** The read's mean colour the surface was evaluated at (so colour = base + gain * (read - mean)). */
  readonly mean: readonly [number, number, number] | null
  /** Translucent passes: what the read adds to the alpha going 0 -> 1. */
  readonly alphaGain: number
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
const paramOf = (sh: MaterialShaders, merged: Merged, ref: string): number | undefined => {
  const buffer = sh.materialBuffer
  if (buffer === null || !ref.startsWith(buffer + "[")) return undefined
  const slot = sh.slots.find((s) => s.ref === ref.slice(buffer.length))
  if (slot === undefined) return undefined
  return slotValue(
    slot,
    sh.paramNames,
    (name) => paramValueOf(merged, name),
    (name) => merged.vectors[name] ?? undefined
  )
}

const readsOf = (
  sh: MaterialShaders,
  merged: Merged,
  textureOf: (i: number) => string | null,
  dump: unknown,
  translucent: boolean
): { reads: Array<Read>; index: Array<number> } => {
  const out: Array<Read> = []
  /** shader read index of each entry of `out` */
  const index: Array<number> = []
  for (const [ri, r] of sh.reads.entries()) {
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
          const v = paramOf(sh, merged, p)
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
    index.push(ri)
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
      unresolved: [...unresolved].sort(),
      gain: null,
      mean: null,
      alphaGain: 0
    })
  }
  return { reads: out, index }
}

// ------------------------------------------------------------------ build
/** JSON with objects indented but arrays of numbers / strings on one line: a third of the lines, same diffs. */
export const compactJson = (value: unknown, indent = ""): string => {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object" || v === null)) return JSON.stringify(value)
    return `[\n${value.map((v) => `${indent}  ${compactJson(v, indent + "  ")}`).join(",\n")}\n${indent}]`
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return "{}"
    return `{\n${
      entries.map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${compactJson(v, indent + "  ")}`).join(",\n")
    }\n${indent}}`
  }
  return value === undefined ? "null" : JSON.stringify(value)
}

/** shaders.json's materials, if the file is one this version wrote. */
const shaderMaterialsOf = (file: unknown): ShadersFile["materials"] => {
  if (get(file, "version") !== 1) return {}
  const materials = obj(get(file, "materials")) ?? {}
  return Object.fromEntries(
    Object.entries(materials).map(([k, v]) => [k, isMaterialShaders(v) ? v : { error: str(get(v, "error")) ?? "?" }])
  )
}
/** The mottle, with its gain evaluated for this instance's parameters: `colour *= 1 + gain * product(read + offset)`. */
const variationOf = (
  sh: MaterialShaders,
  merged: Merged,
  reads: ReadonlyArray<Read>,
  readIndex: ReadonlyArray<number>
) => {
  const mo = sh.mottle
  if (mo === null) return null
  const layers = mo.reads.map((i) => readIndex.indexOf(i)).map((i) => reads[i])
  if (layers.some((l) => l === undefined)) return null
  const paramValue = mo.gain.param === undefined ? 1 : paramOf(sh, merged, mo.gain.param)
  if (paramValue === undefined) return null
  const gain = mo.gain.sign * mo.gain.constant * (paramValue + (mo.gain.paramAdd ?? 0))
  const first = layers[0]
  if (first === undefined) return null
  return {
    texture: first.texture,
    tilings: layers.map((l) => l?.scale ?? [1, 1]),
    offsets: mo.offsets,
    gain
  }
}

const isMaterialShaders = (v: unknown): v is MaterialShaders =>
  typeof get(v, "pixel") === "string" && Array.isArray(get(v, "reads")) && Array.isArray(get(v, "textures")) &&
  Array.isArray(get(v, "paramNames"))

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

/**
 * Materials the cooked data cannot describe, by asset name, each a function of the instance's vectors.
 * M_PlasticBase mixes BaseColor_Dark and BaseColor_Light per 45/30/22.5 cm cell by a noise lookup whose
 * texture slot holds the engine's placeholder DefaultWhiteGrid in the cooked asset (the blueprint binds the
 * real one at runtime, so its GLSL program reads near-white and lands on the dark colour); the game shows
 * the light colour with faint darker cells.
 */
const OVERRIDES: Record<
  string,
  { readonly baseColor?: (vectors: Merged["vectors"]) => ReadonlyArray<number> | undefined }
> = {
  M_PlasticBase: { baseColor: (V) => V["BaseColor_Light"]?.slice(0, 3) }
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
      const { chain: chainOwn, self, root, merged, blendMode, shadingModel, twoSided } = chainOf(dump, materialPath)
      const recovered = self.error === undefined &&
        Object.keys(merged.scalars).length + Object.keys(merged.vectors).length + Object.keys(merged.textures).length >
          0
      const isTranslucent = /Translucent|Additive|Modulate/.test(blendMode)
      const name = nameOf(materialPath)

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
      const isAdditive = blendMode.includes("Additive")
      const [emiKey, emi] = pick(S, [
        /emm?iss?ive[ _]?(intensity|strength|power|mult|brightness)/i,
        /light[ _]?emissive[ _]?intensity/i,
        /glow[ _]?(intensity|strength)/i,
        /^(intensity|brightness)$/i
      ])
      const pickedEmissive = em?.slice(0, 3).some((x) => x > 0)
        ? em.slice(0, 3).map((x) => x * (emi ?? 1))
        : null

      // ---- textures, from the compiled shaders
      const sh = [
        shaderMaterials[materialPath],
        ...chainOwn.flatMap((o) => [o.path, ...(o.redirectedTo === undefined ? [] : [o.redirectedTo])]).map((p) =>
          shaderMaterials[p]
        )
      ].find((s): s is MaterialShaders => s !== undefined && !Object.hasOwn(s, "error"))
      // The surface evaluated from the compiled shader with this instance's parameters.
      const evaluated = sh?.surface ?? null
      // A translucent effect shows on the faces where its alpha (additive: its glow) is largest: the vertical
      // sides of a beam whose caps are masked by 1 - |world normal z|. upFade is what is left of that on a
      // face that looks up; the mask is a shape, kept even when the evaluated alpha is too faint to use.
      const alphaUp = evaluated?.opacity ?? null
      const alphaSide = evaluated?.opacitySide ?? alphaUp
      const alphaShown = alphaUp === null || alphaSide === null ? null : Math.max(alphaUp, alphaSide)
      const glowUp = Math.max(...(evaluated?.emissive ?? [0]))
      const glowSide = Math.max(...(evaluated?.emissiveSide ?? [0]))
      const glowShown = Math.max(glowUp, glowSide)
      // An additive pass adds its unlit scene colour: that is the glow, evaluated on the face that shows it.
      const emissiveColor = isAdditive && evaluated !== null && glowShown > 0
        ? glowSide > glowUp ? evaluated.emissiveSide : evaluated.emissive
        : pickedEmissive
      const upFade = isAdditive && glowShown > 0
        ? Math.min(1, glowUp / glowShown)
        : alphaSide !== null && alphaSide > (alphaUp ?? 0)
        ? Math.min(1, (alphaUp ?? 0) / alphaSide)
        : null
      const textureOf = (slot: number): string | null => {
        const t = sh?.textures[slot]
        if (t === undefined) return null
        const override = t.param === null ? undefined : merged.textures[t.param]
        return override ?? root.referencedTextures[t.index] ?? null
      }
      const traced: { reads: Array<Read>; index: Array<number> } = sh === undefined
        ? { reads: [], index: [] }
        : readsOf(sh, merged, textureOf, dump, isTranslucent)
      const reads = traced.reads.map((r, i) => {
        const g = evaluated?.gains[String(traced.index[i])]
        return g === undefined ? r : { ...r, gain: g.gain, mean: g.mean, alphaGain: g.alpha }
      })
      const variation = sh === undefined ? null : variationOf(sh, merged, reads, traced.index)
      if (sh !== undefined) withShaders++
      // Only reads whose coordinates are fully known can stand for a role.
      const byRole = (role: Role) => reads.filter((r) => r.role === role && r.unresolved.length === 0)
      // The main normal layer: strongest, then the coarsest (the Env masters add a fine x12 layer at full strength).
      const normals = byRole("normal").sort((a, b) => b.strength - a.strength || a.scale[0] - b.scale[0])
      const primary = (role: Role) => byRole(role)[0]
      // Colour layers: reads the evaluated surface says add to the base colour (gain != 0). Without an
      // evaluation (translucent passes) no colour texture is applied: the parameters alone are safer.
      const colorLayers = reads
        .filter((r) =>
          r.role !== "normal" && r.gain !== null && r.unresolved.length === 0 && r.gain.some((x) => Math.abs(x) >= 1e-4)
        )
        .sort((a, b) => Math.max(...(b.gain ?? [0]).map(Math.abs)) - Math.max(...(a.gain ?? [0]).map(Math.abs)))
      const normalRead = normals[0]
      const variationRead = primary("variation")
      const opacityRead = primary("opacity")
      const ormRead = primary("orm")
      const projection: Projection = (normalRead ?? colorLayers[0] ?? variationRead ?? opacityRead)?.projection ?? "uv"
      // M_OutlineEdges: a band of OutlineBase grey along the UV border, `Size` being the un-banded fraction.
      const outlineBase = V["OutlineBase"]
      const sizeX = S["Size X"], sizeY = S["Size Y"]
      const outline = outlineBase != null && sizeX != null && sizeY != null
        ? { inset: [(1 - sizeX) / 2, (1 - sizeY) / 2], color: outlineBase.slice(0, 3) }
        : null
      const tex = (r: Read | undefined) => (r === undefined ? null : texPath(r.texture))
      const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
      // The shader's own math as GLSL (alpha of a translucent pass, an additive glow, or an opaque base colour
      // whose reads the layers above could not place): what the renderer runs instead of the linearised look.
      const programs = Object.fromEntries(
        Object.entries(evaluated?.programs ?? {})
          // A base program only where the layers cannot place a read, and never for an overridden material: its
          // program runs the same math on the placeholder texture the override exists to work around.
          .filter(([kind]) =>
            kind !== "base" ||
            (OVERRIDES[name] === undefined && reads.some((r) => r.role !== "normal" && r.unresolved.length > 0))
          )
          .map(([kind, p]) => [kind, {
            code: p.code,
            textures: p.textures.map((t) => ({
              uniform: t.uniform,
              texture: texPath(textureOf(t.texture)) ?? `missing:${t.texture}`
            }))
          }])
      )
      const approx = {
        // The evaluated shader where there is one (opaque); else parameters picked by name. Emissive-only
        // masters (BaseColor pin unconnected) render black + emissive in UE.
        baseColor: OVERRIDES[name]?.baseColor?.(V) ?? (evaluated !== null && !(isAdditive && emissiveColor)
          ? evaluated.baseColor.map(clamp01)
          : (emissiveOnly || isAdditive) && emissiveColor
          ? [0, 0, 0]
          : (bc ?? [0.8, 0.8, 0.8, 1]).slice(0, 3)),
        metallic: evaluated?.metallic != null ? clamp01(evaluated.metallic) : met ?? 0,
        roughness: evaluated?.roughness != null ? clamp01(evaluated.roughness) : rou ?? 0.6,
        evaluated: evaluated !== null,
        // An additive pass is all glow (its alpha is 0): drawn at full strength, faded by upFade. A translucent
        // pass whose alpha vanishes on every face (a view-angle effect) keeps the parameter's opacity.
        opacity: isAdditive && emissiveColor
          ? 1
          : alphaShown !== null && alphaShown >= 0.02
          ? clamp01(alphaShown)
          : op ?? (isTranslucent ? 0.5 : 1),
        // 0..1: how much of the opacity (additive: the glow) is left on a face that looks up; null = all of it.
        upFade,
        emissive: emissiveColor,
        baseColorTexture: null,
        normalTexture: tex(normalRead),
        ormTexture: tex(ormRead),
        variationTexture: tex(variationRead),
        opacityTexture: tex(opacityRead),
        tiling: {
          baseColor: [1, 1],
          normal: normalRead?.scale ?? [1, 1],
          variation: variationRead?.scale ?? [1, 1],
          opacity: opacityRead?.scale ?? [1, 1]
        },
        projection,
        instanceScale: (normalRead ?? colorLayers[0])?.instanceScale ?? 0,
        // Translucent: texture reads the alpha depends on (alpha = opacity + sum alphaGain * (read - mean)). An
        // effect that multiplies sparse reads (ray streaks) swings far more where they all peak than any one
        // read's gain says: the strongest read carries the whole swing (alphaRange) if that is larger.
        opacityLayers: reads
          .filter((r) => r.role !== "normal" && r.unresolved.length === 0 && Math.abs(r.alphaGain) >= 1e-4)
          .sort((a, b) => Math.abs(b.alphaGain) - Math.abs(a.alphaGain))
          .map((r, i) => ({
            texture: texPath(r.texture) ?? `missing:${r.texture}`,
            tiling: r.scale,
            projection: r.projection,
            instanceScale: r.instanceScale,
            gain: i === 0 && evaluated?.alphaRange && r.alphaGain > 0
              ? Math.max(r.alphaGain, evaluated.alphaRange[1] - evaluated.alphaRange[0])
              : r.alphaGain,
            mean: r.mean === null ? 0.5 : r.mean[0]
          })),
        // Textures added to the base colour, each scaled by what the shader adds for it (colour = base + sum gain_i * read_i).
        // A base program computes the whole colour itself, layers and mottle included.
        colorLayers: (programs["base"] ? [] : colorLayers).map((r) => ({
          texture: texPath(r.texture) ?? `missing:${r.texture}`,
          tiling: r.scale,
          projection: r.projection,
          instanceScale: r.instanceScale,
          gain: r.gain,
          mean: r.mean
        })),
        // The mottle exactly as the shader applies it: colour *= 1 + gain * product_i(texture(tilings_i) + offsets_i).
        variation: variation === null || programs["base"]
          ? null
          : { ...variation, texture: texPath(variation.texture) ?? `missing:${variation.texture}` },
        outline,
        programs,
        // Which parameters the name-based picks used (translucent passes, emissive); null = neutral default.
        keys: {
          baseColor: evaluated === null ? bcKey : null,
          metallic: evaluated?.metallic == null ? metKey : null,
          roughness: evaluated?.roughness == null ? rouKey : null,
          opacity: alphaShown === null ? opKey : null,
          emissive: isAdditive && emissiveColor !== pickedEmissive ? null : emKey,
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
        "approx.baseColor/metallic/roughness are the compiled shader evaluated for the material's parameters and a facing view with every texture at its mean colour (approx.evaluated true); otherwise (translucent passes) parameters picked by name (approx.keys says which; null = neutral default). opacity/emissive are always picked by name.",
        "approx.colorLayers are the texture reads the base colour depends on: colour = baseColor + sum of gain * (read - mean); approx.opacityLayers the reads a translucent pass's alpha depends on, the same way (gain and mean from the evaluated shader; tiling is repeats per UV unit, or per cm when projected; instanceScale as for the normal map).",
        "approx.reads are the base-pass pixel shader's texture reads, traced through the compiled shader (tools/extract shaders): projection uv = mesh UV0 (scale in repeats per UV unit); object = object-aligned position, pivot at the object origin, rotating with the piece (scale in repeats per cm; instanceScale 1 = u, v also multiply by the piece's x, y scale); world. strength is a normal layer's blend strength. approx.*Texture/tiling/projection/instanceScale are the primary read per role; tiling is [u, v].",
        "Textures are PNG, largest mip <= --tex-max (2048) px. Normal maps had Z rebuilt from BC5 X/Y and keep UE's DirectX convention (green = -Y); in three.js use normalScale (1, -1) or flip G. sRGB flag per texture in `textures` (sRGB false => load with NoColorSpace).",
        "approx.variation is the grey mottle as the base pass applies it: colour *= 1 + gain * product over layers of (texture read at tilings[i] + offsets[i]); gain already includes the instance's parameter (ColorContrast - 1 for the Env masters).",
        "approx.outline is M_OutlineEdges' grey band along the UV border ({inset: [u, v] fraction, color}).",
        "approx.opacity is the evaluated alpha on the face that shows most (a beam masks its caps with 1 - |world normal z|: its sides); approx.upFade (0..1, null = 1) is the fraction left on a face that looks up. An additive pass renders as its evaluated glow (emissive, black base, opacity 1) faded the same way.",
        "approx.programs is the compiled shader's own output math as GLSL functions f(uv, worldNormal, objectPosition, time) with the instance's parameters folded in: alpha (a translucent pass's alpha, e.g. the vent's streaks for any frame via time), glow (an additive pass's unlit colour) and base (an opaque base colour whose texture reads the layers cannot place, e.g. the rubber block's cells); textures are the samplers the code reads (uTexN).",
        "A few materials cannot be read from the cooked data and are overridden by name (OVERRIDES in tools/extract/src/materials.ts): M_PlasticBase's cell noise samples the engine's placeholder texture, so its base colour is taken as BaseColor_Light, the colour the game shows.",
        "paint is the in-game editor's material picker (MaterialCategories_Library): categories in the game's order, each with its colours and the class-qualified material a map file stores for that choice. displayColor (linear RGB) is the swatch colour where the game sets one explicitly (ColorColorMap)."
      ],
      materials: records,
      ...(paint === null ? {} : { paint }),
      textures: texList.sort((a, b) => a.path.localeCompare(b.path))
    }
    yield* fs.writeFileString(path.join(assets, "materials.json"), compactJson(out) + "\n")
    const withTex = records.filter((r) =>
      arr(get(r, "approx", "colorLayers")).length > 0 || get(r, "approx", "normalTexture") !== null
    )
    yield* Effect.logInfo(
      `[materials] ${records.length} materials, ${
        records.filter((r) => r["recovered"] === true).length
      } recovered, ${withShaders} with shaders, ${withTex.length} with texture reads, ${
        texList.filter((t) => t.png !== null).length
      }/${texList.length} textures decoded`
    )
  }
)
