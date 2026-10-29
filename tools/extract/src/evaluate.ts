// Evaluates a pixel shader's scalar SSA values numerically, for a surface seen head-on: constant-buffer
// parameters come from the material instance, texture reads from a supplied value per sample (its mean),
// anything view- or position-dependent is taken at its "facing" value (a dot product of inputs reads 1,
// an input itself 0). That is enough to read the material's base colour, metallic and roughness off the
// GBuffer outputs, including how each texture read scales them.
import { inputDependency, type Module, parseFloat } from "./dxil.ts"

export interface Env {
  /** Value of a constant-buffer float by buffer type (`Material[4].w`, `View[164].y`); undefined = unknown (then 0). */
  readonly cbuf: (ref: string) => number | undefined
  /** Value of channel `channel` of the sample `value` (`%123`). */
  readonly sample: (value: string, channel: number) => number
}

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

export class Evaluator {
  readonly #m: Module
  readonly #env: Env
  readonly #memo = new Map<string, number>()
  readonly #inputDependent: (v: string) => boolean
  readonly #handles = new Map<string, string>()
  #depth = 0

  constructor(m: Module, env: Env) {
    this.#m = m
    this.#env = env
    this.#inputDependent = inputDependency(m)
    for (const [v, h] of m.handles) {
      const cb = m.cbuffers.find((c) => c.register === h.register)
      this.#handles.set(v, cb === undefined ? `cb${h.register}` : cb.type.replace(/^hostlayout\./, ""))
    }
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
    if (d.includes("@dx.op.loadInput")) return 0
    const ev = d.match(/^extractvalue \S+ (%[\w.]+), (\d+)$/)
    if (ev) {
      const agg = this.#m.defs.get(g(ev, 1)) ?? ""
      const ch = num(ev[2])
      const cb = agg.match(/cbufferLoadLegacy\.\w+\(i32 \d+, %dx\.types\.Handle (%[\w.]+), i32 (\d+)\)/)
      if (cb) return this.#env.cbuf(`${this.#handles.get(g(cb, 1)) ?? "?"}[${g(cb, 2)}].${"xyzw"[ch]}`) ?? 0
      if (agg.includes("@dx.op.sample")) return this.#env.sample(g(ev, 1), ch)
      return 0
    }
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
      // N·V, N·L and friends: facing. A dot of known values is computed.
      if (this.#inputDependent(v)) return 1
      const ops = [...g(dot, 2).matchAll(/float (\S+)/g)].map((x) => this.value(g(x, 1)))
      const n = num(dot[1])
      let sum = 0
      for (let i = 0; i < n; i++) sum += (ops[i] ?? 0) * (ops[i + n] ?? 0)
      return sum
    }
    const sel = d.match(/^select i1 (\S+), float (\S+), float (\S+)$/)
    if (sel) {
      const cond = this.#bool(g(sel, 1))
      return cond === undefined ? this.value(g(sel, 3)) : cond ? this.value(g(sel, 2)) : this.value(g(sel, 3))
    }
    if (d.startsWith("phi ")) {
      // The incoming from the entry block is the path with nothing extra applied (no decal, no special case).
      const incoming = [...d.matchAll(/\[ (\S+), (%[\w.]+) \]/g)]
      const entry = incoming.find((i) => i[2] === "%0") ?? incoming[0]
      return entry === undefined ? 0 : this.value(g(entry, 1))
    }
    const conv = d.match(/^(?:sitofp|uitofp) \S+ (\S+) to float$/)
    if (conv) return this.#int(g(conv, 1))
    return 0
  }

  #bool(v: string): boolean | undefined {
    const d = this.#m.defs.get(v)
    if (d === undefined) return v === "true" ? true : v === "false" ? false : undefined
    const cmp = d.match(/^fcmp (?:fast )?(\w+) float (\S+), (\S+)$/)
    if (cmp) {
      if (this.#inputDependent(g(cmp, 2)) || this.#inputDependent(g(cmp, 3))) return undefined
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
      const a = this.#int(g(icmp, 2)), b = this.#int(g(icmp, 3))
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
      const a = this.#bool(g(andOr, 2)), b = this.#bool(g(andOr, 3))
      if (a === undefined || b === undefined) return undefined
      return andOr[1] === "and" ? a && b : a || b
    }
    return undefined
  }

