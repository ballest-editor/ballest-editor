import { assert, describe, it } from "@effect/vitest"
import { parseModule } from "./dxil.ts"
import { Evaluator, SIDE, surfaceOf, UP } from "./evaluate.ts"

// The beam materials' cap mask, in the shape dxc -dumpbin prints: the vertex normal (TEXCOORD11) dotted
// with the z component of three rows of the primitive's local-to-world transform (raw buffer loads) is
// the world normal's z; the alpha is 4 * read * (1 - |z|). A dot of plain constants is just computed.
const PS = `
define void @MainPS() {
  %1 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 11, i32 11, i32 0, i8 0 }, i32 11, i1 false)
  %2 = call %dx.types.Handle @dx.op.annotateHandle(i32 216, %dx.types.Handle %1, %dx.types.ResourceProperties { i32 12, i32 16 })
  %10 = call float @dx.op.loadInput.f32(i32 4, i32 1, i32 0, i8 0, i32 undef)
  %11 = call float @dx.op.loadInput.f32(i32 4, i32 1, i32 0, i8 1, i32 undef)
  %12 = call float @dx.op.loadInput.f32(i32 4, i32 1, i32 0, i8 2, i32 undef)
  %20 = call %dx.types.ResRet.f32 @dx.op.rawBufferLoad.f32(i32 139, %dx.types.Handle %2, i32 0, i32 0, i8 15, i32 4)
  %21 = extractvalue %dx.types.ResRet.f32 %20, 2
  %22 = call %dx.types.ResRet.f32 @dx.op.rawBufferLoad.f32(i32 139, %dx.types.Handle %2, i32 16, i32 0, i8 15, i32 4)
  %23 = extractvalue %dx.types.ResRet.f32 %22, 2
  %24 = call %dx.types.ResRet.f32 @dx.op.rawBufferLoad.f32(i32 139, %dx.types.Handle %2, i32 32, i32 0, i8 15, i32 4)
  %25 = extractvalue %dx.types.ResRet.f32 %24, 2
  %26 = fmul fast float %25, 5.000000e-01
  %30 = call float @dx.op.dot3.f32(i32 55, float %10, float %11, float %12, float %21, float %23, float %26)
  %31 = call float @dx.op.unary.f32(i32 6, float %30)
  %32 = fsub fast float 1.000000e+00, %31
  %33 = fmul fast float %32, 4.000000e+00
  %40 = call float @dx.op.dot2.f32(i32 54, float 2.000000e+00, float 3.000000e+00, float 4.000000e+00, float 5.000000e+00)
  %41 = call float @dx.op.dot3.f32(i32 55, float %10, float %11, float %12, float 0.000000e+00, float 0.000000e+00, float 1.000000e+00)
  ret void
}
!dx.resources = !{!4}
!dx.entryPoints = !{!38}
!4 = !{!5, null, null, null}
!5 = !{!20}
!20 = !{i32 0, %"class.StructuredBuffer<vector<float, 4> >"* undef, !"", i32 0, i32 11, i32 1, i32 12, i32 0, !19}
!38 = !{void ()* @MainPS, !"MainPS", !39, !4, null}
!39 = !{!40, null, null}
!40 = !{!46}
!46 = !{i32 1, !"TEXCOORD11_centroid", i8 9, i8 0, !47, i8 2, i32 1, i8 4, i32 1, i8 0, null}
!47 = !{i32 0}
`

// A base pass in the shape dxc -dumpbin prints, with one material texture read (t16). Opaque: the GBuffer
// (target 3 = base colour, target 2 = metallic / roughness) and the scene colour (target 0). Translucent:
// no GBuffer; the base colour is the diffuse term the engine scales by View.DiffuseOverrideParameter
// (View[161]: .w multiplies, .xyz adds) and the alpha is target 0's .w.
const common = (body: string, targets: string) => `
define void @MainPS() {
  %1 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 16, i32 16, i32 0, i8 0 }, i32 16, i1 false)
  %2 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 3, i32 3, i32 0, i8 2 }, i32 3, i1 false)
  %3 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 0, i32 0, i32 0, i8 2 }, i32 0, i1 false)
  %10 = call float @dx.op.loadInput.f32(i32 4, i32 2, i32 0, i8 0, i32 undef)
  %11 = call float @dx.op.loadInput.f32(i32 4, i32 2, i32 0, i8 1, i32 undef)
  %20 = call %dx.types.ResRet.f32 @dx.op.sample.f32(i32 60, %dx.types.Handle %1, %dx.types.Handle %1, float %10, float %11, float undef, float undef, i32 0, i32 0, i32 undef, float undef)
  %21 = extractvalue %dx.types.ResRet.f32 %20, 0
  %22 = extractvalue %dx.types.ResRet.f32 %20, 1
  %23 = extractvalue %dx.types.ResRet.f32 %20, 2
  %30 = call %dx.types.CBufRet.f32 @dx.op.cbufferLoadLegacy.f32(i32 59, %dx.types.Handle %2, i32 0)
  %31 = extractvalue %dx.types.CBufRet.f32 %30, 0
${body}${targets}
  ret void
}
!dx.resources = !{!4}
!dx.entryPoints = !{!38}
!4 = !{!5, null, !27, null}
!5 = !{!25}
!25 = !{i32 1, %"class.Texture2D<vector<float, 4> >"* undef, !"", i32 0, i32 16, i32 1, i32 2, i32 0, !9}
!27 = !{!31, !32}
!31 = !{i32 0, %Material* undef, !"", i32 0, i32 3, i32 1, i32 188, null}
!32 = !{i32 1, %"hostlayout.View"* undef, !"", i32 0, i32 0, i32 1, i32 6748, null}
!38 = !{void ()* @MainPS, !"MainPS", !39, !4, null}
!39 = !{!40, !54, null}
!40 = !{!48}
!48 = !{i32 2, !"TEXCOORD", i8 9, i8 0, !47, i8 2, i32 1, i8 4, i32 2, i8 0, null}
!47 = !{i32 0}
!54 = !{!55}
!55 = !{i32 0, !"SV_Target", i8 9, i8 16, !56, i8 0, i32 4, i8 4, i32 0, i8 0, null}
!56 = !{i32 0, i32 1, i32 2, i32 3}
`
const store = (target: number, channel: number, value: string) =>
  `  call void @dx.op.storeOutput.f32(i32 5, i32 0, i32 ${target}, i8 ${channel}, float ${value})\n`
