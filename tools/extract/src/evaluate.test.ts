import { assert, describe, it } from "@effect/vitest"
import { parseModule } from "./dxil.ts"
import { Evaluator, SIDE, UP } from "./evaluate.ts"

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