  #int(v: string): number {
    const n = Number(v)
    if (Number.isFinite(n)) return n
    const d = this.#m.defs.get(v) ?? ""
    const ev = d.match(/^extractvalue \S+ (%[\w.]+), (\d+)$/)
    if (ev) {
      const agg = this.#m.defs.get(g(ev, 1)) ?? ""
      const cb = agg.match(/cbufferLoadLegacy\.i32\(i32 \d+, %dx\.types\.Handle (%[\w.]+), i32 (\d+)\)/)
      if (cb) return this.#env.cbuf(`${this.#handles.get(g(cb, 1)) ?? "?"}[${g(cb, 2)}].${"xyzw"[num(ev[2])]}`) ?? 0
    }
    const bin = d.match(/^(and|or|shl|lshr|add|mul) i32 (\S+), (\S+)$/)
    if (bin) {
      const a = this.#int(g(bin, 2)), b = this.#int(g(bin, 3))
      switch (bin[1]) {
        case "and":
          return a & b
        case "or":
          return a | b
        case "shl":
          return a << b
        case "lshr":
          return a >>> b
        case "add":
          return a + b
        default:
          return a * b
      }
    }
    return 0
  }
}

export interface Surface {
  /** GBuffer base colour with every colour read at 0; null for a translucent pass (no GBuffer). */
  readonly baseColor: readonly [number, number, number] | null
  readonly metallic: number | null
  readonly roughness: number | null
  /** Scene colour with no lights: the emissive term (for a translucent pass, its unlit colour). */
  readonly emissive: readonly [number, number, number]
  /** Per texture sample value: how much r, g, b of the base colour change when the sample goes 0 -> 1. */
  readonly gains: Record<string, readonly [number, number, number]>
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
  "View[162].w": 1,
  "View[163].w": 1
}

/** The value a render-target output stores, before the decal blend (the entry-block side of its phi). */
const outputs = (m: Module, ir: string): Map<string, string> => {
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
  const base = ["3.x", "3.y", "3.z"].map((k) => outs.get(k))
  const scene = ["0.x", "0.y", "0.z"].map((k) => outs.get(k))
  const metallic = outs.get("2.x")
  const roughness = outs.get("2.z")
  if (scene.some((b) => b === undefined)) return null
  const opaque = base.every((b) => b !== undefined) && metallic !== undefined && roughness !== undefined
  const at = (overrides: ReadonlyMap<string, number>) => {
    const e = new Evaluator(m, {
      cbuf: (ref) => cbuf(ref) ?? ENGINE_DEFAULTS[ref],
      sample: (v, ch) => overrides.get(v) ?? means(v, ch)
    })
    return {
      rgb: base.map((b) => (b === undefined ? 0 : e.value(b))),
      scene: scene.map((b) => (b === undefined ? 0 : e.value(b))),
      metallic: metallic === undefined ? 0 : e.value(metallic),
      roughness: roughness === undefined ? 0 : e.value(roughness)
    }
  }
  const rgb = (v: ReadonlyArray<number>): readonly [number, number, number] => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0]
  const zero = at(new Map())
  const gains: Record<string, readonly [number, number, number]> = {}
  if (opaque) {
    for (const s of colorSamples) {
      const hi = rgb(at(new Map([[s, 1]])).rgb)
      const lo = rgb(at(new Map([[s, 0]])).rgb)
      gains[s] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
    }
  }
  return {
    baseColor: opaque ? rgb(zero.rgb) : null,
    metallic: opaque ? zero.metallic : null,
    roughness: opaque ? zero.roughness : null,
    emissive: rgb(zero.scene),
    gains
  }
}
