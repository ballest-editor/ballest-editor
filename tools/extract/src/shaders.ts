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
import { type Leaf, type Module, outputsOf, parseModule, samples } from "./dxil.ts"
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

export interface MaterialShaders {
  readonly pixel: string
  readonly vertex: string | null
  readonly textures: ReadonlyArray<{ readonly index: number; readonly param: string | null }>
  /** Material constant-buffer register in the pixel shader (`cb3`), so `params` refs can be matched to reads. */
  readonly materialBuffer: string | null
  readonly slots: ReadonlyArray<Slot>
  readonly reads: ReadonlyArray<TextureRead>
  /** Vertex-shader interpolants by `SEMANTIC.component`, each traced to its sources. */
  readonly interpolants: Record<string, ReadonlyArray<Leaf>>
}

export interface ShadersFile {
  readonly version: 1
  readonly notes: ReadonlyArray<string>
  readonly materials: Record<string, MaterialShaders | { readonly error: string }>
}

/** Material textures are the highest-numbered Texture2D SRVs: UE binds the Material uniform buffer last. */
const materialTextureRegisters = (m: Module, count: number): Array<number> =>
  m.srvs.filter((s) => s.kind === "Texture2D").map((s) => s.register).sort((a, b) => a - b).slice(-count)

export const shaders = Effect.fn("shaders")(function*(options: {
  readonly dump: string
  readonly out: string
  readonly dxc: string
}) {
  const fs = yield* FileSystem
  const path = yield* Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const index = yield* fs.readFileString(path.join(options.dump, "index.json")).pipe(Effect.flatMap(decodeIndex))
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
      const reads: Array<TextureRead> = samples(pixel.module).map((s) => ({
        texture: registers.indexOf(s.register),
        op: s.op,
        channels: s.channels,
        coords: s.coords.map((leaves) => ({ leaves })),
        resultFactor: s.resultFactor
      }))
      const interpolants: Record<string, ReadonlyArray<Leaf>> = {}
      for (const o of vertex?.outputs ?? []) interpolants[`${o.semantic}.${o.component}`] = o.leaves
      const bytes = Uint8Array.from(Buffer.from(ues.UniformPreshaderData.Data, "base64"))
      materials[material] = {
        pixel: pixel.shader.file,
        vertex: vertex?.shader.file ?? null,
        textures: textureParams.map((t) => ({
          index: t.TextureIndex,
          param: t.ParameterInfo.Name === "None" ? null : t.ParameterInfo.Name
        })),
        materialBuffer: materialCb === undefined ? null : `cb${materialCb.register}`,
        slots: decodePreshaders(bytes, ues.UniformPreshaders, ues.UniformNumericParameters),
        reads,
        interpolants
      }
      done++
      if (done % 20 === 0) yield* Effect.logInfo(`[shaders] ${done}/${entries.length}`)
    }), { concurrency: 4 })
  const file: ShadersFile = {
    version: 1,
    notes: [
      "Per material: the base-pass pixel shader's texture reads (`reads`, texture = index into `textures`, -1 = an engine texture) with each coordinate traced to its sources (`leaves`), and the vertex shader's outputs (`interpolants`) traced the same way.",
      "A leaf is one source the coordinate depends on linearly: kind input (vertex attribute ATTRIBUTEn in the vertex shader, interpolant TEXCOORDn / SV_Position in the pixel shader), buffer (vertex fetch: UVs), sceneData (the primitive/instance transform), param (constant buffer), texture, constant. factor = product of the literal constants on the path; params = constant-buffer values on the path; sceneDepth = transform rows multiplied in (1: local->world, 2: ...->object); sceneScale = multiplied (1) / divided (-1) by the instance scale.",
      "`textures[i].index` indexes the root material's ReferencedTextures; `param` names the texture parameter an instance may override. `slots` name the Material constant-buffer floats (`[reg].c`) by parameter (from the preshader bytecode) where the expression is a plain parameter read."
    ],
    materials
  }
  yield* fs.writeFileString(options.out, JSON.stringify(file, null, 2) + "\n")
  const ok = Object.values(materials).filter((m) => !Object.hasOwn(m, "error")).length
  yield* Effect.logInfo(`[shaders] ${ok}/${entries.length} materials analysed -> ${options.out}`)
})
