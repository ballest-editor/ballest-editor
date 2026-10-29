// Reads a DXIL module disassembled by `dxc -dumpbin` (LLVM IR text) and traces every texture sample's
// coordinates, and every vertex-shader output, back to their sources: vertex attributes and interpolants,
// vertex buffers, constant-buffer parameters, GPU-scene data (primitive/instance transforms), constants.
// Pure functions over the IR text; no I/O.

export interface Signature {
  readonly id: number
  readonly name: string
  readonly indices: ReadonlyArray<number>
  readonly rows: number
  readonly cols: number
  readonly startRow: number
}

export interface CBuffer {
  readonly register: number
  /** HLSL type name, e.g. `Material`, `hostlayout.View`, `OpaqueBasePass`. */
  readonly type: string
  readonly size: number
}

export interface Srv {
  readonly register: number
  /** `Texture2D`, `StructuredBuffer`, `Buffer`, ... (the HLSL class). */
  readonly kind: string
}

export interface Module {
  readonly defs: ReadonlyMap<string, string>
  readonly inputs: ReadonlyArray<Signature>
  readonly outputs: ReadonlyArray<Signature>
  readonly cbuffers: ReadonlyArray<CBuffer>
  readonly srvs: ReadonlyArray<Srv>
  /** SSA handle name -> bound register (through annotateHandle). */
  readonly handles: ReadonlyMap<string, { readonly register: number; readonly cls: number }>
}

export type LeafKind =
  | "input" // loadInput: a vertex attribute (VS) or interpolant (PS)
  | "buffer" // typed Buffer<> load: UE's manual vertex fetch (UVs, colours, tangents)
  | "sceneData" // StructuredBuffer raw load: GPU scene (primitive / instance transforms)
  | "param" // constant buffer value
  | "texture" // another texture sample feeds this coordinate
  | "constant"

export interface Leaf {
  readonly kind: LeafKind
  /** input: semantic (`TEXCOORD0`, `ATTRIBUTE0`); param: `cb3[0].x`; buffer/sceneData/texture: `t12`; constant: value. */
  readonly source: string
  readonly component: string
  /** Product of the literal constants multiplied along the path from the leaf to the traced value. */
  readonly factor: number
  /** Constant-buffer values multiplied along the path (`cb3[2].w`). */
  readonly params: ReadonlyArray<string>
  /** How many GPU-scene values (transform rows) multiply the path: 1 = local -> world, 2 = ... -> object. */
  readonly sceneDepth: number
  /**
   * The path is multiplied (1) or divided (-1) by a function of GPU-scene data that is not a plain transform
   * row: the length of one, i.e. the instance scale. 0 when neither.
   */
  readonly sceneScale: number
}

export interface Sample {
  readonly value: string
  readonly op: string
  readonly register: number
  readonly channels: string
  readonly coords: ReadonlyArray<ReadonlyArray<Leaf>>
  /**
   * The literal constant the sampled channels are first multiplied by, if any. A normal map unpacked with
   * `* 2 - 1` reads 2; a layer blended at strength s reads 2s.
   */
  readonly resultFactor: number | null
}

export interface Output {
  readonly semantic: string
  readonly component: string
  readonly leaves: ReadonlyArray<Leaf>
}

const XYZW = "xyzw"
const num = (s: string | undefined) => Number.parseInt(s ?? "", 10)
/** Group `i` of a match; regexes here only have mandatory groups, so a miss is the empty string. */
const g = (m: RegExpMatchArray, i: number): string => m[i] ?? ""

