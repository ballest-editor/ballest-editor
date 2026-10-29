import { assert, describe, it } from "@effect/vitest"
import { instructionOf, mottleOf, outputsOf, parseFloat, parseModule, samples } from "./dxil.ts"

// A pixel shader in the shape dxc -dumpbin prints: one material texture read whose u is
// TEXCOORD0.x * 12 * cb3[0].x, scaled by the length of a GPU-scene row (the instance scale), and whose
// v is TEXCOORD0.y * 12; and an engine texture read from SV_Position.
const PS = `
define void @MainPS() {
  %1 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 16, i32 16, i32 0, i8 0 }, i32 16, i1 false)
  %2 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 3, i32 3, i32 0, i8 2 }, i32 3, i1 false)
  %3 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 11, i32 11, i32 0, i8 0 }, i32 11, i1 false)
  %4 = call %dx.types.Handle @dx.op.annotateHandle(i32 216, %dx.types.Handle %1, %dx.types.ResourceProperties { i32 2, i32 1033 })
  %5 = call %dx.types.Handle @dx.op.annotateHandle(i32 216, %dx.types.Handle %2, %dx.types.ResourceProperties { i32 13, i32 188 })
  %6 = call %dx.types.Handle @dx.op.annotateHandle(i32 216, %dx.types.Handle %3, %dx.types.ResourceProperties { i32 12, i32 16 })
  %10 = call float @dx.op.loadInput.f32(i32 4, i32 2, i32 0, i8 0, i32 undef)
  %11 = call float @dx.op.loadInput.f32(i32 4, i32 2, i32 0, i8 1, i32 undef)
  %12 = call %dx.types.CBufRet.f32 @dx.op.cbufferLoadLegacy.f32(i32 59, %dx.types.Handle %5, i32 0)
  %13 = extractvalue %dx.types.CBufRet.f32 %12, 0
  %14 = call %dx.types.ResRet.f32 @dx.op.rawBufferLoad.f32(i32 139, %dx.types.Handle %6, i32 4, i32 0, i8 15, i32 4)
  %15 = extractvalue %dx.types.ResRet.f32 %14, 0
  %16 = fmul fast float %15, %15
  %17 = call float @dx.op.unary.f32(i32 24, float %16)
  %20 = fmul fast float %10, 1.200000e+01
  %21 = fmul fast float %20, %13
  %22 = fadd fast float %21, 5.000000e-01
  %23 = fmul fast float %22, %17
  %24 = fmul fast float %11, 1.200000e+01
  %30 = call %dx.types.ResRet.f32 @dx.op.sampleBias.f32(i32 61, %dx.types.Handle %4, %dx.types.Handle %4, float %23, float %24, float undef, float undef, i32 0, i32 0, i32 undef, float -1.000000e+00, float undef)
  %31 = extractvalue %dx.types.ResRet.f32 %30, 0
  %32 = extractvalue %dx.types.ResRet.f32 %30, 1
  %33 = fmul fast float %31, 2.000000e+00
  ret void
}
!dx.resources = !{!4}
!dx.entryPoints = !{!38}
!4 = !{!5, null, !27, null}
!5 = !{!20, !25}
!20 = !{i32 0, %"class.StructuredBuffer<vector<float, 4> >"* undef, !"", i32 0, i32 11, i32 1, i32 12, i32 0, !19}
!25 = !{i32 1, %"class.Texture2D<vector<float, 4> >"* undef, !"", i32 0, i32 16, i32 1, i32 2, i32 0, !9}
!27 = !{!31}
!31 = !{i32 0, %Material* undef, !"", i32 0, i32 3, i32 1, i32 188, null}
!38 = !{void ()* @MainPS, !"MainPS", !39, !4, null}
!39 = !{!40, !54, null}
!40 = !{!46, !52}
!46 = !{i32 2, !"TEXCOORD", i8 9, i8 0, !47, i8 2, i32 2, i8 4, i32 2, i8 0, null}
!47 = !{i32 0, i32 1}
!52 = !{i32 5, !"SV_Position", i8 9, i8 3, !42, i8 4, i32 1, i8 4, i32 6, i8 0, null}
!42 = !{i32 0}
!54 = !{!55}
!55 = !{i32 0, !"SV_Target", i8 9, i8 16, !42, i8 0, i32 1, i8 4, i32 0, i8 0, null}
`

