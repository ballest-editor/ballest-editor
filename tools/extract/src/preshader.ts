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
const OP_SWIZZLE = 0x25

export interface Slot {
  /** `cbN[reg].c` style, without the buffer: `[reg].c`. */
  readonly ref: string
  readonly param?: string
  readonly constant?: number
  readonly expression?: true
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
      // Parameter (3 bytes) followed only by swizzles (6 bytes each) is still a plain read of it.
      let trivial = (p.OpcodeSize - 3) % 6 === 0
      for (let at = p.OpcodeOffset + 3; trivial && at < p.OpcodeOffset + p.OpcodeSize; at += 6) {
        trivial = data[at] === OP_SWIZZLE
      }
      if (name !== undefined && trivial) {
        refs.forEach((ref, i) => out.push({ ref, param: width > 1 ? `${name}.${"xyzw"[i]}` : name }))
        continue
      }
    }
    if (op === OP_CONSTANT && p.OpcodeSize === 6) {
      const value = view.getFloat32(p.OpcodeOffset + 2, true)
      for (const ref of refs) out.push({ ref, constant: value })
      continue
    }
    for (const ref of refs) out.push({ ref, expression: true })
  }
  return out
}
