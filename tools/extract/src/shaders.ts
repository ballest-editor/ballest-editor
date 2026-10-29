// `shaders`: from the C# tool's shader dump (DIR/index.json + DIR/<asset>/*.dxil, one entry per material in
// the list) to WORK/shaders.json: for every material, the base-pass pixel shader's texture reads traced to
// their coordinate sources, the vertex shader's interpolants traced to vertex attributes / buffers / the
// object transform, the material's texture slots, and the constant-buffer slots named by the preshader.
// This is the deterministic replacement for guessing UV tiling from texture names and streaming data: the
// cooked material has no expression graph, but its compiled shader is the graph.
import { Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { type Leaf, type Module, type Mottle, mottleOf, outputsOf, parseModule, samples } from "./dxil.ts"
import { cfgOf, ENGINE_DEFAULTS, Evaluator, outputs, surfaceOf } from "./evaluate.ts"
import { emitProgram, type GlslEnv } from "./glsl.ts"
import { get, str } from "./json.ts"
import { chainOf, paramValueOf } from "./params.ts"
import { pngMean } from "./png.ts"
import { decodePreshaders, type Slot, slotValue } from "./preshader.ts"

const ShaderRecord = Schema.Struct({
  file: Schema.String,
  frequency: Schema.String,
  vertexFactory: Schema.String,
  size: Schema.Finite,
  dxil: Schema.optionalKey(Schema.Finite)
})
const Preshader = Schema.Struct({
  Type: Schema.String,
  BufferOffset: Schema.Finite,
  OpcodeOffset: Schema.Finite,
  OpcodeSize: Schema.Finite
})
const TextureParameter = Schema.Struct({
  TextureIndex: Schema.Finite,
  ParameterInfo: Schema.Struct({ Name: Schema.String })
})
const NumericParameter = Schema.Struct({
  ParameterInfo: Schema.Struct({ Name: Schema.String }),
  ParameterType: Schema.String
})
const UniformExpressionSet = Schema.Struct({
  UniformPreshaders: Schema.Array(Preshader),
  UniformNumericParameters: Schema.Array(NumericParameter),
  UniformTextureParameters: Schema.Array(Schema.Array(TextureParameter)),
  UniformPreshaderData: Schema.Struct({ Data: Schema.String })
})
const ShaderMap = Schema.Struct({
  platform: Schema.String,
  error: Schema.optionalKey(Schema.String),
  compilationOutput: Schema.optionalKey(Schema.Struct({ UniformExpressionSet })),
  shaders: Schema.optionalKey(Schema.Array(ShaderRecord))
})
const IndexEntry = Schema.Struct({
  error: Schema.optionalKey(Schema.String),
  shaderMaps: Schema.optionalKey(Schema.Array(ShaderMap))
})
export const ShaderIndex = Schema.Record(Schema.String, IndexEntry)
const decodeIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(ShaderIndex))

export class ShaderToolError extends Schema.TaggedError<ShaderToolError>()("ShaderToolError", {
  message: Schema.String
}) {}

export interface Coordinate {
  readonly leaves: ReadonlyArray<Leaf>
}

export interface TextureRead {
  /** Index into `textures` (the material's 2D texture slots), -1 for an engine texture. */
  readonly texture: number
  readonly op: string
  readonly channels: string
  readonly coords: ReadonlyArray<Coordinate>
  readonly resultFactor: number | null
}

