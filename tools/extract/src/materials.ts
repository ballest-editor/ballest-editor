// `materials list|build`.
//   list  WORK ASSETS -> WORK/materials.txt (union of sample, catalog and paint materials)
//   build WORK ASSETS -> ASSETS/materials.json from WORK/materials-dump.json (+ paint-dump.json, shaders.json)
// Parameters come from the cooked assets (instances override their parents down the chain). How textures are
// read (which UV space, at what scale, how strongly) comes from the compiled shaders (shaders.json), not from
// texture names or streaming estimates.
import { Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { approxOf, layersOf, type Override, picksOf, type TextureInfo, translucencyOf } from "./approx.ts"
import { arr, bool, get, type JsonObject, nameOf, num, obj, refPath, str } from "./json.ts"
import { chainOf } from "./params.ts"
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
const isMaterialShaders = (v: unknown): v is MaterialShaders =>
  typeof get(v, "pixel") === "string" && Array.isArray(get(v, "reads")) && Array.isArray(get(v, "textures")) &&
  Array.isArray(get(v, "paramNames"))

/**
 * Materials the cooked data cannot describe, by asset name, each a function of the instance's vectors.
 * M_PlasticBase mixes BaseColor_Dark and BaseColor_Light per 45/30/22.5 cm cell by a noise lookup whose
 * texture slot holds the engine's placeholder DefaultWhiteGrid in the cooked asset (the blueprint binds the
 * real one at runtime, so its GLSL program reads near-white and lands on the dark colour); the game shows
 * the light colour with faint darker cells.
 */
const OVERRIDES: Record<string, Override> = {
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
    const textureInfo = (p: string): TextureInfo => ({
      compression: str(get(dump, "textures", p, "compression")),
      sRGB: bool(get(dump, "textures", p, "sRGB"))
    })
    const roots = (yield* fs.readFileString(path.join(work, "materials.txt"))).split("\n").filter((l) => l !== "")
    const records: Array<JsonObject> = []
    let withShaders = 0
    for (const materialPath of roots) {
      const { chain: chainOwn, self, root, merged, blendMode, shadingModel, twoSided } = chainOf(dump, materialPath)
      const recovered = self.error === undefined &&
        Object.keys(merged.scalars).length + Object.keys(merged.vectors).length + Object.keys(merged.textures).length >
          0
      const name = nameOf(materialPath)
      // The compiled shader's trace, evaluated for this instance's parameters (shaders.json).
      const sh = [
        shaderMaterials[materialPath],
        ...chainOwn.flatMap((o) => [o.path, ...(o.redirectedTo === undefined ? [] : [o.redirectedTo])]).map((p) =>
          shaderMaterials[p]
        )
      ].find((s): s is MaterialShaders => s !== undefined && !Object.hasOwn(s, "error"))
      if (sh !== undefined) withShaders++
      const evaluated = sh?.surface ?? null
      const textureOf = (slot: number): string | null => {
        const t = sh?.textures[slot]
        if (t === undefined) return null
        const override = t.param === null ? undefined : merged.textures[t.param]
        return override ?? root.referencedTextures[t.index] ?? null
      }
      const picks = picksOf(merged, root.connectedOutputs ?? null)
      const translucency = translucencyOf(blendMode, evaluated, picks.pickedEmissive)
      const layers = layersOf(sh, merged, textureOf, textureInfo, translucency.translucent)
      const approx = approxOf({
        merged,
        evaluated,
        picks,
        translucency,
        layers,
        override: OVERRIDES[name],
        texPath,
        textureOf
      })
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