const VS = `
define void @MainVS() {
  %1 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 5, i32 5, i32 0, i8 0 }, i32 5, i1 false)
  %2 = call %dx.types.Handle @dx.op.annotateHandle(i32 216, %dx.types.Handle %1, %dx.types.ResourceProperties { i32 10, i32 521 })
  %10 = call float @dx.op.loadInput.f32(i32 0, i32 0, i32 0, i8 0, i32 undef)
  %11 = call %dx.types.ResRet.f32 @dx.op.bufferLoad.f32(i32 68, %dx.types.Handle %2, i32 7, i32 undef)
  %12 = extractvalue %dx.types.ResRet.f32 %11, 0
  %13 = fmul fast float %10, 5.000000e-03
  call void @dx.op.storeOutput.f32(i32 5, i32 1, i32 0, i8 0, float %13)
  call void @dx.op.storeOutput.f32(i32 5, i32 1, i32 1, i8 0, float %12)
  ret void
}
!dx.resources = !{!4}
!dx.entryPoints = !{!38}
!4 = !{!5, null, null, null}
!5 = !{!6}
!6 = !{i32 0, %"class.Buffer<vector<float, 4> >"* undef, !"", i32 0, i32 5, i32 1, i32 10, i32 0, !9}
!38 = !{void ()* @MainVS, !"MainVS", !39, !4, null}
!39 = !{!40, !54, null}
!40 = !{!41}
!41 = !{i32 0, !"ATTRIBUTE", i8 9, i8 0, !42, i8 0, i32 1, i8 4, i32 0, i8 0, null}
!42 = !{i32 0}
!54 = !{!55}
!55 = !{i32 1, !"TEXCOORD", i8 9, i8 0, !56, i8 2, i32 2, i8 4, i32 2, i8 0, null}
!56 = !{i32 0, i32 1}
`

// The Env masters' grey mottle: two reads of one texture, each offset by 0.5, multiplied, scaled by
// ColorContrast - 1 (a Material constant-buffer float) and taken off 1.
const MOTTLE = `
define void @MainPS() {
  %1 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 16, i32 16, i32 0, i8 0 }, i32 16, i1 false)
  %2 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 3, i32 3, i32 0, i8 2 }, i32 3, i1 false)
  %10 = call float @dx.op.loadInput.f32(i32 4, i32 2, i32 0, i8 0, i32 undef)
  %11 = call float @dx.op.loadInput.f32(i32 4, i32 2, i32 0, i8 1, i32 undef)
  %12 = fmul fast float %10, 2.000000e+00
  %20 = call %dx.types.ResRet.f32 @dx.op.sample.f32(i32 60, %dx.types.Handle %1, %dx.types.Handle %1, float %10, float %11, float undef, float undef, i32 0, i32 0, i32 undef, float undef)
  %21 = extractvalue %dx.types.ResRet.f32 %20, 0
  %22 = call %dx.types.ResRet.f32 @dx.op.sample.f32(i32 60, %dx.types.Handle %1, %dx.types.Handle %1, float %12, float %11, float undef, float undef, i32 0, i32 0, i32 undef, float undef)
  %23 = extractvalue %dx.types.ResRet.f32 %22, 0
  %30 = fadd fast float %21, 5.000000e-01
  %31 = fadd fast float %23, 0x3FD0000000000000
  %32 = fmul fast float %30, %31
  %40 = call %dx.types.CBufRet.f32 @dx.op.cbufferLoadLegacy.f32(i32 59, %dx.types.Handle %2, i32 0)
  %41 = extractvalue %dx.types.CBufRet.f32 %40, 2
  %42 = fadd fast float %41, -1.000000e+00
  %43 = fmul fast float %32, %42
  %44 = fsub fast float 1.000000e+00, %43
  ret void
}
`