/** LLVM prints non-trivial float constants as IEEE double hex (`0x3F06A0F8E0000000`). */
export const parseFloat = (s: string): number | undefined => {
  if (s.startsWith("0x")) {
    const view = new DataView(new ArrayBuffer(8))
    view.setBigUint64(0, BigInt(s))
    return view.getFloat64(0)
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

const metadata = (ir: string): Map<string, string> => {
  const out = new Map<string, string>()
  for (const m of ir.matchAll(/^(![\w.]+) = (?:distinct )?!\{(.*)\}$/gm)) out.set(g(m, 1), g(m, 2))
  return out
}

const refs = (node: string): Array<string> => [...node.matchAll(/!(\d+)/g)].map((m) => `!${m[1]}`)

const signaturesOf = (meta: Map<string, string>, listNode: string | undefined): Array<Signature> => {
  const list = listNode === undefined ? undefined : meta.get(listNode)
  if (list === undefined) return []
  const out: Array<Signature> = []
  for (const ref of refs(list)) {
    const m = meta.get(ref)?.match(
      /^i32 (\d+), !"([^"]*)", i8 \d+, i8 \d+, (![\d]+|null), i8 \d+, i32 (\d+), i8 (\d+), i32 (\d+), i8 \d+/
    )
    if (!m) continue
    const idx = m[3] === "null" ? [] : [...(meta.get(g(m, 3)) ?? "").matchAll(/i32 (\d+)/g)].map((x) => num(x[1]))
    out.push({ id: num(m[1]), name: g(m, 2), indices: idx, rows: num(m[4]), cols: num(m[5]), startRow: num(m[6]) })
  }
  return out
}

