// Emits a pixel shader's output chain as GLSL, for the renderer to run the game's own material math:
// everything that depends on the fragment (UVs, the world normal, the object-space position, the
// material's texture reads, the game time) is emitted as code; everything else (parameters, engine
// constants, scene data for a piece at the origin) is folded to the number the Evaluator gives it.
import {
  BINARY_OPS,
  FCMP_OPS,
  ICMP_OPS,
  type Instruction,
  instructionOf,
  INT_BINARY_OPS,
  INT_OPS,
  type Module,
  parseFloat,
  UNARY_OPS
} from "./dxil.ts"
import { bufferNames, type Evaluator } from "./evaluate.ts"

export interface GlslProgram {
  /** A GLSL function `<returnType> <name>(vec2 uv, vec3 nrm, vec3 pos, float time)`. */
  readonly code: string
  /** The material texture registers the code samples, as `uTexN` samplers. */
  readonly textures: ReadonlyArray<{ readonly uniform: string; readonly register: number }>
  /** How many instructions the emitter had to fold because it does not understand them, and which. */
  readonly unsupported: number
  readonly unsupportedOps: ReadonlyArray<string>
}

export interface GlslEnv {
  readonly evaluator: Evaluator
  /** Material texture registers (anything else is an engine texture, read at its folded value). */
  readonly materialTextures: ReadonlySet<number>
  /** Registers whose texture is BC5 (two channels: z reads 0, w reads 1 on the GPU). */
  readonly bc5: ReadonlySet<number>
  /** A constant-buffer reference (`View[167].z`) that is the game time. */
  readonly isTime: (ref: string) => boolean
}

const XYZW = ["x", "y", "z", "w"] as const

/** A finite float as a GLSL literal (`1.0`, `2.5e-7`). */
export const glslFloat = (n: number): string => {
  if (!Number.isFinite(n)) return "0.0"
  const s = String(n)
  return /[.e]/.test(s) ? (s.includes("e") && !s.includes(".") ? s.replace("e", ".0e") : s) : `${s}.0`
}

type Input = Extract<Instruction, { kind: "input" }>
type Sample = Extract<Instruction, { kind: "sample" }>

class Emitter {
  readonly #m: Module
  readonly #env: GlslEnv
  readonly #dynamic = new Map<string, boolean>()
  readonly #names = new Map<string, string>()
  readonly #handles: ReadonlyMap<string, string>
  readonly statements: Array<string> = []
  readonly textures = new Map<number, string>()
  unsupported = 0
  readonly unsupportedOps: Array<string> = []

  constructor(m: Module, env: GlslEnv) {
    this.#m = m
    this.#env = env
    this.#handles = bufferNames(m)
  }

  #at(v: string): Instruction | undefined {
    return instructionOf(this.#m, v)
  }

