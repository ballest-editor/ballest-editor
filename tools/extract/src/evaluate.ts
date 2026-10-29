// Evaluates a pixel shader's scalar SSA values numerically, for a surface seen head-on: constant-buffer
// parameters come from the material instance, texture reads from a supplied value per sample (its mean),
// anything view- or position-dependent is taken at its "facing" value (a dot product of inputs reads 1,
// an input itself 0). The one orientation that is kept is the surface's world normal (`Env.normal`): a dot
// of the vertex normal with a row of the local-to-world transform reads that normal's component, which is
// how the beam materials hide their end caps (alpha * (1 - |world normal z|)). That is enough to read the
// material's base colour, metallic and roughness off the GBuffer outputs, including how each texture read
// scales them.
import { inputDependency, type Module, parseFloat } from "./dxil.ts"

export interface Env {
  /** Value of a constant-buffer float by buffer type (`Material[4].w`, `View[164].y`); undefined = unknown (then 0). */
  readonly cbuf: (ref: string) => number | undefined
  /** Value of channel `channel` of the sample `value` (`%123`). */
  readonly sample: (value: string, channel: number) => number
  /** The surface's world normal (UE frame, z up); default `UP`. */
  readonly normal?: readonly [number, number, number]
  /** The shader's control flow (`cfgOf(ir)`), so a phi takes the branch its condition selects. */
  readonly cfg?: Cfg
  /** GPU-scene float4s by index, over `SCENE_ROWS` (tests, experiments). */
  readonly scene?: Readonly<Record<number, readonly [number, number, number, number]>>
}

/** The basic blocks of a pixel shader: which block each value is defined in, and each block's terminator. */
export interface Cfg {
  readonly blockOf: ReadonlyMap<string, string>
  /** Block label -> `br i1 %c, label %T, label %F` / `br label %X` / `ret ...` / `switch ...`. */
  readonly terminators: ReadonlyMap<string, string>
}

/** The control flow of the (single) function in `ir`: entry block "0", then `N:` / `; <label>:N` blocks. */
export const cfgOf = (ir: string): Cfg => {
  const blockOf = new Map<string, string>()
  const terminators = new Map<string, string>()
  let block = "0"
  for (const raw of ir.split("\n")) {
    const line = raw.trim()
    const label = line.match(/^(?:; <label>:(\d+)|(\d+):)/)
    if (label) {
      block = label[1] ?? label[2] ?? block
      continue
    }

    const def = line.match(/^(%[\w.]+) = /)
    if (def) blockOf.set(g(def, 1), block)
    if (/^(br |ret |switch )/.test(line)) terminators.set(block, line)
  }
  return { blockOf, terminators }
}

const bitsView = new DataView(new ArrayBuffer(4))
/** The float whose IEEE bits are `u`. */
export const bits = (u: number): number => {
  bitsView.setUint32(0, u >>> 0)
  return bitsView.getFloat32(0)
}
/** The IEEE bits of `f`, as an int32. */
const bitsOf = (f: number): number => {
  bitsView.setFloat32(0, f)
  return bitsView.getInt32(0)
}

/**
 * GPU-scene instance data (a raw buffer, 44 float4 per instance; the instance id reads 0 so an index is
 * the field), as for a piece sitting unrotated and unscaled at the origin: float4 2..4 are the rows of
 * LocalToWorld and 5..7 of WorldToLocal, both identity; every other field (origin, bounds, flags) is 0.
 * Positions the shader derives from them are then the piece's own object-space positions.
 */
const SCENE_ROWS: Record<number, readonly [number, number, number, number]> = {
  2: [1, 0, 0, 0],
  3: [0, 1, 0, 0],
  4: [0, 0, 1, 0],
  5: [1, 0, 0, 0],
  6: [0, 1, 0, 0],
  7: [0, 0, 1, 0],
  // The instance's compressed transform (instance data float4 1, placed at 1024 by `Scene[0].x`, see
  // ENGINE_DEFAULTS), chosen so the shader's decode yields the identity: rotation parts (32768, 32768 in
  // x's halves; 16384 in y's low 15 bits, sign bit clear) give diag(1, 2, 2), and the per-axis scales
  // (2, 1, 1) x 2^(141 - 142) in z's halves and w's low half even that out to 1, 1, 1.
  1024: [bits(0x80008000), bits(0x00004000), bits(0x80018002), bits(0x008d8001)]
}

