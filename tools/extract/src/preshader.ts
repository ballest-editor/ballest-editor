// UE's material preshader: a tiny bytecode per uniform expression that the CPU evaluates into the Material
// constant buffer. The cooked `UniformExpressionSet` keeps it, so it is what maps a constant-buffer slot the
// pixel shader reads back to a material parameter name. Only the trivial programs (one Parameter opcode,
// optionally swizzled) are resolved; anything computed (products, lerps) is reported as such.

export interface Preshader {
  readonly Type: string
  readonly BufferOffset: number
  readonly OpcodeOffset: number
  readonly OpcodeSize: number
}

export interface NumericParameter {
  readonly ParameterInfo: { readonly Name: string }
  readonly ParameterType: string
}

const OP_CONSTANT = 0x02
const OP_PARAMETER = 0x03
// Unary ops: Power(x, -1) compiles to Log, Constant -1, Mul, Exp (so 1/SizeBase2 is exp(-1 * log(SizeBase2))).
const OP_EXP = 0x17
const OP_LOG = 0x1b
const OP_SWIZZLE = 0x25

export interface Slot {
  /** `cbN[reg].c` style, without the buffer: `[reg].c`. */
  readonly ref: string
  readonly param?: string
  readonly constant?: number
  /** A computed value: the preshader program (hex) and which component of its result this slot holds. */
  readonly expression?: { readonly program: string; readonly component: number }
}

const OP_ADD = 0x04
const OP_SUB = 0x05
const OP_MUL = 0x06
const OP_DIV = 0x07
const OP_APPEND = 0x26

/**
 * Runs a preshader program on a stack of float vectors. Parameters come from `param(index)` (a scalar as
 * [x], a vector as [r, g, b, a]). Returns the result vector, or null at an opcode this does not know.
 */
export const runPreshader = (
  program: Uint8Array,
  param: (index: number) => ReadonlyArray<number> | undefined
): ReadonlyArray<number> | null => {
  const view = new DataView(program.buffer, program.byteOffset, program.byteLength)
  const stack: Array<ReadonlyArray<number>> = []
  const binary = (f: (a: number, b: number) => number): boolean => {
    const b = stack.pop(), a = stack.pop()
    if (a === undefined || b === undefined) return false
    const n = Math.max(a.length, b.length)
    stack.push(Array.from({ length: n }, (_, i) => f(a[a.length === 1 ? 0 : i] ?? 0, b[b.length === 1 ? 0 : i] ?? 0)))
    return true
  }
  for (let at = 0; at < program.length;) {
    const op = program[at]
    if (op === OP_CONSTANT) {
      const width = program[at + 1] ?? 1
      const v: Array<number> = []
      for (let i = 0; i < width; i++) v.push(view.getFloat32(at + 2 + i * 4, true))
      stack.push(v)
      at += 2 + width * 4
    } else if (op === OP_PARAMETER) {
      const v = param(view.getUint16(at + 1, true))
      if (v === undefined) return null
      stack.push(v)
      at += 3
    } else if (op === OP_SWIZZLE) {
      const src = stack.pop()
      if (src === undefined) return null
      const count = program[at + 1] ?? 0
      const out: Array<number> = []
      for (let i = 0; i < count; i++) out.push(src[program[at + 2 + i] ?? 0] ?? 0)
      stack.push(out)
      at += 6
    } else if (op === OP_EXP || op === OP_LOG) {
      const src = stack.pop()
      if (src === undefined) return null
      stack.push(src.map(op === OP_EXP ? Math.exp : Math.log))
      at += 1
    } else if (op === OP_APPEND) {
      const b = stack.pop(), a = stack.pop()
      if (a === undefined || b === undefined) return null
      stack.push([...a, ...b])
      at += 1
    } else if (op === OP_ADD || op === OP_SUB || op === OP_MUL || op === OP_DIV) {
      const ok = binary(
        op === OP_ADD
          ? (a, b) => a + b
          : op === OP_SUB
          ? (a, b) => a - b
          : op === OP_MUL
          ? (a, b) => a * b
          : (a, b) => (b === 0 ? 0 : a / b)
      )
      if (!ok) return null
      at += 1
    } else {
      return null
    }
  }
  return stack.length === 1 ? stack[0] ?? null : null
}

/** Which float of the material constant buffer each preshader writes, resolved to its parameter when trivial. */
export const decodePreshaders = (
  data: Uint8Array,
  preshaders: ReadonlyArray<Preshader>,
  params: ReadonlyArray<NumericParameter>
): Array<Slot> => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const out: Array<Slot> = []
  for (const p of preshaders) {
    const width = p.Type === "Float1" ? 1 : p.Type === "Float2" ? 2 : p.Type === "Float3" ? 3 : 4
    const refs = Array.from({ length: width }, (_, i) => {
      const off = p.BufferOffset + i
      return `[${Math.floor(off / 4)}].${"xyzw"[off % 4]}`
    })
    const op = data[p.OpcodeOffset]
    if (op === OP_PARAMETER && p.OpcodeOffset + 3 <= data.length) {
      const index = view.getUint16(p.OpcodeOffset + 1, true)
      const name = params[index]?.ParameterInfo.Name
      // Parameter (3 bytes) followed only by swizzles (6 bytes each) is still a plain read of it: the
      // swizzles compose into which component of the parameter each slot component holds.
      let trivial = (p.OpcodeSize - 3) % 6 === 0
      let components = [0, 1, 2, 3]
      for (let at = p.OpcodeOffset + 3; trivial && at < p.OpcodeOffset + p.OpcodeSize; at += 6) {
        trivial = data[at] === OP_SWIZZLE
        const count = data[at + 1] ?? 0
        const previous = components
        components = Array.from({ length: count }, (_, i) => previous[data[at + 2 + i] ?? 0] ?? 0)
      }
      if (name !== undefined && trivial) {
        const vector = params[index]?.ParameterType === "Vector"
        refs.forEach((ref, i) => out.push({ ref, param: vector ? `${name}.${"xyzw"[components[i] ?? i]}` : name }))
        continue
      }
    }
    if (op === OP_CONSTANT && p.OpcodeSize === 6) {
      const value = view.getFloat32(p.OpcodeOffset + 2, true)
      for (const ref of refs) out.push({ ref, constant: value })
      continue
    }
    const program = Buffer.from(data.subarray(p.OpcodeOffset, p.OpcodeOffset + p.OpcodeSize)).toString("hex")
    refs.forEach((ref, i) => out.push({ ref, expression: { program, component: i } }))
  }
  return out
}

/** A slot's value for a material: its constant, its parameter, or its program run on the parameters. */
export const slotValue = (
  slot: Slot,
  paramNames: ReadonlyArray<string>,
  valueOf: (name: string) => number | undefined,
  vectorOf: (name: string) => ReadonlyArray<number> | undefined
): number | undefined => {
  if (slot.constant !== undefined) return slot.constant
  if (slot.param !== undefined) return valueOf(slot.param)
  if (slot.expression === undefined) return undefined
  const result = runPreshader(Uint8Array.from(Buffer.from(slot.expression.program, "hex")), (i) => {
    const name = paramNames[i]
    if (name === undefined) return undefined
    const vec = vectorOf(name)
    if (vec !== undefined) return vec
    const scalar = valueOf(name)
    return scalar === undefined ? undefined : [scalar]
  })
  return result === null ? undefined : result[slot.expression.component]
}