export interface MaterialShaders {
  readonly pixel: string
  readonly vertex: string | null
  readonly textures: ReadonlyArray<{ readonly index: number; readonly param: string | null }>
  /** Material constant-buffer register in the pixel shader (`cb3`), so `params` refs can be matched to reads. */
  readonly materialBuffer: string | null
  readonly slots: ReadonlyArray<Slot>
  /** The uniform numeric parameters by index, as the slot programs refer to them. */
  readonly paramNames: ReadonlyArray<string>
  readonly reads: ReadonlyArray<TextureRead>
  /** The mottle chain (`1 + gain * product(read + offset)`) over `reads` indices, if the shader has one. */
  readonly mottle: {
    readonly reads: ReadonlyArray<number>
    readonly offsets: ReadonlyArray<number>
    readonly gain: Mottle["gain"]
  } | null
  /** Vertex-shader interpolants by `SEMANTIC.component`, each traced to its sources. */
  readonly interpolants: Record<string, ReadonlyArray<Leaf>>
  /**
   * The surface the shader produces for this material's parameters, seen head-on (opaque passes: GBuffer
   * base colour with colour reads at 0, metallic, roughness; `gains` = how much each read, by index into
   * `reads`, adds to the base colour at 1). Null when not evaluated (translucent passes).
   */
  readonly surface: {
    readonly baseColor: readonly [number, number, number]
    /** Opaque passes only (GBuffer); null for a translucent pass. */
    readonly metallic: number | null
    readonly roughness: number | null
    /** Translucent passes: the alpha written for a surface facing up; null for opaque. */
    readonly opacity: number | null
    /** Translucent passes: the alpha for a vertical surface (a beam masks its caps with 1 - |world normal z|). */
    readonly opacitySide: number | null
    /** Translucent passes: the alpha with every material read at 0 and at 1, on the side that shows. */
    readonly alphaRange: readonly [number, number] | null
    /** Scene colour with no lights (facing up, and for a vertical surface): what an additive glow adds. */
    readonly emissive: readonly [number, number, number]
    readonly emissiveSide: readonly [number, number, number]
    /**
     * The shader's own math as GLSL, with this instance's parameters folded in: `alpha` (translucent), `glow`
     * (additive: the unlit colour) or `base` (opaque: the GBuffer base colour); textures by material texture index.
     */
    readonly programs: Partial<Record<"alpha" | "glow" | "base", GlslProgramRef>>
    /** By read index: the colour (and, translucent, alpha) the read adds going 0 -> 1, and the mean it was evaluated at. */
    readonly gains: Record<
      string,
      {
        readonly gain: readonly [number, number, number]
        readonly alpha: number
        readonly mean: readonly [number, number, number]
      }
    >
  } | null
}

export interface GlslProgramRef {
  readonly code: string
  readonly textures: ReadonlyArray<{ readonly uniform: string; readonly texture: number }>
}

export interface ShadersFile {
  readonly version: 1
  readonly notes: ReadonlyArray<string>
  readonly materials: Record<string, MaterialShaders | { readonly error: string }>
}

const isAnalysed = (e: MaterialShaders | { readonly error: string }): e is MaterialShaders => !Object.hasOwn(e, "error")

/** Material textures are the highest-numbered Texture2D SRVs: UE binds the Material uniform buffer last. */
const materialTextureRegisters = (m: Module, count: number): Array<number> =>
  m.srvs.filter((s) => s.kind === "Texture2D").map((s) => s.register).sort((a, b) => a - b).slice(-count)

