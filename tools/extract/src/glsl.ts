// Emits a pixel shader's output chain as GLSL, for the renderer to run the game's own material math:
// everything that depends on the fragment (UVs, the world normal, the object-space position, the
// material's texture reads, the game time) is emitted as code; everything else (parameters, engine
// constants, scene data for a piece at the origin) is folded to the number the Evaluator gives it.
import { type Module, parseFloat } from "./dxil.ts"
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

const num = (s: string | undefined) => Number.parseInt(s ?? "", 10)
const g = (m: RegExpMatchArray, i: number): string => m[i] ?? ""
const XYZW = ["x", "y", "z", "w"] as const

/** A finite float as a GLSL literal (`1.0`, `2.5e-7`). */
export const glslFloat = (n: number): string => {
  if (!Number.isFinite(n)) return "0.0"
  const s = String(n)
  return /[.e]/.test(s) ? (s.includes("e") && !s.includes(".") ? s.replace("e", ".0e") : s) : `${s}.0`
}

const UNARY: Record<string, (x: string) => string> = {
  "6": (x) => `abs(${x})`,
  "7": (x) => `clamp(${x}, 0.0, 1.0)`,
  "12": (x) => `cos(${x})`,
  "13": (x) => `sin(${x})`,
  "15": (x) => `tan(${x})`,
  "21": (x) => `exp(${x})`,
  "22": (x) => `fract(${x})`,
  "23": (x) => `log(${x})`,
  "24": (x) => `sqrt(${x})`,
  "25": (x) => `inversesqrt(${x})`,
  "26": (x) => `floor(${x} + 0.5)`,
  "27": (x) => `floor(${x})`,
  "28": (x) => `ceil(${x})`,
  "29": (x) => `(${x} < 0.0 ? ceil(${x}) : floor(${x}))`,
  // DerivCoarseX / DerivCoarseY (texture bombing and mip selection)
  "83": (x) => `dFdx(${x})`,
  "84": (x) => `dFdy(${x})`
}
const BINARY: Record<string, (a: string, b: string) => string> = {
  "35": (a, b) => `max(${a}, ${b})`,
  "36": (a, b) => `min(${a}, ${b})`
}
const CMP: Record<string, string> = {
  olt: "<",
  ult: "<",
  ole: "<=",
  ule: "<=",
  ogt: ">",
  ugt: ">",
  oge: ">=",
  uge: ">=",
  oeq: "==",
  ueq: "==",
  one: "!=",
  une: "!="
}