/** A surface facing up (a cube's top, the normal the evaluator uses by default). */
export const UP: readonly [number, number, number] = [0, 0, 1]
/** A vertical surface (a cube's side). */
export const SIDE: readonly [number, number, number] = [1, 0, 0]

const UNARY: Record<string, (x: number) => number> = {
  "6": Math.abs,
  "7": (x) => Math.min(1, Math.max(0, x)),
  "12": Math.cos,
  "13": Math.sin,
  "21": Math.exp,
  "22": (x) => x - Math.floor(x),
  "23": Math.log,
  "24": Math.sqrt,
  "25": (x) => 1 / Math.sqrt(x),
  "26": Math.round,
  "27": Math.floor,
  "28": Math.ceil,
  "29": Math.trunc
}
const BINARY: Record<string, (a: number, b: number) => number> = {
  "35": Math.max,
  "36": Math.min
}

const num = (s: string | undefined) => Number.parseInt(s ?? "", 10)
const g = (m: RegExpMatchArray, i: number): string => m[i] ?? ""

// The input-dependency facts of a module, shared by the many evaluators a surface evaluation builds.
const dependencies = new WeakMap<Module, ReturnType<typeof inputDependency>>()
const dependencyOf = (m: Module) => {
  const cached = dependencies.get(m)
  if (cached !== undefined) return cached
  const d = inputDependency(m)
  dependencies.set(m, d)
  return d
}

export class Evaluator {
  readonly #m: Module
  readonly #env: Env
  readonly #memo = new Map<string, number>()
  readonly #inputDependent: (v: string) => boolean
  readonly #pureInput: (v: string) => boolean
  readonly #handles: ReadonlyMap<string, string>
  #depth = 0

  constructor(m: Module, env: Env) {
    this.#m = m
    this.#env = env
    const dependency = dependencyOf(m)
    this.#inputDependent = dependency.any
    this.#pureInput = dependency.pure
    this.#handles = bufferNames(m)
  }