const OPAQUE = common(
  `  %40 = fmul fast float %21, %31
  %41 = fmul fast float %21, 5.000000e-01
`,
  store(0, 0, "0.000000e+00") + store(0, 1, "0.000000e+00") + store(0, 2, "0.000000e+00") +
    store(2, 0, "0.000000e+00") + store(2, 2, "%41") +
    store(3, 0, "%40") + store(3, 1, "%22") + store(3, 2, "%23")
)
const TRANSLUCENT = common(
  `  %50 = call %dx.types.CBufRet.f32 @dx.op.cbufferLoadLegacy.f32(i32 59, %dx.types.Handle %3, i32 161)
  %51 = extractvalue %dx.types.CBufRet.f32 %50, 0
  %52 = extractvalue %dx.types.CBufRet.f32 %50, 1
  %53 = extractvalue %dx.types.CBufRet.f32 %50, 2
  %54 = extractvalue %dx.types.CBufRet.f32 %50, 3
  %60 = fmul fast float %21, %54
  %61 = fadd fast float %60, %51
  %62 = fmul fast float %22, %54
  %63 = fadd fast float %62, %52
  %64 = fmul fast float %23, %54
  %65 = fadd fast float %64, %53
  %70 = fmul fast float %21, 5.000000e-01
`,
  store(0, 0, "0x3FB99999A0000000") + store(0, 1, "0x3FB99999A0000000") + store(0, 2, "0x3FB99999A0000000") +
    store(0, 3, "%70")
)
const means = (_: string, channel: number) => [0.25, 0.5, 0.75][channel] ?? 0
const cbuf = (ref: string) => (ref === "Material[0].x" ? 2 : undefined)

describe("surfaceOf", () => {
  it("reads an opaque pass off the GBuffer, with each colour read's gain around its mean", () => {
    const s = surfaceOf(parseModule(OPAQUE), OPAQUE, cbuf, means, ["%20"])
    assert.deepStrictEqual(s?.baseColor, [0.5, 0.5, 0.75]) // read * parameter, read, read
    assert.deepStrictEqual([s?.metallic, s?.roughness], [0, 0.125])
    assert.deepStrictEqual([s?.opacity, s?.opacitySide, s?.alphaRange], [null, null, null])
    assert.deepStrictEqual(s?.gains, { "%20": [2, 1, 1] })
    assert.deepStrictEqual(s?.alphaGains, {})
    assert.deepStrictEqual(s?.emissive, [0, 0, 0])
  })

  it("reads a translucent pass off the diffuse override term and the scene alpha", () => {
    const s = surfaceOf(parseModule(TRANSLUCENT), TRANSLUCENT, cbuf, means, ["%20"])
    assert.deepStrictEqual(s?.baseColor, [0.25, 0.5, 0.75])
    assert.deepStrictEqual([s?.metallic, s?.roughness], [null, null])
    assert.deepStrictEqual([s?.opacity, s?.opacitySide], [0.125, 0.125])
    assert.deepStrictEqual(s?.alphaRange, [0, 0.5])
    assert.deepStrictEqual(s?.alphaGains, { "%20": 0.5 })
    assert.closeTo(s?.emissive[0] ?? 0, 0.1, 1e-6)
    // a pass that stores no scene colour cannot be evaluated
    assert.isNull(surfaceOf(parseModule(common("", "")), common("", ""), cbuf, means, []))
  })
})

describe("Evaluator", () => {
  const env = { cbuf: () => undefined, sample: () => 0.5 }
  it("reads a dot of the vertex normal with transform rows as the world normal's component", () => {
    const m = parseModule(PS)
    const up = new Evaluator(m, { ...env, normal: UP })
    assert.strictEqual(up.value("%30"), 1)
    assert.strictEqual(up.value("%33"), 0) // the cap: masked
    const side = new Evaluator(m, { ...env, normal: SIDE })
    assert.strictEqual(side.value("%30"), 0)
    assert.strictEqual(side.value("%33"), 4) // a vertical face: shown
    assert.strictEqual(new Evaluator(m, env).value("%33"), 0) // facing up by default
  })
  it("computes a dot of known values and reads other input dots as facing", () => {
    const m = parseModule(PS)
    const e = new Evaluator(m, { ...env, normal: SIDE })
    assert.strictEqual(e.value("%40"), 2 * 4 + 3 * 5)
    assert.strictEqual(e.value("%41"), 1)
  })
})
