import { assert, describe, it } from "@effect/vitest"
import { decodePreshaders } from "./preshader.ts"

// opcode bytes, grouped per preshader for readability
const hex = (...parts: ReadonlyArray<string>) => Uint8Array.from(Buffer.from(parts.join(""), "hex"))

describe("preshader", () => {
  it("names plain parameter reads, constants, and leaves computed values alone", () => {
    // MI_Env_Blue_Tiles' first opcodes: Parameter 0..3 (UV Tile U, UV Offset U, UV Tile V, UV Offset V),
    // then a Float3 Parameter 4 with swizzles, then a Float1 constant 1.0, then a 2-opcode expression.
    const data = hex("030000030100030200030300", "0304002503000102ff2503000102ff", "02010000803f", "030500030600")
    const slots = decodePreshaders(data, [
      { Type: "Float1", BufferOffset: 0, OpcodeOffset: 0, OpcodeSize: 3 },
      { Type: "Float1", BufferOffset: 1, OpcodeOffset: 3, OpcodeSize: 3 },
      { Type: "Float1", BufferOffset: 2, OpcodeOffset: 6, OpcodeSize: 3 },
      { Type: "Float1", BufferOffset: 3, OpcodeOffset: 9, OpcodeSize: 3 },
      { Type: "Float3", BufferOffset: 4, OpcodeOffset: 12, OpcodeSize: 15 },
      { Type: "Float1", BufferOffset: 11, OpcodeOffset: 27, OpcodeSize: 6 },
      { Type: "Float1", BufferOffset: 12, OpcodeOffset: 33, OpcodeSize: 6 }
    ], [
      { ParameterInfo: { Name: "UV Tile U" }, ParameterType: "Scalar" },
      { ParameterInfo: { Name: "UV Offset U" }, ParameterType: "Scalar" },
      { ParameterInfo: { Name: "UV Tile V" }, ParameterType: "Scalar" },
      { ParameterInfo: { Name: "UV Offset V" }, ParameterType: "Scalar" },
      { ParameterInfo: { Name: "TriPlanar Rotation" }, ParameterType: "Vector" },
      { ParameterInfo: { Name: "A" }, ParameterType: "Scalar" },
      { ParameterInfo: { Name: "B" }, ParameterType: "Scalar" }
    ])
    assert.deepStrictEqual(slots.slice(0, 4), [
      { ref: "[0].x", param: "UV Tile U" },
      { ref: "[0].y", param: "UV Offset U" },
      { ref: "[0].z", param: "UV Tile V" },
      { ref: "[0].w", param: "UV Offset V" }
    ])
    assert.deepStrictEqual(slots.slice(4, 7), [
      { ref: "[1].x", param: "TriPlanar Rotation.x" },
      { ref: "[1].y", param: "TriPlanar Rotation.y" },
      { ref: "[1].z", param: "TriPlanar Rotation.z" }
    ])
    assert.deepStrictEqual(slots[7], { ref: "[2].w", constant: 1 })
    assert.deepStrictEqual(slots[8], { ref: "[3].x", expression: true })
  })
})