  /** The value, or undefined when the chain is not a float expression this evaluator understands. */
  value(v: string): number {
    const c = parseFloat(v)
    if (c !== undefined) return c
    if (v === "undef") return 0
    const cached = this.#memo.get(v)
    if (cached !== undefined) return cached
    if (this.#depth > 200) return 0
    this.#depth++
    const r = this.#compute(v)
    this.#depth--
    const safe = Number.isFinite(r) ? r : 0
    this.#memo.set(v, safe)
    return safe
  }

  #compute(v: string): number {
    const d = this.#m.defs.get(v)
    if (d === undefined) return 0
    if (d.includes("@dx.op.loadInput")) return this.#input(d)
    const ev = d.match(/^extractvalue \S+ (%[\w.]+), (\d+)$/)
    if (ev) {
      const agg = this.#m.defs.get(g(ev, 1)) ?? ""
      const ch = num(ev[2])
      const cb = agg.match(/cbufferLoadLegacy\.\w+\(i32 \d+, %dx\.types\.Handle (%[\w.]+), i32 (\d+)\)/)
      if (cb) return this.#env.cbuf(`${this.#handles.get(g(cb, 1)) ?? "?"}[${g(cb, 2)}].${"xyzw"[ch]}`) ?? 0
      if (agg.includes("@dx.op.sample")) return this.#env.sample(g(ev, 1), ch)
      const raw = agg.match(/@dx\.op\.rawBufferLoad\.f32\(i32 \d+, %dx\.types\.Handle %[\w.]+, i32 (\S+),/)
      if (raw) {
        const index = this.int(g(raw, 1))
        return (this.#env.scene?.[index] ?? SCENE_ROWS[index])?.[ch] ?? 0
      }
      return 0
    }
    // A dot product the compiler expanded into multiplies and adds of input-derived vectors (N·V and
    // friends) reads 1, like an explicit dot: the surface is seen head-on.
    if (this.#dotLike(v)) return 1
    const bin = d.match(/^(fmul|fadd|fsub|fdiv) (?:fast )?float (\S+), (\S+)$/)
    if (bin) {
      const a = this.value(g(bin, 2)), b = this.value(g(bin, 3))
      switch (bin[1]) {
        case "fmul":
          return a * b
        case "fadd":
          return a + b
        case "fsub":
          return a - b
        default:
          return b === 0 ? 0 : a / b
      }
    }
    const un = d.match(/@dx\.op\.unary\.f32\(i32 (\d+), float (\S+)\)/)
    if (un) return (UNARY[g(un, 1)] ?? (() => 0))(this.value(g(un, 2)))
    const bi = d.match(/@dx\.op\.binary\.f32\(i32 (\d+), float (\S+), float (\S+)\)/)
    if (bi) return (BINARY[g(bi, 1)] ?? (() => 0))(this.value(g(bi, 2)), this.value(g(bi, 3)))
    const mad = d.match(/@dx\.op\.tertiary\.f32\(i32 46, float (\S+), float (\S+), float (\S+)\)/)
    if (mad) return this.value(g(mad, 1)) * this.value(g(mad, 2)) + this.value(g(mad, 3))
    const dot = d.match(/@dx\.op\.dot(\d)\.f32\(i32 \d+, (.*)\)/)
    if (dot) {
      const operands = [...g(dot, 2).matchAll(/float ([^,)\s]+)/g)].map((x) => g(x, 1))
      const n = num(dot[1])
      // A dot over the vertex normal (N·V, N·L, a fixed light direction) is an orientation: the normal
      // against a transform row is a world normal component, anything else reads facing (1). Two
      // input-derived vectors read facing too. Anything else (a luminance weighting of texture reads, a
      // channel pick) is computed.
      const both = operands.slice(0, n).some((o) => this.#inputDependent(o)) &&
        operands.slice(n).some((o) => this.#inputDependent(o))
      if (both || operands.some((o) => this.#reaches(o, 4, this.#isNormalInput))) {
        return this.#worldNormalComponent(operands) ?? 1
      }
      const ops = operands.map((o) => this.value(o))
      let sum = 0
      for (let i = 0; i < n; i++) sum += (ops[i] ?? 0) * (ops[i + n] ?? 0)
      return sum
    }
    const sel = d.match(/^select i1 (\S+), float (\S+), float (\S+)$/)
    if (sel) {
      const cond = this.bool(g(sel, 1))
      return cond === undefined ? this.value(g(sel, 3)) : cond ? this.value(g(sel, 2)) : this.value(g(sel, 3))
    }
    if (d.startsWith("phi ")) {
      const entry = this.phiEntry(v)
      return entry === undefined ? 0 : this.value(entry)
    }
    const conv = d.match(/^(?:sitofp|uitofp) \S+ (\S+) to float$/)
    if (conv) return this.int(g(conv, 1))
    const fromBits = d.match(/^bitcast i32 (\S+) to float$/)
    if (fromBits) return bits(this.int(g(fromBits, 1)))
    return 0
  }

  /**
   * The surface seen head-on from above: the world normal (UE's TEXCOORD11, z up) is +z, the tangent
   * (TEXCOORD10) +x, texture coordinates sit mid-face, everything else (positions) is 0.
   */
  #input(d: string): number {
    const li = d.match(/loadInput\.f32\(i32 \d+, i32 (\d+), i32 \d+, i8 (\d+)/)
    if (!li) return 0
    const sig = this.#m.inputs.find((x) => x.id === num(li[1]))
    const component = num(li[2])
    if (sig === undefined) return 0
    if (sig.name.startsWith("TEXCOORD11")) return component === 2 ? 1 : 0
    if (sig.name.startsWith("TEXCOORD10")) return component === 0 ? 1 : 0
    if (sig.name === "TEXCOORD") return 0.5
    return 0
  }

  /**
   * The incoming value a phi takes: the one from the predecessor the control flow actually runs through
   * (branch conditions evaluated like everything else: the instance-transform decode is taken, a decal
   * blend is not); without a control flow graph, or when the walk never reaches the phi's block, the
   * incoming from the earliest block (the plain path, before the special cases branch off).
   */
  phiEntry(v: string): string | undefined {
    const d = this.#m.defs.get(v) ?? ""
    const incoming = [...d.matchAll(/\[ (\S+), %(\d+) \]/g)].map((i) => ({ value: g(i, 1), block: g(i, 2) }))
    const block = this.#env.cfg?.blockOf.get(v)
    const pred = block === undefined ? undefined : this.#predecessors().get(block)
    const taken = pred === undefined ? undefined : incoming.find((i) => i.block === pred)
    if (taken !== undefined) return taken.value
    return incoming.sort((a, b) => num(a.block) - num(b.block))[0]?.value
  }

  #preds: Map<string, string> | undefined
  /** Block -> the block the walk came from, walking the control flow from the entry with evaluated conditions. */
  #predecessors(): Map<string, string> {
    if (this.#preds !== undefined) return this.#preds
    const preds = new Map<string, string>()
    this.#preds = preds
    const cfg = this.#env.cfg
    if (cfg === undefined) return preds
    let block = "0"
    for (let step = 0; step < 10000; step++) {
      const t = cfg.terminators.get(block) ?? ""
      const cond = t.match(/^br i1 (\S+), label %(\d+), label %(\d+)/)
      const jump = t.match(/^br label %(\d+)/)
      let next: string | undefined
      if (cond) next = this.bool(g(cond, 1)) === true ? g(cond, 2) : g(cond, 3)
      else if (jump) next = g(jump, 1)
      if (next === undefined || preds.has(next)) break // ret, or a loop: keep the first way in
      preds.set(next, block)
      block = next
    }
    return preds
  }

  /** A load of the vertex normal (UE's TEXCOORD11). */
  readonly #isNormalInput = (d: string): boolean => {
    const li = d.match(/loadInput\.f32\(i32 \d+, i32 (\d+),/)
    return li !== null && (this.#m.inputs.find((x) => x.id === num(li[1]))?.name.startsWith("TEXCOORD11") ?? false)
  }

  /** Whether `pred` holds for `v`'s definition or one it reaches within `depth` operand steps. */
  #reaches(v: string, depth: number, pred: (d: string) => boolean): boolean {
    const d = this.#m.defs.get(v)
    if (d === undefined) return false
    if (pred(d)) return true
    if (depth === 0) return false
    return [...d.matchAll(/%[\w.]+/g)].some((o) => o[0] !== v && this.#reaches(o[0], depth - 1, pred))
  }

  /**
   * A dot of the vertex normal (TEXCOORD11) with one component of three rows of the primitive's
   * local-to-world transform (raw buffer loads): that component of the world normal, from `Env.normal`.
   * Undefined for any other dot.
   */
  #worldNormalComponent(operands: ReadonlyArray<string>): number | undefined {
    if (!operands.some((o) => this.#reaches(o, 3, this.#isNormalInput))) return undefined
    const components = new Set(operands.map((o) => this.#rowComponent(o, 2)).filter((c) => c !== undefined))
    if (components.size !== 1) return undefined
    const [c] = components
    return (this.#env.normal ?? UP)[c ?? 0]
  }

  /** The component `v` extracts from a raw buffer load (a transform row), possibly scaled; else undefined. */
  #rowComponent(v: string, depth: number): number | undefined {
    const d = this.#m.defs.get(v)
    if (d === undefined) return undefined
    const ev = d.match(/^extractvalue %dx\.types\.ResRet\.f32 (%[\w.]+), (\d)$/)
    if (ev) return (this.#m.defs.get(g(ev, 1)) ?? "").includes("@dx.op.rawBufferLoad") ? num(ev[2]) : undefined
    const mul = d.match(/^fmul (?:fast )?float (\S+), (\S+)$/)
    if (!mul || depth === 0) return undefined
    return this.#rowComponent(g(mul, 1), depth - 1) ?? this.#rowComponent(g(mul, 2), depth - 1)
  }

  /** Sum of 2..4 products of two input-dependent values, through fmul / fadd / fmad. */
  #dotLike(v: string): boolean {
    const terms: Array<[string, string]> = []
    const walk = (x: string, depth: number): boolean => {
      const d = this.#m.defs.get(x)
      if (d === undefined || depth > 4) return false
      const mul = d.match(/^fmul (?:fast )?float (\S+), (\S+)$/)
      if (mul) {
        terms.push([g(mul, 1), g(mul, 2)])
        return true
      }
      const add = d.match(/^fadd (?:fast )?float (\S+), (\S+)$/)
      if (add) return walk(g(add, 1), depth + 1) && walk(g(add, 2), depth + 1)
      const mad = d.match(/@dx\.op\.tertiary\.f32\(i32 46, float (\S+), float (\S+), float (\S+)\)/)
      if (mad) {
        terms.push([g(mad, 1), g(mad, 2)])
        return walk(g(mad, 3), depth + 1)
      }
      return false
    }
    if (!walk(v, 0) || terms.length < 2 || terms.length > 4) return false
    return terms.every(([a, b]) => this.#pureInput(a) && this.#pureInput(b))
  }

  /** An i1 value (a comparison, and/or of them); undefined when it is not one this evaluator understands. */
  bool(v: string): boolean | undefined {
    const d = this.#m.defs.get(v)
    if (d === undefined) return v === "true" ? true : v === "false" ? false : undefined
    const cmp = d.match(/^fcmp (?:fast )?(\w+) float (\S+), (\S+)$/)
    if (cmp) {
      const a = this.value(g(cmp, 2)), b = this.value(g(cmp, 3))
      switch (g(cmp, 1)) {
        case "olt":
        case "ult":
          return a < b
        case "ole":
        case "ule":
          return a <= b
        case "ogt":
        case "ugt":
          return a > b
        case "oge":
        case "uge":
          return a >= b
        case "oeq":
        case "ueq":
          return a === b
        case "one":
        case "une":
          return a !== b
        default:
          return undefined
      }
    }
    const icmp = d.match(/^icmp (\w+) i32 (\S+), (\S+)$/)
    if (icmp) {
      const a = this.int(g(icmp, 2)), b = this.int(g(icmp, 3))
      switch (g(icmp, 1)) {
        case "eq":
          return a === b
        case "ne":
          return a !== b
        default:
          return undefined
      }
    }
    const andOr = d.match(/^(and|or) i1 (\S+), (\S+)$/)
    if (andOr) {
      const a = this.bool(g(andOr, 2)), b = this.bool(g(andOr, 3))
      if (a === undefined || b === undefined) return undefined
      return andOr[1] === "and" ? a && b : a || b
    }
    return undefined
  }

  /** An i32 value: literals, integer constant-buffer loads, and integer arithmetic over them; 0 otherwise. */
  int(v: string): number {
    const n = Number(v)
    if (Number.isFinite(n)) return n
    const d = this.#m.defs.get(v) ?? ""
    const ev = d.match(/^extractvalue \S+ (%[\w.]+), (\d+)$/)
    if (ev) {
      const agg = this.#m.defs.get(g(ev, 1)) ?? ""
      const cb = agg.match(/cbufferLoadLegacy\.i32\(i32 \d+, %dx\.types\.Handle (%[\w.]+), i32 (\d+)\)/)
      if (cb) return this.#env.cbuf(`${this.#handles.get(g(cb, 1)) ?? "?"}[${g(cb, 2)}].${"xyzw"[num(ev[2])]}`) ?? 0
    }
    const toBits = d.match(/^bitcast float (\S+) to i32$/)
    if (toBits) return bitsOf(this.value(g(toBits, 1)))
    const sel = d.match(/^select i1 (\S+), i32 (\S+), i32 (\S+)$/)
    if (sel) return this.bool(g(sel, 1)) === true ? this.int(g(sel, 2)) : this.int(g(sel, 3))
    if (d.startsWith("phi ")) {
      const entry = this.phiEntry(v)
      return entry === undefined ? 0 : this.int(entry)
    }
    const bin = d.match(/^(and|or|xor|shl|lshr|add|sub|mul)(?: nuw)?(?: nsw)? i32 (\S+), (\S+)$/)
    if (bin) {
      const a = this.int(g(bin, 2)), b = this.int(g(bin, 3))
      switch (bin[1]) {
        case "and":
          return a & b
        case "or":
          return a | b
        case "shl":
          return a << b
        case "lshr":
          return a >>> b
        case "xor":
          return a ^ b
        case "add":
          return (a + b) | 0
        case "sub":
          return (a - b) | 0
        default:
          return Math.imul(a, b)
      }
    }
    return 0
  }
}

export interface Surface {
  /**
   * Base colour: the GBuffer's for an opaque pass; for a translucent pass, the diffuse colour the lighting
   * code multiplies by View.DiffuseOverrideParameter (the material's base colour after its own math).
   */
  readonly baseColor: readonly [number, number, number] | null
  readonly metallic: number | null
  readonly roughness: number | null
  /** Translucent passes: the alpha the pass writes (scene colour .a) for a surface facing up; null for opaque. */
  readonly opacity: number | null
  /** Translucent passes: the alpha for a vertical surface (the sides of a beam whose caps are masked). */
  readonly opacitySide: number | null
  /** Translucent passes: how much the alpha changes when a sample goes 0 -> 1 (at the orientation that shows). */
  readonly alphaGains: Record<string, number>
  /**
   * Translucent passes: the alpha with every material texture read at 0, and at 1 (the orientation that
   * shows). An effect that multiplies several sparse reads (the beam's ray streaks) swings far more where
   * they all peak than any one read's gain says.
   */
  readonly alphaRange: readonly [number, number] | null
  /** Scene colour with no lights, facing up: the emissive term (for a translucent pass, its unlit colour). */
  readonly emissive: readonly [number, number, number]
  /** The same for a vertical surface. */
  readonly emissiveSide: readonly [number, number, number]
  /** Per texture sample value: how much r, g, b of the base colour change when the sample goes 0 -> 1. */
  readonly gains: Record<string, readonly [number, number, number]>
}

/** SSA handle -> the constant buffer's type name (`Material`, `View`), or `cbN` for an unnamed one. */
export const bufferNames = (m: Module): ReadonlyMap<string, string> => {
  const names = new Map<string, string>()
  for (const [v, h] of m.handles) {
    const cb = m.cbuffers.find((c) => c.register === h.register)
    names.set(v, cb === undefined ? `cb${h.register}` : cb.type.replace(/^hostlayout\./, ""))
  }
  return names
}

/** Engine constant-buffer values the material math reads that are fixed in practice. */
export const ENGINE_DEFAULTS: Record<string, number> = {
  // View.RoughnessOverrideParameter: roughness * y + x
  "View[164].x": 0,
  "View[164].y": 1,
  // View.PreExposure and View.OneOverPreExposure
  "View[160].z": 1,
  "View[160].w": 1,
  // View.DiffuseOverrideParameter / SpecularOverrideParameter: (0, 0, 0, 1) = no override
  "View[161].w": 1,
  "View[162].w": 1,
  // The translucent passes clamp their scene colour to this maximum: effectively none.
  "View[358].z": 1e6,
  // View.SVPositionToTranslatedWorld (rows 44..47) = identity and View.PreViewTranslation (128) = 0: the
  // world position a pixel shader rebuilds from SV_Position is SV_Position itself, so the renderer can
  // feed the object-space position there (the piece sits at the origin, see SCENE_ROWS).
  "View[44].x": 1,
  "View[45].y": 1,
  "View[46].z": 1,
  "View[47].w": 1,
  // Scene.InstanceDataShift (the instance id reads 0): the instance's data starts at float4 1 << 10, clear
  // of the primitive data at 0..43 (SCENE_ROWS).
  "Scene[0].x": 10
}

/**
 * The diffuse colour of a lit pass, per channel: the value the engine multiplies by
 * View.DiffuseOverrideParameter.w and offsets by its .xyz (`DiffuseColor * w + xyz`). That is the material's
 * base colour after its own math, the only place a translucent pass (no GBuffer) exposes it.
 */
const diffuseOf = (m: Module): ReadonlyArray<string> | null => {
  const cbufComponent = (v: string): [string, number] | null => {
    const d = m.defs.get(v)
    const ev = d?.match(/^extractvalue \S+ (%[\w.]+), (\d+)$/)
    if (!ev) return null
    const agg = m.defs.get(g(ev, 1)) ?? ""
    const cb = agg.match(/cbufferLoadLegacy\.\w+\(i32 \d+, %dx\.types\.Handle (%[\w.]+), i32 (\d+)\)/)
    if (!cb) return null
    const h = m.handles.get(g(cb, 1))
    const type = m.cbuffers.find((c) => c.register === h?.register)?.type.replace(/^hostlayout\./, "")
    return [`${type ?? "?"}[${g(cb, 2)}]`, num(ev[2])]
  }
  const out: Array<string> = []
  for (const [v, d] of m.defs) {
    const mul = d.match(/^fmul (?:fast )?float (\S+), (\S+)$/)
    if (!mul) continue
    const [a, b] = [g(mul, 1), g(mul, 2)]
    const w = cbufComponent(a)?.[1] === 3 && cbufComponent(a)?.[0] === "View[161]"
      ? b
      : cbufComponent(b)?.[1] === 3 && cbufComponent(b)?.[0] === "View[161]"
      ? a
      : undefined
    if (w === undefined) continue
    // which channel: the add of View[161].{x,y,z} that follows
    for (const dd of m.defs.values()) {
      const add = dd.match(/^fadd (?:fast )?float (\S+), (\S+)$/)
      if (!add || (add[1] !== v && add[2] !== v)) continue
      const other = add[1] === v ? g(add, 2) : g(add, 1)
      const c = cbufComponent(other)
      if (c?.[0] === "View[161]" && c[1] < 3 && out[c[1]] === undefined) out[c[1]] = w
    }
  }
  return Object.keys(out).length === 3 ? out : null
}

/** The value each render-target output (`"<target>.<channel>"`, e.g. `0.w`) stores. */
export const outputs = (m: Module, ir: string): Map<string, string> => {
  const out = new Map<string, string>()
  for (const s of ir.matchAll(/@dx\.op\.storeOutput\.f32\(i32 \d+, i32 (\d+), i32 (\d+), i8 (\d+), float (\S+)\)/g)) {
    const sig = m.outputs.find((x) => x.id === num(s[1]))
    if (sig?.name !== "SV_Target") continue
    const index = sig.indices[num(s[2])] ?? 0
    out.set(`${index}.${"xyzw"[num(s[3])]}`, g(s, 4))
  }
  return out
}

/**
 * Base colour, metallic and roughness of an opaque base pass (GBuffer C = base colour, GBuffer B =
 * metallic / specular / roughness) and the emissive scene colour, evaluated for a facing surface with
 * every texture read at its mean (`means`). Each colour read's gain is its 0 -> 1 difference with the
 * others at their means: the surface linearised around the average look.
 */
export const surfaceOf = (
  m: Module,
  ir: string,
  cbuf: Env["cbuf"],
  means: (sampleValue: string, channel: number) => number,
  colorSamples: ReadonlyArray<string>
): Surface | null => {
  const outs = outputs(m, ir)
  const scene = ["0.x", "0.y", "0.z"].map((k) => outs.get(k))
  const metallic = outs.get("2.x")
  const roughness = outs.get("2.z")
  if (scene.some((b) => b === undefined)) return null
  const gbuffer = ["3.x", "3.y", "3.z"].map((k) => outs.get(k))
  const opaque = gbuffer.every((b) => b !== undefined) && metallic !== undefined && roughness !== undefined
  const diffuse = opaque ? null : diffuseOf(m)
  const base = opaque ? gbuffer : diffuse ?? [undefined, undefined, undefined]
  const alpha = opaque ? undefined : outs.get("0.w")
  const cfg = cfgOf(ir)
  const at = (overrides: ReadonlyMap<string, number>, normal: readonly [number, number, number]) => {
    const e = new Evaluator(m, {
      cbuf: (ref) => cbuf(ref) ?? ENGINE_DEFAULTS[ref],
      sample: (v, ch) => overrides.get(v) ?? means(v, ch),
      normal,
      cfg
    })
    return {
      rgb: base.map((b) => (b === undefined ? 0 : e.value(b))),
      scene: scene.map((b) => (b === undefined ? 0 : e.value(b))),
      metallic: metallic === undefined ? 0 : e.value(metallic),
      roughness: roughness === undefined ? 0 : e.value(roughness),
      alpha: alpha === undefined ? 1 : e.value(alpha)
    }
  }
  const hasBase = base.every((b) => b !== undefined)
  const rgb = (v: ReadonlyArray<number>): readonly [number, number, number] => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0]
  const zero = at(new Map(), UP)
  // A translucent effect that masks its caps shows on its sides: that is where its texture reads matter.
  const side = opaque ? zero : at(new Map(), SIDE)
  const shows = (s: typeof zero) => s.alpha + Math.max(...s.scene)
  const shown = shows(side) > shows(zero) ? SIDE : UP
  const gains: Record<string, readonly [number, number, number]> = {}
  const alphaGains: Record<string, number> = {}
  if (hasBase) {
    for (const s of colorSamples) {
      const hi = at(new Map([[s, 1]]), shown), lo = at(new Map([[s, 0]]), shown)
      const h = rgb(hi.rgb), l = rgb(lo.rgb)
      gains[s] = [h[0] - l[0], h[1] - l[1], h[2] - l[2]]
      if (!opaque) alphaGains[s] = hi.alpha - lo.alpha
    }
  }
  const corner = (value: number) => at(new Map(colorSamples.map((s) => [s, value])), shown).alpha
  return {
    baseColor: hasBase ? rgb(zero.rgb) : null,
    metallic: opaque ? zero.metallic : null,
    roughness: opaque ? zero.roughness : null,
    opacity: opaque ? null : zero.alpha,
    opacitySide: opaque ? null : side.alpha,
    alphaRange: opaque || !hasBase ? null : [corner(0), corner(1)],
    emissive: rgb(zero.scene),
    emissiveSide: rgb(side.scene),
    gains,
    alphaGains
  }
}