export const shaders = Effect.fn("shaders")(function*(options: {
  readonly dump: string
  readonly out: string
  readonly dxc: string
  /** WORK/materials-dump.json: parameter values, to evaluate each material's surface. */
  readonly materials: string
  /** WORK/materials.txt: the materials to evaluate (instances included). */
  readonly list: string
  /** WORK/textures: the decoded PNGs, read at their mean colour during evaluation. */
  readonly textures: string
}) {
  const fs = yield* FileSystem
  const path = yield* Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const index = yield* fs.readFileString(path.join(options.dump, "index.json")).pipe(Effect.flatMap(decodeIndex))
  const dump: unknown = JSON.parse(yield* fs.readFileString(options.materials))
  const list = (yield* fs.readFileString(options.list)).split("\n").filter((l) => l !== "")
  /** the analysed pixel shader of each material entry, kept for the per-instance evaluation */
  const pixels = new Map<
    string,
    { module: Module; ir: string; sampleValues: ReadonlyArray<string>; mottle: ReadonlyArray<string> }
  >()
  const disassemble = Effect.fn("disassemble")(function*(file: string) {
    const full = path.join(options.dump, `${file}.dxil`)
    return yield* spawner.string(ChildProcess.make(options.dxc, ["-dumpbin", full]))
  })
  const materials: Record<string, MaterialShaders | { error: string }> = {}
  let done = 0
  const entries = Object.entries(index)
  yield* Effect.forEach(entries, ([material, entry]) =>
    Effect.gen(function*() {
      const map = entry.shaderMaps?.find((m) => m.error === undefined && m.shaders !== undefined)
      if (map?.shaders === undefined || map.compilationOutput === undefined) {
        materials[material] = { error: entry.error ?? map?.error ?? "no shader map" }
        return
      }
      const ues = map.compilationOutput.UniformExpressionSet
      const candidates = map.shaders.filter((s) => s.dxil !== undefined)
      const modules = yield* Effect.forEach(
        candidates,
        (s) => disassemble(s.file).pipe(Effect.map((ir) => ({ shader: s, ir, module: parseModule(ir) }))),
        { concurrency: 4 }
      )
      const pixel = modules
        .filter((m) => m.shader.frequency === "SF_Pixel" && m.module.cbuffers.some((c) => c.type.includes("BasePass")))
        .sort((a, b) => b.shader.size - a.shader.size)[0]
      if (pixel === undefined) {
        materials[material] = { error: "no base-pass pixel shader" }
        return
      }
      // The vertex shader of the same vertex factory with the most outputs feeds the pixel shader's interpolants.
      const vertex = modules
        .filter((m) => m.shader.frequency === "SF_Vertex" && m.shader.vertexFactory === pixel.shader.vertexFactory)
        .map((m) => ({ ...m, outputs: outputsOf(m.ir, m.module) }))
        .sort((a, b) => b.outputs.length - a.outputs.length)[0]
      const textureParams = ues.UniformTextureParameters[0] ?? []
      const registers = materialTextureRegisters(pixel.module, textureParams.length)
      const materialCb = pixel.module.cbuffers.find((c) => c.type === "Material")
      const pixelSamples = samples(pixel.module)
      const mottle = mottleOf(pixel.module)
      const reads: Array<TextureRead> = pixelSamples.map((s) => ({
        texture: registers.indexOf(s.register),
        op: s.op,
        channels: s.channels,
        coords: s.coords.map((leaves) => ({ leaves })),
        resultFactor: s.resultFactor
      }))
      const interpolants: Record<string, ReadonlyArray<Leaf>> = {}
      for (const o of vertex?.outputs ?? []) interpolants[`${o.semantic}.${o.component}`] = o.leaves
      const bytes = Uint8Array.from(Buffer.from(ues.UniformPreshaderData.Data, "base64"))
      pixels.set(material, {
        module: pixel.module,
        ir: pixel.ir,
        sampleValues: pixelSamples.map((s) => s.value),
        mottle: mottle?.samples ?? []
      })
      materials[material] = {
        surface: null,
        pixel: pixel.shader.file,
        vertex: vertex?.shader.file ?? null,
        textures: textureParams.map((t) => ({
          index: t.TextureIndex,
          param: t.ParameterInfo.Name === "None" ? null : t.ParameterInfo.Name
        })),
        materialBuffer: materialCb === undefined ? null : `cb${materialCb.register}`,
        slots: decodePreshaders(bytes, ues.UniformPreshaders, ues.UniformNumericParameters),
        paramNames: ues.UniformNumericParameters.map((p) => p.ParameterInfo.Name),
        reads,
        mottle: mottle === null ? null : {
          reads: mottle.samples.map((v) => pixelSamples.findIndex((s) => s.value === v)),
          offsets: mottle.offsets,
          gain: mottle.gain
        },
        interpolants
      }
      done++
      if (done % 20 === 0) yield* Effect.logInfo(`[shaders] ${done}/${entries.length}`)
    }).pipe(
      // One shader dxc cannot read must not take the other materials down with it.
      Effect.catch((e) =>
        Effect.sync(() => {
          materials[material] = { error: `disassemble: ${String(e)}` }
        })
      )
    ), { concurrency: 4 })
  // Texture means (linear), by texture object path.
  const meanCache = new Map<string, readonly [number, number, number, number] | null>()
  const meanOf = Effect.fn("meanOf")(function*(texturePath: string) {
    const cached = meanCache.get(texturePath)
    if (cached !== undefined) return cached
    const info = get(dump, "textures", texturePath)
    const png = str(get(info, "png"))
    let mean: readonly [number, number, number, number] | null = null
    if (png !== undefined) {
      const bytes = yield* fs.readFile(path.join(options.textures, png)).pipe(Effect.orElseSucceed(() => null))
      mean = bytes === null ? null : pngMean(bytes, get(info, "sRGB") !== false)?.mean ?? null
      // A BC5 normal map samples as (x, y, 0, 1) on the GPU; the PNG has Z rebuilt, which the shader never sees.
      if (mean !== null && (str(get(info, "format")) ?? "").startsWith("PF_BC5")) mean = [mean[0], mean[1], 0, 1]
    }
    meanCache.set(texturePath, mean)
    return mean
  })
  // Every listed material, instances included: its parameters through its (or its parent's) shader.
  let evaluated = 0
  for (const material of list) {
    const chain = chainOf(dump, material)
    const key = chain.chain.flatMap((o) => [o.path, ...(o.redirectedTo === undefined ? [] : [o.redirectedTo])])
      .find((p) => pixels.has(p))
    const px = key === undefined ? undefined : pixels.get(key)
    const entry = key === undefined ? undefined : materials[key]
    if (px === undefined || entry === undefined || !isAnalysed(entry)) continue
    const base = entry
    const slots = new Map(base.slots.map((sl) => [sl.ref, sl]))
    const cbuf = (ref: string): number | undefined => {
      if (!ref.startsWith("Material[")) return undefined
      const slot = slots.get(ref.slice("Material".length))
      if (slot === undefined) return undefined
      return slotValue(
        slot,
        base.paramNames,
        (name) => paramValueOf(chain.merged, name),
        (name) => chain.merged.vectors[name] ?? undefined
      )
    }
    const mottle = new Set(px.mottle)
    const colour = px.sampleValues.filter((v) => !mottle.has(v))
    // each sample's texture mean: the texture slot it reads, through the instance's overrides
    const means = new Map<string, readonly [number, number, number, number]>()
    for (const [i, v] of px.sampleValues.entries()) {
      const read = base.reads[i]
      const slot = read === undefined || read.texture < 0 ? undefined : base.textures[read.texture]
      if (slot === undefined) continue
      const override = slot.param === null ? undefined : chain.merged.textures[slot.param]
      const texture = override ?? chain.root.referencedTextures[slot.index] ?? null
      const mean = texture === null ? null : yield* meanOf(texture)
      if (mean !== null) means.set(v, mean)
    }
    // Engine textures (custom stencil / depth lookups that gate the level editor's ghost modes) read 1: the
    // plain, placed state. Material textures without a decodable mean read mid-grey.
    const engine = new Set(px.sampleValues.filter((_, i) => (base.reads[i]?.texture ?? -1) < 0))
    const sampleMean = (v: string, ch: number) => means.get(v)?.[ch] ?? (engine.has(v) ? 1 : 0.5)
    const surface = surfaceOf(px.module, px.ir, cbuf, sampleMean, colour)
    // The output chains as GLSL: what the renderer runs where the linearised layers fall short.
    const registers = materialTextureRegisters(px.module, base.textures.length)
    const bc5 = new Set<number>()
    for (const [i, register] of registers.entries()) {
      const slot = base.textures[i]
      const override = slot?.param == null ? undefined : chain.merged.textures[slot.param]
      const texture = slot === undefined ? null : override ?? chain.root.referencedTextures[slot.index] ?? null
      const format = texture === null ? undefined : str(get(dump, "textures", texture, "format"))
      if ((format ?? "").startsWith("PF_BC5")) bc5.add(register)
    }
    const outs = outputs(px.module, px.ir)
    const glslEnv: GlslEnv = {
      evaluator: new Evaluator(px.module, {
        cbuf: (ref) => cbuf(ref) ?? ENGINE_DEFAULTS[ref],
        sample: sampleMean,
        cfg: cfgOf(px.ir)
      }),
      materialTextures: new Set(registers),
      bc5,
      isTime: (ref) => ref === "View[167].z"
    }
    const program = (name: string, roots: ReadonlyArray<string | undefined>): GlslProgramRef | undefined => {
      if (roots.some((r) => r === undefined)) return undefined
      const p = emitProgram(px.module, glslEnv, name, roots.map((r) => r ?? "0.0"))
      if (p.textures.length === 0) return undefined
      return {
        code: p.code,
        textures: p.textures.map((t) => ({ uniform: t.uniform, texture: registers.indexOf(t.register) }))
      }
    }
    const opaque = surface?.metallic !== null
    const additive = chain.blendMode.includes("Additive")
    const programs: Partial<Record<"alpha" | "glow" | "base", GlslProgramRef>> = {}
    const alphaProgram = !opaque && !additive ? program("ballestAlpha", [outs.get("0.w")]) : undefined
    const glowProgram = additive ? program("ballestGlow", ["0.x", "0.y", "0.z"].map((k) => outs.get(k))) : undefined
    const baseProgram = opaque ? program("ballestBase", ["3.x", "3.y", "3.z"].map((k) => outs.get(k))) : undefined
    if (alphaProgram) programs.alpha = alphaProgram
    if (glowProgram) programs.glow = glowProgram
    if (baseProgram) programs.base = baseProgram
    const gains: Record<
      string,
      { gain: readonly [number, number, number]; alpha: number; mean: readonly [number, number, number] }
    > = {}
    for (const [v, gain] of Object.entries(surface?.gains ?? {})) {
      const alpha = surface?.alphaGains[v] ?? 0
      if (gain.every((x) => Math.abs(x) < 1e-4) && Math.abs(alpha) < 1e-4) continue
      const m = means.get(v) ?? [0.5, 0.5, 0.5, 1]
      gains[String(px.sampleValues.indexOf(v))] = { gain, alpha, mean: [m[0], m[1], m[2]] }
    }
    materials[material] = {
      ...base,
      surface: surface?.baseColor == null ? null : {
        baseColor: surface.baseColor,
        metallic: surface.metallic,
        roughness: surface.roughness,
        opacity: surface.opacity,
        opacitySide: surface.opacitySide,
        alphaRange: surface.alphaRange,
        emissive: surface.emissive,
        emissiveSide: surface.emissiveSide,
        programs,
        gains
      }
    }
    evaluated++
  }
  yield* Effect.logInfo(`[shaders] ${evaluated}/${list.length} materials evaluated`)
  const file: ShadersFile = {
    version: 1,
    notes: [
      "Per material: the base-pass pixel shader's texture reads (`reads`, texture = index into `textures`, -1 = an engine texture) with each coordinate traced to its sources (`leaves`), and the vertex shader's outputs (`interpolants`) traced the same way.",
      "A leaf is one source the coordinate depends on linearly: kind input (vertex attribute ATTRIBUTEn in the vertex shader, interpolant TEXCOORDn / SV_Position in the pixel shader), buffer (vertex fetch: UVs), sceneData (the primitive/instance transform), param (constant buffer), texture, constant. factor = product of the literal constants on the path; params = constant-buffer values on the path; sceneDepth = transform rows multiplied in (1: local->world, 2: ...->object); sceneScale = multiplied (1) / divided (-1) by the instance scale.",
      "`surface` is the shader evaluated for this material's parameters and a facing view, every texture read at its mean colour: base colour (the GBuffer's for opaque passes, the lit diffuse term for translucent ones), metallic and roughness (opaque), opacity (translucent; opacitySide for a vertical face, alphaRange with every read at 0 / 1, emissiveSide the unlit colour of a vertical face), and per read index the colour / alpha the read adds going 0 -> 1 (gain) around the mean it was evaluated at.",
      "`mottle` is the grey-mottle chain where the base pass has one: reads (indices) offset by `offsets`, multiplied together, times `gain` (sign * constant * (param + paramAdd)) and added to 1, multiplying the base colour.",
      "`textures[i].index` indexes the root material's ReferencedTextures; `param` names the texture parameter an instance may override. `slots` name the Material constant-buffer floats (`[reg].c`) by parameter (from the preshader bytecode) where the expression is a plain parameter read."
    ],
    materials
  }
  yield* fs.writeFileString(options.out, JSON.stringify(file, null, 2) + "\n")
  const ok = Object.values(materials).filter((m) => !Object.hasOwn(m, "error")).length
  yield* Effect.logInfo(`[shaders] ${ok}/${entries.length} materials analysed -> ${options.out}`)
})