describe("dxil", () => {
  it("reads LLVM's hex doubles", () => {
    assert.strictEqual(parseFloat("0x3FF0000000000000"), 1)
    assert.closeTo(parseFloat("0x3FD99999A0000000")!, 0.4, 1e-6)
    assert.strictEqual(parseFloat("1.200000e+01"), 12)
    assert.isUndefined(parseFloat("%7"))
  })

  it("finds resources, signatures and the material constant buffer", () => {
    const m = parseModule(PS)
    assert.deepStrictEqual(m.cbuffers, [{ register: 3, type: "Material", size: 188 }])
    assert.deepStrictEqual(m.srvs.map((s) => `${s.kind}@t${s.register}`), ["StructuredBuffer@t11", "Texture2D@t16"])
    assert.deepStrictEqual(m.inputs.map((s) => s.name), ["TEXCOORD", "SV_Position"])
  })

  it("traces a sample's coordinates to interpolants, constants, parameters and the instance scale", () => {
    const [read] = samples(parseModule(PS))
    assert.isDefined(read)
    assert.strictEqual(read.register, 16)
    assert.strictEqual(read.channels, "xy")
    assert.strictEqual(read.resultFactor, 2)
    const u = read.coords[0]!.find((l) => l.kind === "input")!
    assert.strictEqual(u.source, "TEXCOORD0")
    assert.strictEqual(u.component, "x")
    assert.strictEqual(u.factor, 12)
    assert.deepStrictEqual(u.params, ["cb3[0].x"])
    assert.strictEqual(u.sceneScale, 1)
    assert.strictEqual(u.sceneDepth, 0)
    const v = read.coords[1]!.find((l) => l.kind === "input")!
    assert.strictEqual(v.component, "y")
    assert.strictEqual(v.factor, 12)
    assert.strictEqual(v.sceneScale, 0)
    // the additive 0.5 offset is not a source
    assert.isFalse(read.coords[0]!.some((l) => l.kind === "constant" && l.source === "0.5"))
  })

  it("reads an instruction once per module, in every shape the walkers need", () => {
    const m = parseModule(PS)
    assert.deepStrictEqual(instructionOf(m, "%10"), { kind: "input", id: 2, row: 0, component: 0 })
    assert.deepStrictEqual(instructionOf(m, "%13"), { kind: "extract", aggregate: "%12", channel: 0 })
    assert.deepStrictEqual(instructionOf(m, "%12"), { kind: "cbuffer", type: "f32", handle: "%5", index: 0 })
    assert.deepStrictEqual(instructionOf(m, "%14"), { kind: "rawLoad", handle: "%6", index: "4" })
    assert.deepStrictEqual(instructionOf(m, "%20"), { kind: "float", op: "fmul", a: "%10", b: "1.200000e+01" })
    assert.deepStrictEqual(instructionOf(m, "%17"), { kind: "unary", op: "24", x: "%16" })
    assert.deepStrictEqual(instructionOf(m, "%30"), {
      kind: "sample",
      op: "sampleBias",
      handle: "%4",
      coords: ["%23", "%24", "undef"]
    })
    assert.strictEqual(instructionOf(m, "%30"), instructionOf(m, "%30")) // cached
    assert.deepStrictEqual(instructionOf(m, "%1")?.kind, "other")
    assert.isUndefined(instructionOf(m, "%99"))
  })

  it("finds the grey-mottle chain: offset reads, their product, the gain and its parameter", () => {
    const mottle = mottleOf(parseModule(MOTTLE))
    assert.deepStrictEqual(mottle?.samples, ["%20", "%22"])
    assert.deepStrictEqual(mottle?.offsets, [0.5, 0.25])
    assert.deepStrictEqual(mottle?.gain, { sign: -1, constant: 1, param: "cb3[0].z", paramAdd: -1 })
    // a shader without a product of offset reads has none
    assert.isNull(mottleOf(parseModule(PS)))
  })

  it("traces vertex outputs to the position attribute and vertex-fetched buffers", () => {
    const m = parseModule(VS)
    const outs = outputsOf(VS, m)
    assert.deepStrictEqual(outs.map((o) => `${o.semantic}.${o.component}`), ["TEXCOORD0.x", "TEXCOORD1.x"])
    assert.deepStrictEqual(outs[0]!.leaves.map((l) => [l.kind, l.source, l.factor]), [["input", "ATTRIBUTE0", 0.005]])
    assert.deepStrictEqual(outs[1]!.leaves.map((l) => [l.kind, l.source]), [["buffer", "t5"]])
  })
})