  /** The GLSL for a fragment input, or undefined for one the renderer does not provide (folded). */
  #inputExpr(i: Input): string | undefined {
    const sig = this.#m.inputs.find((x) => x.id === i.id)
    if (sig === undefined) return undefined
    const index = sig.indices[i.row] ?? 0
    const c = XYZW[i.component] ?? "x"
    if (sig.name === "TEXCOORD" && index === 0 && i.component < 2) return `uv.${c}`
    // UE's world position interpolant, and the one it rebuilds from SV_Position (identity, see ENGINE_DEFAULTS).
    if (sig.name === "TEXCOORD" && index === 9 && i.component < 3) return `pos.${c}`
    if (sig.name === "SV_Position") return i.component < 3 ? `pos.${c}` : "1.0"
    if (sig.name.startsWith("TEXCOORD11") && i.component < 3) return `nrm.${c}`
    return undefined
  }

  #sampleRegister(s: Sample): number | undefined {
    return this.#m.handles.get(s.handle)?.register
  }

  #cbufRef(load: Extract<Instruction, { kind: "cbuffer" }>, ch: number): string {
    return `${this.#handles.get(load.handle) ?? "?"}[${load.index}].${XYZW[ch] ?? "x"}`
  }

  /** Whether the value changes across the surface (then it is emitted; otherwise folded). */
  dynamic(v: string): boolean {
    if (this.#dynamic.size === 0) this.#computeDynamic()
    return this.#dynamic.get(v) ?? false
  }

  /**
   * The values that change across the surface: the fragment inputs the renderer provides, the material
   * texture reads and the game time, and everything computed from them (a fixpoint over the SSA graph,
   * which has cycles through phis).
   */
  #computeDynamic(): void {
    const users = new Map<string, Array<string>>()
    const worklist: Array<string> = []
    const mark = (v: string) => {
      if (this.#dynamic.get(v) === true) return
      this.#dynamic.set(v, true)
      worklist.push(v)
    }
    for (const [v, d] of this.#m.defs) {
      const operands = [...d.matchAll(/%[\w.]+/g)].map((o) => o[0]).filter((o) => o !== v && !o.startsWith("%dx."))
      for (const o of operands) users.set(o, [...(users.get(o) ?? []), v])
      const i = this.#at(v)
      if (i === undefined) continue
      if (i.kind === "input") {
        if (this.#inputExpr(i) !== undefined) mark(v)
      } else if (i.kind === "sample") {
        const register = this.#sampleRegister(i)
        if (register !== undefined && this.#env.materialTextures.has(register)) mark(v)
      } else if (i.kind === "extract") {
        const agg = this.#at(i.aggregate)
        if (agg?.kind === "cbuffer" && this.#env.isTime(this.#cbufRef(agg, i.channel))) mark(v)
      }
    }
    // Buffer and constant loads are static whatever indexes them (the instance id, an engine stencil read).
    const isLoad = (u: string) => {
      const kind = this.#at(u)?.kind
      return kind === "rawLoad" || kind === "cbuffer" || kind === "bufferLoad" ||
        (this.#m.defs.get(u) ?? "").includes("@dx.op.textureLoad")
    }
    for (let v = worklist.pop(); v !== undefined; v = worklist.pop()) {
      for (const u of users.get(v) ?? []) if (!isLoad(u)) mark(u)
    }
    if (this.#dynamic.size === 0) this.#dynamic.set("", false)
  }

  #phiEntry(v: string): string | undefined {
    return this.#env.evaluator.phiEntry(v)
  }

  #fold(v: string): string {
    return glslFloat(this.#env.evaluator.value(v))
  }

  /** The GLSL expression (a `uint` temporary, or a literal) for an i32 SSA value (hashes, cell ids). */
  intExpr(v: string): string {
    const literal = Number(v)
    if (Number.isInteger(literal)) return `${literal >>> 0}u`
    if (!this.dynamic(v)) return `${this.#env.evaluator.int(v) >>> 0}u`
    const named = this.#names.get(v)
    if (named !== undefined) return named
    const body = this.#emitInt(v)
    if (/^[\w.]+$/.test(body)) {
      this.#names.set(v, body)
      return body
    }
    const name = `i${v.slice(1).replace(".", "_")}`
    this.#names.set(v, name)
    this.statements.push(`uint ${name} = ${body};`)
    return name
  }

  #emitInt(v: string): string {
    const i = this.#at(v)
    switch (i?.kind) {
      case "toInt":
        return i.signed ? `uint(int(${this.expr(i.x)}))` : `uint(${this.expr(i.x)})`
      case "bitcast":
        if (i.to === "i32") return `floatBitsToUint(${this.expr(i.x)})`
        break
      case "int": {
        const op = INT_OPS[i.op]
        if (op !== undefined) return op.glsl(this.intExpr(i.a), this.intExpr(i.b))
        break
      }
      case "ibinary": {
        const op = INT_BINARY_OPS[i.op]
        if (op !== undefined) return op.glsl(this.intExpr(i.a), this.intExpr(i.b))
        break
      }
      case "select":
        if (i.type === "i32") return `(${this.#bool(i.cond)} ? ${this.intExpr(i.a)} : ${this.intExpr(i.b)})`
        break
      case "phi": {
        const entry = this.#phiEntry(v)
        return entry === undefined ? "0u" : this.intExpr(entry)
      }
      default:
        break
    }
    this.unsupported++
    this.unsupportedOps.push((this.#m.defs.get(v) ?? v).slice(0, 60))
    return `${this.#env.evaluator.int(v) >>> 0}u`
  }

  /** The GLSL expression (a temporary's name, or a literal) for a float SSA value. */
  expr(v: string): string {
    const literal = parseFloat(v)
    if (literal !== undefined) return glslFloat(literal)
    if (!this.dynamic(v)) return this.#fold(v)
    const named = this.#names.get(v)
    if (named !== undefined) return named
    const body = this.#emit(v)
    // An alias of an input, a temporary or a literal needs no temporary of its own.
    if (/^[\w.]+$/.test(body)) {
      this.#names.set(v, body)
      return body
    }
    const name = `t${v.slice(1).replace(".", "_")}`
    this.#names.set(v, name)
    this.statements.push(`float ${name} = ${body};`)
    return name
  }

  #emit(v: string): string {
    const i = this.#at(v)
    switch (i?.kind) {
      case "input":
        return this.#inputExpr(i) ?? this.#unsupported(v)
      case "extract": {
        const agg = this.#at(i.aggregate)
        if (agg?.kind === "sample") {
          const register = this.#sampleRegister(agg)
          // An engine texture (scene depth, stencil) read at a fragment-dependent place still folds.
          if (register === undefined || !this.#env.materialTextures.has(register)) return this.#fold(v)
          if (this.#env.bc5.has(register) && i.channel >= 2) return i.channel === 2 ? "0.0" : "1.0"
          return `${this.#sample(i.aggregate, agg, register)}.${XYZW[i.channel] ?? "x"}`
        }
        // Scene data and the other constant buffers fold (a piece at the origin); only the game time is live.
        return agg?.kind === "cbuffer" && this.#env.isTime(this.#cbufRef(agg, i.channel)) ? "time" : this.#fold(v)
      }
      case "float": {
        const a = this.expr(i.a), b = this.expr(i.b)
        // The folded scene data leaves many `x * 0.0` and `x + 0.0` behind: drop them here, not in the shader.
        switch (i.op) {
          case "fmul":
            return a === "0.0" || b === "0.0" ? "0.0" : a === "1.0" ? b : b === "1.0" ? a : `(${a} * ${b})`
          case "fadd":
            return a === "0.0" ? b : b === "0.0" ? a : `(${a} + ${b})`
          case "fsub":
            return b === "0.0" ? a : `(${a} - ${b})`
          default:
            return b === "1.0" ? a : `(${a} / ${b})`
        }
      }
      case "unary": {
        const op = UNARY_OPS[i.op]
        return op === undefined ? this.#unsupported(v) : op.glsl(this.expr(i.x))
      }
      case "binary": {
        const op = BINARY_OPS[i.op]
        return op === undefined ? this.#unsupported(v) : op.glsl(this.expr(i.a), this.expr(i.b))
      }
      case "mad": {
        const a = this.expr(i.a), b = this.expr(i.b), c = this.expr(i.c)
        const product = a === "0.0" || b === "0.0" ? "0.0" : a === "1.0" ? b : b === "1.0" ? a : `${a} * ${b}`
        return product === "0.0" ? c : c === "0.0" ? `(${product})` : `(${product} + ${c})`
      }
      case "dot": {
        const ops = i.operands.map((o) => this.expr(o))
        const terms: Array<string> = []
        for (let k = 0; k < i.n; k++) {
          const a = ops[k] ?? "0.0", b = ops[k + i.n] ?? "0.0"
          if (a === "0.0" || b === "0.0") continue
          terms.push(a === "1.0" ? b : b === "1.0" ? a : `${a} * ${b}`)
        }
        return terms.length === 0 ? "0.0" : terms.length === 1 ? terms[0] ?? "0.0" : `(${terms.join(" + ")})`
      }
      case "select":
        if (i.type === "float") return `(${this.#bool(i.cond)} ? ${this.expr(i.a)} : ${this.expr(i.b)})`
        break
      case "phi": {
        const entry = this.#phiEntry(v)
        return entry === undefined ? "0.0" : this.expr(entry)
      }
      case "toFloat":
        return i.signed ? `float(int(${this.intExpr(i.x)}))` : `float(${this.intExpr(i.x)})`
      case "bitcast":
        if (i.to === "float") return `uintBitsToFloat(${this.intExpr(i.x)})`
        break
      default:
        break
    }
    return this.#unsupported(v)
  }

  #sample(v: string, s: Sample, register: number): string {
    const named = this.#names.get(v)
    if (named !== undefined) return named
    const u = this.expr(s.coords[0]), w = this.expr(s.coords[1])
    let uniform = this.textures.get(register)
    if (uniform === undefined) {
      uniform = `uTex${this.textures.size}`
      this.textures.set(register, uniform)
    }
    const name = `s${v.slice(1).replace(".", "_")}`
    this.#names.set(v, name)
    this.statements.push(`vec4 ${name} = texture2D(${uniform}, vec2(${u}, ${w}));`)
    return name
  }

  #bool(v: string): string {
    const i = this.#at(v)
    if (i === undefined) return v === "true" ? "true" : "false"
    if (!this.dynamic(v)) {
      const b = this.#env.evaluator.bool(v)
      return b === undefined ? "false" : String(b)
    }
    switch (i.kind) {
      case "fcmp": {
        const op = FCMP_OPS[i.pred]
        return op === undefined ? this.#unsupportedBool(v) : op.glsl(this.expr(i.a), this.expr(i.b))
      }
      case "logic":
        return `(${this.#bool(i.a)} ${i.op === "and" ? "&&" : "||"} ${this.#bool(i.b)})`
      case "icmp": {
        const op = ICMP_OPS[i.pred]
        return op === undefined ? this.#unsupportedBool(v) : op.glsl(this.intExpr(i.a), this.intExpr(i.b))
      }
      default:
        return this.#unsupportedBool(v)
    }
  }

  #unsupported(v: string): string {
    this.unsupported++
    this.unsupportedOps.push((this.#m.defs.get(v) ?? v).slice(0, 60))
    return this.#fold(v)
  }

  #unsupportedBool(v: string): string {
    this.unsupported++
    const b = this.#env.evaluator.bool(v)
    return b === undefined ? "false" : String(b)
  }
}

/**
 * `roots` (one float for a `float` function, three for a `vec3`) as a GLSL function `name(vec2 uv, vec3 nrm,
 * vec3 pos, float time)`: uv = the mesh UV0, nrm = the world normal (UE frame, z up), pos = the object-space
 * position in cm (the piece's own scale applied), time = the game time in seconds.
 */
export const emitProgram = (
  m: Module,
  env: GlslEnv,
  name: string,
  roots: ReadonlyArray<string>
): GlslProgram => {
  const e = new Emitter(m, env)
  const results = roots.map((r) => e.expr(r))
  const ret = results.length === 1 ? results[0] ?? "0.0" : `vec3(${results.join(", ")})`
  const type = results.length === 1 ? "float" : "vec3"
  const code = [
    `${type} ${name}(vec2 uv, vec3 nrm, vec3 pos, float time) {`,
    ...e.statements.map((s) => `  ${s}`),
    `  return ${ret};`,
    "}"
  ].join("\n")
  return {
    code,
    textures: [...e.textures].map(([register, uniform]) => ({ uniform, register })),
    unsupported: e.unsupported,
    unsupportedOps: e.unsupportedOps
  }
}
