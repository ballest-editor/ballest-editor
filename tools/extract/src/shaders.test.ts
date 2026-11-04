import { assert, describe, it } from "@effect/vitest"
import type { Module } from "./dxil.ts"
import { materialTextureRegisters } from "./shaders.ts"

const moduleOf = (registers: ReadonlyArray<number>): Pick<Module, "srvs"> => ({
  srvs: registers.map((register) => ({ register, kind: "Texture2D" }))
})

describe("materialTextureRegisters", () => {
  it("takes the top Texture2D registers, in order, when the shader reads them all", () => {
    const reads = [20, 21, 22].map((register) => ({ register, normal: false }))
    assert.deepStrictEqual(materialTextureRegisters(moduleOf([3, 20, 21, 22]), 3, reads, () => false), [20, 21, 22])
  })

  it("has none for a material with no textures", () => {
    assert.deepStrictEqual(materialTextureRegisters(moduleOf([3, 20]), 0, [], () => false), [])
  })

  it("closes up the registers of a parameter the compiler left out", () => {
    // M_CheckpointLight: five parameters, the last (a gradient) unread, four registers. Without this the top five
    // take an engine texture for the first, and every slot lands one texture off.
    const reads = [
      { register: 20, normal: true },
      { register: 21, normal: false },
      { register: 22, normal: false },
      { register: 23, normal: false }
    ]
    const slotIsNormal = (slot: number) => slot === 0
    assert.deepStrictEqual(
      materialTextureRegisters(moduleOf([3, 19, 20, 21, 22, 23]), 5, reads, slotIsNormal),
      [20, 21, 22, 23, -1]
    )
  })

  it("leaves out the slot that lets a normal-decoded read land on a normal map", () => {
    const reads = [{ register: 21, normal: true }, { register: 22, normal: false }]
    const slotIsNormal = (slot: number) => slot === 1
    assert.deepStrictEqual(materialTextureRegisters(moduleOf([3, 20, 21, 22]), 3, reads, slotIsNormal), [-1, 21, 22])
  })
})
