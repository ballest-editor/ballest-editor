// `shaders`: from the C# tool's shader dump (DIR/index.json + DIR/<asset>/*.dxil, one entry per material in
// the list) to WORK/shaders.json, the per-instance product `materials build` consumes. Per compiled base
// pass (`shaders`): the pixel shader's texture reads traced to their coordinate sources, the vertex shader's
// interpolants traced to vertex attributes / buffers / the object transform, the material's texture slots,
// and the constant-buffer slots named by the preshader. Per listed material, instances included
// (`materials`): which of those it runs and the surface evaluated for its own parameters. This is the
// deterministic replacement for guessing UV tiling from texture names and streaming data: the cooked
// material has no expression graph, but its compiled shader is the graph.
import { Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import { Path } from "effect/Path"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { type Leaf, type Module, type Mottle, mottleOf, outputsOf, parseModule, samples } from "./dxil.ts"
import { cfgOf, ENGINE_DEFAULTS, Evaluator, outputs, surfaceOf } from "./evaluate.ts"
import { emitProgram, type GlslEnv } from "./glsl.ts"
import { get, str } from "./json.ts"
import { chainOf, materialParams, slotTexture, type TextureSlot } from "./params.ts"
import { pngMean } from "./png.ts"
import { decodePreshaders, type Slot } from "./preshader.ts"

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

/** The trace of one compiled base pass: what every material running that shader shares. */
export interface ShaderTrace {
  readonly pixel: string
  readonly vertex: string | null
  readonly textures: ReadonlyArray<TextureSlot>
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
}

/**
 * The surface the shader produces for a material's parameters, seen head-on (opaque passes: GBuffer base
 * colour with colour reads at 0, metallic, roughness; `gains` = how much each read, by index into `reads`,
 * adds to the base colour at 1).
 */
export interface MaterialSurface {
  readonly baseColor: readonly [number, number, number]
  /** Opaque passes only (GBuffer); null for a translucent pass. */
  readonly metallic: number | null
  readonly roughness: number | null
  /** Translucent passes: the alpha written for a surface facing up; null for opaque. */
  /** GBuffer D as stored (rgba): the shading model's custom data; null when the pass writes none. */
  readonly customData: readonly [number, number, number, number] | null
  /** GBuffer D with the Perlin noise at its extreme instead of its mean; null without a noise read. */
  readonly customDataBare: readonly [number, number, number, number] | null
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
   * (the unlit colour of a translucent or additive pass) or `base` (opaque: the GBuffer base colour); textures by material texture index.
   */
  readonly programs: Partial<Record<"alpha" | "glow" | "base", GlslProgramRef>>
  /**
   * By read index: the colour (and, translucent, alpha) the read adds going 0 -> 1, and the mean it was evaluated
   * at; `fromAlpha`, where the read's alpha alone moves the colour, how much (a mask packed in the alpha).
   */
  readonly gains: Record<string, ReadGain>
}

export interface ReadGain {
  readonly gain: readonly [number, number, number]
  readonly alpha: number
  readonly mean: readonly [number, number, number]
  readonly fromAlpha?: readonly [number, number, number]
  /** How far the read turns the surface's normal, 1 = a full-strength normal map (opaque passes). */
  readonly normal?: number
}

/** A listed material's trace with the surface evaluated for its own parameters: what `materials build` works from. */
export interface MaterialShaders extends ShaderTrace {
  /** Null when the shader's outputs could not be evaluated. */
  readonly surface: MaterialSurface | null
}

export interface GlslProgramRef {
  readonly code: string
  readonly textures: ReadonlyArray<{ readonly uniform: string; readonly texture: number }>
}

export interface MaterialEntry {
  /** The trace the material runs: a key of `ShadersFile.shaders` (itself, or the first ancestor with a shader map). */
  readonly shader: string
  readonly surface: MaterialSurface | null
}

export interface ShadersFile {
  readonly version: 2
  readonly notes: ReadonlyArray<string>
  /** By material the C# tool dumped shaders for (the roots, and the instances with their own shader map). */
  readonly shaders: Record<string, ShaderTrace | { readonly error: string }>
  /** By listed material, instances included: the per-instance product. */
  readonly materials: Record<string, MaterialEntry>
}

const isAnalysed = (e: ShaderTrace | { readonly error: string }): e is ShaderTrace => !Object.hasOwn(e, "error")

/** A texture read as `materialTextureRegisters` needs it: the register, and whether it is decoded as a normal map. */
interface RegisterRead {
  readonly register: number
  readonly normal: boolean
}

/** The ways to pick `size` of the slots 0..count-1, the first slots first (so the last ones are left out first). */
const subsets = (count: number, size: number, from = 0): ReadonlyArray<ReadonlyArray<number>> =>
  size === 0
    ? [[]]
    : Array.from({ length: count - from }, (_, i) => from + i)
      .flatMap((first) => subsets(count, size - 1, first + 1).map((rest) => [first, ...rest]))

/**
 * The register of each material texture slot, -1 for one the compiler left out. Material textures are the
 * highest-numbered Texture2D SRVs (UE binds the Material uniform buffer last), but only those this pixel shader uses
 * are bound: a parameter it does not read leaves no register, and the registers close up. The shader says which were
 * dropped only through its reads, so a slot's register is the one that fits: a read decoded as a normal map (`* 2 - 1`)
 * lands on a normal map, and among equal fits the last slots are the ones left out.
 */
export const materialTextureRegisters = (
  m: Pick<Module, "srvs">,
  count: number,
  reads: ReadonlyArray<RegisterRead>,
  slotIsNormal: (slot: number) => boolean
): ReadonlyArray<number> => {
  if (count === 0) return []
  const top = m.srvs.filter((s) => s.kind === "Texture2D").map((s) => s.register).sort((a, b) => a - b).slice(-count)
  const read = new Set(reads.map((r) => r.register))
  const firstRead = top.findIndex((r) => read.has(r))
  const bound = firstRead < 0 ? top : top.slice(firstRead)
  if (bound.length === count) return top
  const normal = new Set(reads.filter((r) => r.normal).map((r) => r.register))
  const fit = (slots: ReadonlyArray<number>) =>
    bound.filter((register, i) => normal.has(register) === slotIsNormal(slots[i] ?? -1)).length
  const best = subsets(count, bound.length).reduce((a, b) => (fit(b) > fit(a) ? b : a))
  return Array.from({ length: count }, (_, slot) => {
    const i = best.indexOf(slot)
    return i < 0 ? -1 : bound[i] ?? -1
  })
}

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
    {
      module: Module
      ir: string
      sampleValues: ReadonlyArray<string>
      perlin: ReadonlyArray<string>
      mottle: ReadonlyArray<string>
      registers: ReadonlyArray<number>
    }
  >()
  const disassemble = Effect.fn("disassemble")(function*(file: string) {
    const full = path.join(options.dump, `${file}.dxil`)
    return yield* spawner.string(ChildProcess.make(options.dxc, ["-dumpbin", full]))
  })
  const traces: Record<string, ShaderTrace | { error: string }> = {}
  let done = 0
  const entries = Object.entries(index)
  yield* Effect.forEach(entries, ([material, entry]) =>
    Effect.gen(function*() {
      const map = entry.shaderMaps?.find((m) => m.error === undefined && m.shaders !== undefined)
      if (map?.shaders === undefined || map.compilationOutput === undefined) {
        traces[material] = { error: entry.error ?? map?.error ?? "no shader map" }
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
        traces[material] = { error: "no base-pass pixel shader" }
        return
      }
      // The vertex shader of the same vertex factory with the most outputs feeds the pixel shader's interpolants.
      const vertex = modules
        .filter((m) => m.shader.frequency === "SF_Vertex" && m.shader.vertexFactory === pixel.shader.vertexFactory)
        .map((m) => ({ ...m, outputs: outputsOf(m.ir, m.module) }))
        .sort((a, b) => b.outputs.length - a.outputs.length)[0]
      const textureParams = ues.UniformTextureParameters[0] ?? []
      const pixelSamples = samples(pixel.module)
      const root = chainOf(dump, material)
      const registers = materialTextureRegisters(
        pixel.module,
        textureParams.length,
        // Level reads are the engine's (lighting volumes, fog), also where one lands among the top registers.
        pixelSamples.filter((s) => s.op !== "sampleLevel").map((s) => ({
          register: s.register,
          normal: s.resultFactor === 2
        })),
        (slot) => {
          const param = textureParams[slot]
          const texture = param === undefined ? null : slotTexture(root, {
            index: param.TextureIndex,
            param: param.ParameterInfo.Name === "None" ? null : param.ParameterInfo.Name
          })
          return texture !== null && str(get(dump, "textures", texture, "compression")) === "TC_Normalmap"
        }
      )
      const materialCb = pixel.module.cbuffers.find((c) => c.type === "Material")
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
        perlin: pixelSamples.filter((s) => s.perlin).map((s) => s.value),
        mottle: mottle?.samples ?? [],
        registers
      })
      traces[material] = {
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
          traces[material] = { error: `disassemble: ${String(e)}` }
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
  const materials: Record<string, MaterialEntry> = {}
  let evaluated = 0
  for (const material of list) {
    const chain = chainOf(dump, material)
    const key = chain.chain.flatMap((o) => [o.path, ...(o.redirectedTo === undefined ? [] : [o.redirectedTo])])
      .find((p) => pixels.has(p))
    const px = key === undefined ? undefined : pixels.get(key)
    const base = key === undefined ? undefined : traces[key]
    if (key === undefined || px === undefined || base === undefined || !isAnalysed(base)) continue
    const cbuf = materialParams("Material", base, chain.merged)
    const mottle = new Set(px.mottle)
    const colour = px.sampleValues.filter((v) => !mottle.has(v))
    // each sample's texture mean: the texture slot it reads, through the instance's overrides
    const means = new Map<string, readonly [number, number, number, number]>()
    for (const [i, v] of px.sampleValues.entries()) {
      const read = base.reads[i]
      const texture = read === undefined ? null : slotTexture(chain, base.textures[read.texture])
      const mean = texture === null ? null : yield* meanOf(texture)
      if (mean !== null) means.set(v, mean)
    }
    // Engine textures read 1: custom stencil / depth lookups that gate the level editor's ghost modes (the plain,
    // placed state), the fog's transmittance, and the translucency lighting volumes (an additive glow is lit: its
    // colour is its base colour under that ambient). The Perlin volume reads its mean instead: it stores gradients and
    // a bias around 127/255, so that is noise 0 (at 1 the noise sits at an extreme, and the ice's frost reads as bare).
    // Material textures without a decodable mean read mid-grey.
    const engine = new Set(px.sampleValues.filter((_, i) => (base.reads[i]?.texture ?? -1) < 0))
    const perlin = new Set(px.perlin)
    const sampleMean = (v: string, ch: number) =>
      means.get(v)?.[ch] ?? (perlin.has(v) ? 127 / 255 : engine.has(v) ? 1 : 0.5)
    const surface = surfaceOf(px.module, px.ir, cbuf, sampleMean, colour)
    const bareMean = (v: string, ch: number) => (perlin.has(v) ? 1 : sampleMean(v, ch))
    const bare = perlin.size === 0 ? null : surfaceOf(px.module, px.ir, cbuf, bareMean, colour)
    // The output chains as GLSL: what the renderer runs where the linearised layers fall short.
    const { registers } = px
    const bc5 = new Set<number>()
    for (const [i, register] of registers.entries()) {
      const texture = slotTexture(chain, base.textures[i])
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
      materialTextures: new Set(registers.filter((r) => r >= 0)),
      bc5,
      isTime: (ref) => ref === "View[167].z"
    }
    const program = (
      name: string,
      roots: ReadonlyArray<string | undefined>,
      samplerPrefix?: string
    ): GlslProgramRef | undefined => {
      if (roots.some((r) => r === undefined)) return undefined
      const env = samplerPrefix === undefined ? glslEnv : { ...glslEnv, samplerPrefix }
      const p = emitProgram(px.module, env, name, roots.map((r) => r ?? "0.0"))
      if (p.textures.length === 0) return undefined
      // A division by a folded zero: the math needs something only a frame has (the light beams' scene depth).
      if (p.code.includes("/ 0.0)")) return undefined
      return {
        code: p.code,
        textures: p.textures.map((t) => ({ uniform: t.uniform, texture: registers.indexOf(t.register) }))
      }
    }
    const opaque = surface?.metallic !== null
    const additive = chain.blendMode.includes("Additive")
    const programs: Partial<Record<"alpha" | "glow" | "base", GlslProgramRef>> = {}
    const alphaProgram = !opaque && !additive ? program("ballestAlpha", [outs.get("0.w")]) : undefined
    // The scene colour with no lights: all an additive pass draws, and what a translucent one's emissive adds to
    // its lit base colour (the vent's air, the checkpoint's bars). It runs beside the alpha, so its own samplers.
    const glowProgram = opaque
      ? undefined
      : program("ballestGlow", ["0.x", "0.y", "0.z"].map((k) => outs.get(k)), "uGlowTex")
    const baseProgram = opaque ? program("ballestBase", ["3.x", "3.y", "3.z"].map((k) => outs.get(k))) : undefined
    if (alphaProgram) programs.alpha = alphaProgram
    if (glowProgram) programs.glow = glowProgram
    if (baseProgram) programs.base = baseProgram
    const gains: Record<string, ReadGain> = {}
    for (const [v, gain] of Object.entries(surface?.gains ?? {})) {
      const alpha = surface?.alphaGains[v] ?? 0
      const normal = surface?.normalGains[v] ?? 0
      if (gain.every((x) => Math.abs(x) < 1e-4) && Math.abs(alpha) < 1e-4 && Math.abs(normal) < 1e-4) continue
      const m = means.get(v) ?? [0.5, 0.5, 0.5, 1]
      const fromAlpha = surface?.alphaColorGains[v]
      gains[String(px.sampleValues.indexOf(v))] = {
        gain,
        alpha,
        mean: [m[0], m[1], m[2]],
        ...(fromAlpha?.some((x) => Math.abs(x) >= 1e-4) ? { fromAlpha } : {}),
        ...(Math.abs(normal) >= 1e-4 ? { normal } : {})
      }
    }
    materials[material] = {
      shader: key,
      // A translucent pass with no lit diffuse term is all emissive: its base colour is black.
      surface: surface === null || (opaque && surface.baseColor === null) ? null : {
        baseColor: surface.baseColor ?? [0, 0, 0],
        metallic: surface.metallic,
        roughness: surface.roughness,
        customData: surface.customData,
        customDataBare: bare?.customData ?? null,
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
    version: 2,
    notes: [
      "`shaders`, per material the C# tool dumped shaders for (the roots and the instances with their own shader map): the base-pass pixel shader's texture reads (`reads`, texture = index into `textures`, -1 = an engine texture) with each coordinate traced to its sources (`leaves`), and the vertex shader's outputs (`interpolants`) traced the same way. `materials`, per listed material (instances included): the trace it runs (`shader`, a key of `shaders`: itself or its first ancestor with one) and its `surface`.",
      "A leaf is one source the coordinate depends on linearly: kind input (vertex attribute ATTRIBUTEn in the vertex shader, interpolant TEXCOORDn / SV_Position in the pixel shader), buffer (vertex fetch: UVs), sceneData (the primitive/instance transform), param (constant buffer), texture, constant. factor = product of the literal constants on the path; params = constant-buffer values on the path; sceneDepth = transform rows multiplied in (1: local->world, 2: ...->object); sceneScale = multiplied (1) / divided (-1) by the instance scale.",
      "`surface` is the shader evaluated for this material's parameters and a facing view, every texture read at its mean colour: base colour (the GBuffer's for opaque passes, the lit diffuse term for translucent ones), metallic and roughness (opaque), opacity (translucent; opacitySide for a vertical face, alphaRange with every read at 0 / 1, emissiveSide the unlit colour of a vertical face), and per read index the colour / alpha the read adds going 0 -> 1 (gain) around the mean it was evaluated at (fromAlpha: the colour its alpha channel alone adds, where it adds any).",
      "`mottle` is the grey-mottle chain where the base pass has one: reads (indices) offset by `offsets`, multiplied together, times `gain` (sign * constant * (param + paramAdd)) and added to 1, multiplying the base colour.",
      "`textures[i].index` indexes the root material's ReferencedTextures; `param` names the texture parameter an instance may override. `slots` name the Material constant-buffer floats (`[reg].c`) by parameter (from the preshader bytecode) where the expression is a plain parameter read."
    ],
    shaders: traces,
    materials
  }
  yield* fs.writeFileString(options.out, JSON.stringify(file, null, 2) + "\n")
  const ok = Object.values(traces).filter(isAnalysed).length
  yield* Effect.logInfo(`[shaders] ${ok}/${entries.length} shader maps traced -> ${options.out}`)
})