export const parseModule = (ir: string): Module => {
  const defs = new Map<string, string>()
  for (const m of ir.matchAll(/^\s+(%[\w.]+) = (.*)$/gm)) defs.set(g(m, 1), g(m, 2))
  const meta = metadata(ir)
  // Entry point: !{fn, !"name", !signatures, !resources, !props}; signatures = !{inputs, outputs, patch}.
  const entry = refs(meta.get("!dx.entryPoints") ?? "")[0]
  const entryParts = entry === undefined ? [] : refs(meta.get(entry) ?? "")
  const sigParts = entryParts[0] === undefined ? [] : (meta.get(entryParts[0])?.split(",").map((s) => s.trim()) ?? [])
  const inputs = signaturesOf(meta, sigParts[0])
  const outputs = signaturesOf(meta, sigParts[1])
  // Resources: !{SRVs, UAVs, CBVs, Samplers}; each entry !{id, type* undef, !"", space, register, count, kind/size, ...}.
  const resources = refs(meta.get("!dx.resources") ?? "")[0]
  const resLists = resources === undefined ? [] : (meta.get(resources)?.split(",").map((s) => s.trim()) ?? [])
  const entries = (list: string | undefined) =>
    list === undefined || list === "null" ? [] : refs(meta.get(list) ?? "").map((r) => meta.get(r) ?? "")
  const srvs: Array<Srv> = []
  for (const e of entries(resLists[0])) {
    const m = e.match(/^i32 \d+, %"?class\.([A-Za-z0-9]+)[^*]*\* undef, !"[^"]*", i32 \d+, i32 (\d+)/)
    if (m) srvs.push({ register: num(m[2]), kind: g(m, 1) })
  }
  const cbuffers: Array<CBuffer> = []
  for (const e of entries(resLists[2])) {
    const m = e.match(/^i32 \d+, %"?([^"*]+)"?\* undef, !"[^"]*", i32 \d+, i32 (\d+), i32 \d+, i32 (\d+)/)
    if (m) cbuffers.push({ register: num(m[2]), type: g(m, 1), size: num(m[3]) })
  }
  const handles = new Map<string, { register: number; cls: number }>()
  for (const [v, d] of defs) {
    const b = d.match(
      /createHandleFromBinding\(i32 \d+, %dx\.types\.ResBind (?:\{ i32 (\d+), i32 \d+, i32 \d+, i8 (\d+) \}|zeroinitializer)/
    )
    if (b) handles.set(v, { register: b[1] === undefined ? 0 : num(b[1]), cls: b[2] === undefined ? 0 : num(b[2]) })
    const c = d.match(/createHandle\(i32 \d+, i8 (\d+), i32 \d+, i32 (\d+)/)
    if (c) handles.set(v, { register: num(c[2]), cls: num(c[1]) })
  }
  for (const [v, d] of defs) {
    const a = d.match(/annotateHandle\(i32 \d+, %dx\.types\.Handle (%[\w.]+)/)
    const base = a && handles.get(g(a, 1))
    if (base) handles.set(v, base)
  }
  return { defs, inputs, outputs, cbuffers, srvs, handles }
}

const semanticOf = (sigs: ReadonlyArray<Signature>, id: number, row: number): string => {
  const s = sigs.find((x) => x.id === id)
  if (!s) return `sig${id}[${row}]`
  const index = s.indices[row]
  return index === undefined || !/^[A-Z_]+$/.test(s.name) ? s.name : `${s.name}${index}`
}

interface Ctx {
  readonly factor: number
  readonly params: ReadonlyArray<string>
  readonly sceneDepth: number
  readonly sceneScale: number
}

interface Facts {
  hasInput: boolean
  hasBuffer: boolean
  hasRaw: boolean
  hasSqrt: boolean
  cbufRefs: Set<string>
}

const operands = (d: string): Array<string> => {
  // `op fast float %a, %b` / `op float %a, 0x...` -> the two operands.
  const m = d.match(/^(?:fmul|fadd|fsub|fdiv) (?:fast )?float (\S+), (\S+)$/)
  return m ? [g(m, 1), g(m, 2)] : []
}

class Tracer {
  readonly #m: Module
  readonly #facts = new Map<string, Facts>()
  constructor(m: Module) {
    this.#m = m
  }

  #register(handle: string): number {
    return this.#m.handles.get(handle)?.register ?? -1
  }

  #cbufRef(aggregate: string, component: number): string | undefined {
    const d = this.#m.defs.get(aggregate)
    const m = d?.match(/cbufferLoadLegacy\.\w+\(i32 \d+, %dx\.types\.Handle (%[\w.]+), i32 (\d+)\)/)
    return m ? `cb${this.#register(g(m, 1))}[${g(m, 2)}].${XYZW[component]}` : undefined
  }

  /** What a subtree contains, for classifying it as a multiplier of its sibling. */
  facts(v: string, seen = new Set<string>()): Facts {
    const cached = this.#facts.get(v)
    if (cached) return cached
    const f: Facts = { hasInput: false, hasBuffer: false, hasRaw: false, hasSqrt: false, cbufRefs: new Set() }
    if (seen.has(v)) return f
    seen.add(v)
    const d = this.#m.defs.get(v)
    if (d === undefined) return f
    if (d.includes("@dx.op.loadInput")) f.hasInput = true
    if (d.includes("@dx.op.bufferLoad")) f.hasBuffer = true
    if (d.includes("@dx.op.rawBufferLoad")) f.hasRaw = true
    if (d.includes("@dx.op.unary.f32(i32 24,")) f.hasSqrt = true
    const ev = d.match(/^extractvalue \S+ (%[\w.]+), (\d+)$/)
    if (ev) {
      const ref = this.#cbufRef(g(ev, 1), num(ev[2]))
      if (ref !== undefined) f.cbufRefs.add(ref)
    }
    for (const op of d.matchAll(/%[\w.]+/g)) {
      if (op[0] === v || op[0].startsWith("%dx.")) continue
      const sub = this.facts(op[0], seen)
      f.hasInput ||= sub.hasInput
      f.hasBuffer ||= sub.hasBuffer
      f.hasRaw ||= sub.hasRaw
      f.hasSqrt ||= sub.hasSqrt
      for (const r of sub.cbufRefs) f.cbufRefs.add(r)
    }
    this.#facts.set(v, f)
    return f
  }

  /** The context a value gets from being multiplied (`sign` 1) or divided (-1) by `other`. */
  #times(ctx: Ctx, other: string, sign = 1): Ctx {
    const c = parseFloat(other)
    if (c !== undefined) return { ...ctx, factor: sign > 0 ? ctx.factor * c : ctx.factor / c }
    const f = this.facts(other)
    if (f.hasRaw) return f.hasSqrt ? { ...ctx, sceneScale: sign } : { ...ctx, sceneDepth: ctx.sceneDepth + 1 }
    if (f.cbufRefs.size > 0 && !f.hasInput && !f.hasBuffer) {
      return { ...ctx, params: [...ctx.params, ...f.cbufRefs].sort() }
    }
    return ctx
  }

  trace(v: string, ctx: Ctx, depth = 0): Array<Leaf> {
    const leaf = (kind: LeafKind, source: string, component: string): Leaf => ({ kind, source, component, ...ctx })
    const c = parseFloat(v)
    if (c !== undefined) return [leaf("constant", String(c), "")]
    const d = this.#m.defs.get(v)
    if (d === undefined || depth > 40) return []
    const li = d.match(/@dx\.op\.loadInput\.\w+\(i32 \d+, i32 (\d+), i32 (\d+), i8 (\d+)/)
    if (li) return [leaf("input", semanticOf(this.#m.inputs, num(li[1]), num(li[2])), XYZW[num(li[3])] ?? "")]
    const ev = d.match(/^extractvalue \S+ (%[\w.]+), (\d+)$/)
    if (ev) {
      const agg = this.#m.defs.get(g(ev, 1)) ?? ""
      const comp = XYZW[num(ev[2])] ?? ""
      const ref = this.#cbufRef(g(ev, 1), num(ev[2]))
      if (ref !== undefined) return [leaf("param", ref, comp)]
      const handle = agg.match(/%dx\.types\.Handle (%[\w.]+)/)?.[1]
      const t = handle === undefined ? "t?" : `t${this.#register(handle)}`
      if (agg.includes("@dx.op.rawBufferLoad")) return [leaf("sceneData", t, comp)]
      if (agg.includes("@dx.op.bufferLoad")) return [leaf("buffer", t, comp)]
      if (agg.includes("@dx.op.sample")) return [leaf("texture", t, comp)]
      return []
    }
    const [a, b] = operands(d)
    if (a !== undefined && b !== undefined) {
      if (d.startsWith("fmul")) return this.product(a, b, ctx, depth)
      // fdiv: the numerator keeps its scale (a perspective divide or a normalisation on the way).
      if (d.startsWith("fdiv")) return this.trace(a, this.#times(ctx, b, -1), depth + 1)
      // fadd / fsub: offsets; constants dropped, both sides keep the scale.
      return [...this.additive(a, ctx, depth), ...this.additive(b, ctx, depth)]
    }
    const mad = d.match(/@dx\.op\.tertiary\.f32\(i32 46, float (\S+), float (\S+), float (\S+)\)/)
    if (mad) return [...this.product(g(mad, 1), g(mad, 2), ctx, depth), ...this.additive(g(mad, 3), ctx, depth)]
    if (d.startsWith("phi ")) {
      return [...d.matchAll(/\[ (\S+), %[\w.]+ \]/g)].flatMap((m) => this.additive(g(m, 1), ctx, depth))
    }
    const sel = d.match(/^select i1 \S+, float (\S+), float (\S+)$/)
    if (sel) return [...this.additive(g(sel, 1), ctx, depth), ...this.additive(g(sel, 2), ctx, depth)]
    // Anything else (saturate, floor, sin, int conversions, comparisons...) is non-linear in its inputs: the
    // value no longer carries a texture coordinate's scale.
    return []
  }

  /** `a * b`: each side's sources, scaled by the other side; a literal side only scales. */
  product(a: string, b: string, ctx: Ctx, depth: number): Array<Leaf> {
    const ca = parseFloat(a), cb = parseFloat(b)
    if (ca !== undefined && cb !== undefined) {
      return [{ kind: "constant", source: String(ca * cb), component: "", ...ctx }]
    }
    if (ca !== undefined) return this.trace(b, this.#times(ctx, a), depth + 1)
    if (cb !== undefined) return this.trace(a, this.#times(ctx, b), depth + 1)
    return [...this.trace(a, this.#times(ctx, b), depth + 1), ...this.trace(b, this.#times(ctx, a), depth + 1)]
  }

  additive(v: string, ctx: Ctx, depth: number): Array<Leaf> {
    return parseFloat(v) === undefined ? this.trace(v, ctx, depth + 1) : []
  }
}

const ROOT: Ctx = { factor: 1, params: [], sceneDepth: 0, sceneScale: 0 }

/** A function that answers `dependsOnInput` with one shared cache for the module. */
export const inputDependency = (m: Module): (v: string) => boolean => {
  const tracer = new Tracer(m)
  return (v) => tracer.facts(v).hasInput
}

const dedupe = (leaves: ReadonlyArray<Leaf>): Array<Leaf> => {
  const seen = new Map<string, Leaf>()
  for (const l of leaves) seen.set(JSON.stringify(l), l)
  return [...seen.values()]
}

// The smallest literal the sample's first channel is multiplied by. A normal map is unpacked with `* 2 - 1`;
// a layer blended at strength s is also scaled by 2s somewhere, and the smaller factor is the one that
// tells the layers apart.
const resultFactorOf = (m: Module, sample: string): number | null => {
  const escaped = sample.replace(".", "\\.")
  let best: number | null = null
  for (const [e, d] of m.defs) {
    if (!new RegExp(`^extractvalue %dx\\.types\\.ResRet\\.f32 ${escaped}, 0$`).test(d)) continue
    const name = e.replace(".", "\\.")
    const use = new RegExp(`^fmul (?:fast )?float (?:${name}, (\\S+)|(\\S+), ${name})$`)
    for (const dd of m.defs.values()) {
      const u = dd.match(use)
      const c = u && parseFloat(u[1] ?? u[2] ?? "")
      if (c !== undefined && c !== null && (best === null || Math.abs(c) < Math.abs(best))) best = c
    }
  }
  return best
}

/** Every texture sample (`sample`, `sampleBias`, `sampleLevel`, `sampleGrad`) with its traced coordinates. */
export const samples = (m: Module): Array<Sample> => {
  const tracer = new Tracer(m)
  const all = [...m.defs.values()].join("\n")
  const out: Array<Sample> = []
  for (const [v, d] of m.defs) {
    const s = d.match(
      /@dx\.op\.(sample\w*)\.f32\(i32 \d+, %dx\.types\.Handle (%[\w.]+), %dx\.types\.Handle %[\w.]+, float (\S+), float (\S+), float (\S+)/
    )
    if (!s) continue
    const register = m.handles.get(g(s, 2))?.register ?? -1
    const kind = m.srvs.find((r) => r.register === register)?.kind
    const coordCount = kind === "Texture3D" || kind === "TextureCube" ? 3 : 2
    const used = [
      ...all.matchAll(new RegExp(`extractvalue %dx\\.types\\.ResRet\\.f32 ${v.replace(".", "\\.")}, (\\d)`, "g"))
    ]
      .map((x) => num(x[1]))
    const channels = [...new Set(used)].sort((x, y) => x - y).map((c) => XYZW[c]).join("")
    const coords = [g(s, 3), g(s, 4), g(s, 5)].slice(0, coordCount).map((c) => dedupe(tracer.trace(c, ROOT)))
    out.push({ value: v, op: g(s, 1), register, channels, coords, resultFactor: resultFactorOf(m, v) })
  }
  return out
}

/**
 * The grey-mottle chain the Ballest masters share: several reads of one texture, each offset by a constant,
 * multiplied together, scaled by a gain and added to 1 (`1 + k * P`, or `1 - k * P`), which then multiplies
 * the base colour. The gain is a literal or a parameter (optionally plus a literal, e.g. ColorContrast - 1).
 */
export interface Mottle {
  /** The sample values (`%n`) in product order. */
  readonly samples: ReadonlyArray<string>
  readonly offsets: ReadonlyArray<number>
  readonly gain: {
    readonly sign: number
    readonly constant: number
    readonly param?: string
    readonly paramAdd?: number
  }
}

export const mottleOf = (m: Module): Mottle | null => {
  const tracer = new Tracer(m)
  // sample channel 0 -> (+ offset) value
  const offsetOf = new Map<string, { sample: string; offset: number }>()
  for (const [e, d] of m.defs) {
    const ev = d.match(/^extractvalue %dx\.types\.ResRet\.f32 (%[\w.]+), 0$/)
    if (!ev || !(m.defs.get(g(ev, 1)) ?? "").includes("@dx.op.sample")) continue
    for (const [o, dd] of m.defs) {
      const add = dd.match(/^fadd (?:fast )?float (\S+), (\S+)$/)
      if (!add) continue
      const other = add[1] === e ? add[2] : add[2] === e ? add[1] : undefined
      const c = other === undefined ? undefined : parseFloat(other)
      if (c !== undefined) offsetOf.set(o, { sample: g(ev, 1), offset: c })
    }
  }
  // products of those values (through literal scalings)
  const members = new Map<string, Array<string>>()
  for (const [o] of offsetOf) members.set(o, [o])
  let grew = true
  while (grew) {
    grew = false
    for (const [v, d] of m.defs) {
      if (members.has(v)) continue
      const mul = d.match(/^fmul (?:fast )?float (\S+), (\S+)$/)
      if (!mul) continue
      const a = members.get(g(mul, 1)), b = members.get(g(mul, 2))
      if (a && b) members.set(v, [...a, ...b])
      else if (a && parseFloat(g(mul, 2)) !== undefined) members.set(v, a)
      else if (b && parseFloat(g(mul, 1)) !== undefined) members.set(v, b)
      else continue
      grew = true
    }
  }
  const [product] = [...members.entries()].filter(([, ms]) => ms.length >= 2).sort((x, y) => y[1].length - x[1].length)
  if (product === undefined) return null
  const [pv, pm] = product
  // literal factors folded into the product so far
  let constant = 1
  const foldConstants = (v: string): void => {
    const d = m.defs.get(v) ?? ""
    const mul = d.match(/^fmul (?:fast )?float (\S+), (\S+)$/)
    if (!mul) return
    const [a, b] = [g(mul, 1), g(mul, 2)]
    const ca = parseFloat(a), cb = parseFloat(b)
    if (ca !== undefined) constant *= ca
    else foldConstants(a)
    if (cb !== undefined) constant *= cb
    else foldConstants(b)
  }
  foldConstants(pv)
  // forward: multipliers until `1 + x` / `1 - x`
  let cur = pv
  let param: string | undefined
  let paramAdd: number | undefined
  for (let step = 0; step < 6; step++) {
    let next: string | undefined
    for (const [v, d] of m.defs) {
      const mul = d.match(/^fmul (?:fast )?float (\S+), (\S+)$/)
      if (mul && (mul[1] === cur || mul[2] === cur)) {
        const other = mul[1] === cur ? g(mul, 2) : g(mul, 1)
        const c = parseFloat(other)
        if (c !== undefined) constant *= c
        else {
          const od = m.defs.get(other) ?? ""
          const add = od.match(/^fadd (?:fast )?float (\S+), (\S+)$/)
          const base = add ? (parseFloat(g(add, 2)) === undefined ? g(add, 2) : g(add, 1)) : other
          const cbufs = [...tracer.facts(base).cbufRefs]
          if (cbufs.length !== 1 || tracer.facts(other).hasInput) return null
          param = cbufs[0]
          if (add) paramAdd = parseFloat(g(add, 1)) ?? parseFloat(g(add, 2)) ?? 0
        }
        next = v
        break
      }
      const done = (sign: number): Mottle => ({
        samples: pm.map((o) => offsetOf.get(o)?.sample ?? o),
        offsets: pm.map((o) => offsetOf.get(o)?.offset ?? 0),
        gain: param === undefined ? { sign, constant } : { sign, constant, param, paramAdd: paramAdd ?? 0 }
      })
      const add = d.match(/^fadd (?:fast )?float (\S+), (\S+)$/)
      if (add && (add[1] === cur || add[2] === cur) && parseFloat(add[1] === cur ? g(add, 2) : g(add, 1)) === 1) {
        return done(1)
      }
      const sub = d.match(/^fsub (?:fast )?float (\S+), (\S+)$/)
      if (sub?.[2] === cur && parseFloat(g(sub, 1)) === 1) return done(-1)
    }
    if (next === undefined) return null
    cur = next
  }
  return null
}

/** Every `storeOutput` of a vertex shader, by output semantic and component. */
export const outputsOf = (ir: string, m: Module): Array<Output> => {
  const tracer = new Tracer(m)
  const out: Array<Output> = []
  for (const s of ir.matchAll(/@dx\.op\.storeOutput\.f32\(i32 \d+, i32 (\d+), i32 (\d+), i8 (\d+), float (\S+)\)/g)) {
    out.push({
      semantic: semanticOf(m.outputs, num(s[1]), num(s[2])),
      component: XYZW[num(s[3])] ?? "",
      leaves: dedupe(tracer.trace(g(s, 4), ROOT))
    })
  }
  return out
}