const ICMP: Record<string, string> = {
  eq: "==",
  ne: "!=",
  ult: "<",
  ule: "<=",
  ugt: ">",
  uge: ">=",
  slt: "<",
  sle: "<=",
  sgt: ">",
  sge: ">="
}

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

  #input(d: string): { readonly sig: string; readonly index: number; readonly component: number } | undefined {
    const li = d.match(/loadInput\.f32\(i32 \d+, i32 (\d+), i32 (\d+), i8 (\d+)/)
    if (!li) return undefined
    const sig = this.#m.inputs.find((x) => x.id === num(li[1]))
    if (sig === undefined) return undefined
    return { sig: sig.name, index: sig.indices[num(li[2])] ?? 0, component: num(li[3]) }
  }

  /** The GLSL for a fragment input, or undefined for one the renderer does not provide (folded). */
  #inputExpr(d: string): string | undefined {
    const i = this.#input(d)
    if (i === undefined) return undefined
    const c = XYZW[i.component] ?? "x"
    if (i.sig === "TEXCOORD" && i.index === 0 && i.component < 2) return `uv.${c}`
    // UE's world position interpolant, and the one it rebuilds from SV_Position (identity, see ENGINE_DEFAULTS).
    if (i.sig === "TEXCOORD" && i.index === 9 && i.component < 3) return `pos.${c}`
    if (i.sig === "SV_Position") return i.component < 3 ? `pos.${c}` : "1.0"
    if (i.sig.startsWith("TEXCOORD11") && i.component < 3) return `nrm.${c}`
    return undefined
  }

  #sampleRegister(agg: string): number | undefined {
    const s = agg.match(
      /@dx\.op\.sample\w*\.f32\(i32 \d+, %dx\.types\.Handle (%[\w.]+), %dx\.types\.Handle %[\w.]+, float (\S+), float (\S+)/
    )
    if (!s) return undefined
    return this.#m.handles.get(g(s, 1))?.register
  }

  #cbufRef(agg: string, ch: number): string | undefined {
    const cb = agg.match(/cbufferLoadLegacy\.\w+\(i32 \d+, %dx\.types\.Handle (%[\w.]+), i32 (\d+)\)/)
    return cb ? `${this.#handles.get(g(cb, 1)) ?? "?"}[${g(cb, 2)}].${XYZW[ch] ?? "x"}` : undefined
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
    const operandsOf = new Map<string, Array<string>>()
    const users = new Map<string, Array<string>>()
    const worklist: Array<string> = []
    const mark = (v: string) => {
      if (this.#dynamic.get(v) === true) return
      this.#dynamic.set(v, true)
      worklist.push(v)
    }
    for (const [v, d] of this.#m.defs) {
      const operands = [...d.matchAll(/%[\w.]+/g)].map((o) => o[0]).filter((o) => o !== v && !o.startsWith("%dx."))
      operandsOf.set(v, operands)
      for (const o of operands) users.set(o, [...(users.get(o) ?? []), v])
      if (d.includes("@dx.op.loadInput")) {
        if (this.#inputExpr(d) !== undefined) mark(v)
        continue
      }
      if (d.includes("@dx.op.sample")) {
        const register = this.#sampleRegister(d)
        if (register !== undefined && this.#env.materialTextures.has(register)) mark(v)
        continue
      }
      const ev = d.match(/^extractvalue \S+ (%[\w.]+), (\d+)$/)
      if (ev) {
        const ref = this.#cbufRef(this.#m.defs.get(g(ev, 1)) ?? "", num(ev[2]))
        if (ref !== undefined && this.#env.isTime(ref)) mark(v)
      }
    }
    // Buffer and constant loads are static whatever indexes them (the instance id, an engine stencil read).
    const isLoad = (u: string) =>
      /@dx\.op\.(rawBufferLoad|cbufferLoadLegacy|bufferLoad|textureLoad)/.test(this.#m.defs.get(u) ?? "")
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
    const d = this.#m.defs.get(v) ?? ""
    const conv = d.match(/^(fptosi|fptoui) float (\S+) to i32$/)
    if (conv) return conv[1] === "fptosi" ? `uint(int(${this.expr(g(conv, 2))}))` : `uint(${this.expr(g(conv, 2))})`
    const cast = d.match(/^bitcast float (\S+) to i32$/)
    if (cast) return `floatBitsToUint(${this.expr(g(cast, 1))})`
    const bin = d.match(/^(and|or|xor|shl|lshr|add|sub|mul)(?: nuw)?(?: nsw)? i32 (\S+), (\S+)$/)
    if (bin) {
      const a = this.intExpr(g(bin, 2)), b = this.intExpr(g(bin, 3))
      const op = { and: "&", or: "|", xor: "^", shl: "<<", lshr: ">>", add: "+", sub: "-", mul: "*" }[g(bin, 1)] ?? "+"
      return `(${a} ${op} ${b})`
    }
    const bi = d.match(/@dx\.op\.binary\.i32\(i32 (\d+), i32 (\S+), i32 (\S+)\)/)
    if (bi) {
      const f = { "37": "min", "38": "max", "39": "min", "40": "max" }[g(bi, 1)]
      if (f !== undefined) return `${f}(${this.intExpr(g(bi, 2))}, ${this.intExpr(g(bi, 3))})`
    }
    const sel = d.match(/^select i1 (\S+), i32 (\S+), i32 (\S+)$/)
    if (sel) return `(${this.#bool(g(sel, 1))} ? ${this.intExpr(g(sel, 2))} : ${this.intExpr(g(sel, 3))})`
    if (d.startsWith("phi ")) {
      const entry = this.#phiEntry(v)
      return entry === undefined ? "0u" : this.intExpr(entry)
    }
    this.unsupported++
    this.unsupportedOps.push(d.slice(0, 60))
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
    const d = this.#m.defs.get(v) ?? ""
    const input = this.#inputExpr(d)
    if (input !== undefined) return input
    const ev = d.match(/^extractvalue \S+ (%[\w.]+), (\d+)$/)
    if (ev) {
      const agg = this.#m.defs.get(g(ev, 1)) ?? ""
      const ch = num(ev[2])
      const register = this.#sampleRegister(agg)
      if (register !== undefined) {
        // An engine texture (scene depth, stencil) read at a fragment-dependent place still folds.
        if (!this.#env.materialTextures.has(register)) return this.#fold(v)
        if (this.#env.bc5.has(register) && ch >= 2) return ch === 2 ? "0.0" : "1.0"
        return `${this.#sample(g(ev, 1), agg, register)}.${XYZW[ch] ?? "x"}`
      }
      const ref = this.#cbufRef(agg, ch)
      // Scene data and the other constant buffers fold (a piece at the origin); only the game time is live.
      return ref !== undefined && this.#env.isTime(ref) ? "time" : this.#fold(v)
    }
    const bin = d.match(/^(fmul|fadd|fsub|fdiv) (?:fast )?float (\S+), (\S+)$/)
    if (bin) {
      const a = this.expr(g(bin, 2)), b = this.expr(g(bin, 3))
      // The folded scene data leaves many `x * 0.0` and `x + 0.0` behind: drop them here, not in the shader.
      switch (bin[1]) {
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
    const un = d.match(/@dx\.op\.unary\.f32\(i32 (\d+), float (\S+)\)/)
    if (un) {
      const f = UNARY[g(un, 1)]
      if (f === undefined) return this.#unsupported(v)
      return f(this.expr(g(un, 2)))
    }
    const bi = d.match(/@dx\.op\.binary\.f32\(i32 (\d+), float (\S+), float (\S+)\)/)
    if (bi) {
      const f = BINARY[g(bi, 1)]
      if (f === undefined) return this.#unsupported(v)
      return f(this.expr(g(bi, 2)), this.expr(g(bi, 3)))
    }
    const mad = d.match(/@dx\.op\.tertiary\.f32\(i32 46, float (\S+), float (\S+), float (\S+)\)/)
    if (mad) {
      const a = this.expr(g(mad, 1)), b = this.expr(g(mad, 2)), c = this.expr(g(mad, 3))
      const product = a === "0.0" || b === "0.0" ? "0.0" : a === "1.0" ? b : b === "1.0" ? a : `${a} * ${b}`
      return product === "0.0" ? c : c === "0.0" ? `(${product})` : `(${product} + ${c})`
    }
    const dot = d.match(/@dx\.op\.dot(\d)\.f32\(i32 \d+, (.*)\)/)
    if (dot) {
      const ops = [...g(dot, 2).matchAll(/float ([^,)\s]+)/g)].map((x) => this.expr(g(x, 1)))
      const n = num(dot[1])
      const terms: Array<string> = []
      for (let i = 0; i < n; i++) {
        const a = ops[i] ?? "0.0", b = ops[i + n] ?? "0.0"
        if (a === "0.0" || b === "0.0") continue
        terms.push(a === "1.0" ? b : b === "1.0" ? a : `${a} * ${b}`)
      }
      return terms.length === 0 ? "0.0" : terms.length === 1 ? terms[0] ?? "0.0" : `(${terms.join(" + ")})`
    }
    const sel = d.match(/^select i1 (\S+), float (\S+), float (\S+)$/)
    if (sel) return `(${this.#bool(g(sel, 1))} ? ${this.expr(g(sel, 2))} : ${this.expr(g(sel, 3))})`
    if (d.startsWith("phi ")) {
      const entry = this.#phiEntry(v)
      return entry === undefined ? "0.0" : this.expr(entry)
    }
    const fromInt = d.match(/^(sitofp|uitofp) i32 (\S+) to float$/)
    if (fromInt) {
      return fromInt[1] === "sitofp"
        ? `float(int(${this.intExpr(g(fromInt, 2))}))`
        : `float(${this.intExpr(g(fromInt, 2))})`
    }
    const cast = d.match(/^bitcast i32 (\S+) to float$/)
    if (cast) return `uintBitsToFloat(${this.intExpr(g(cast, 1))})`
    return this.#unsupported(v)
  }

  #sample(v: string, agg: string, register: number): string {
    const named = this.#names.get(v)
    if (named !== undefined) return named
    const s = agg.match(/float (\S+), float (\S+), float/)
    const u = s ? this.expr(g(s, 1)) : "0.0", w = s ? this.expr(g(s, 2)) : "0.0"
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
    const d = this.#m.defs.get(v)
    if (d === undefined) return v === "true" ? "true" : "false"
    if (!this.dynamic(v)) {
      const b = this.#env.evaluator.bool(v)
      return b === undefined ? "false" : String(b)
    }
    const cmp = d.match(/^fcmp (?:fast )?(\w+) float (\S+), (\S+)$/)
    if (cmp) {
      const op = CMP[g(cmp, 1)]
      if (op === undefined) return this.#unsupportedBool(v)
      return `(${this.expr(g(cmp, 2))} ${op} ${this.expr(g(cmp, 3))})`
    }
    const andOr = d.match(/^(and|or) i1 (\S+), (\S+)$/)
    if (andOr) return `(${this.#bool(g(andOr, 2))} ${andOr[1] === "and" ? "&&" : "||"} ${this.#bool(g(andOr, 3))})`
    const icmp = d.match(/^icmp (\w+) i32 (\S+), (\S+)$/)
    if (icmp) {
      const op = ICMP[g(icmp, 1)]
      if (op === undefined) return this.#unsupportedBool(v)
      const signed = g(icmp, 1).startsWith("s")
      const a = this.intExpr(g(icmp, 2)), b = this.intExpr(g(icmp, 3))
      return signed ? `(int(${a}) ${op} int(${b}))` : `(${a} ${op} ${b})`
    }
    return this.#unsupportedBool(v)
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
