import { assert, describe, it } from "@effect/vitest"
import { parseModule } from "./dxil.ts"
import { Evaluator } from "./evaluate.ts"
import { emitProgram, glslFloat } from "./glsl.ts"

// A translucent pass's alpha in the shape dxc -dumpbin prints: a material texture (t16) read at the UV
// scrolled by the game time, scaled by a parameter, masked by 1 - |world normal z| (the normal against
// the z of three local-to-world rows), with a decal phi merging back the plain path.
const PS = `
define void @MainPS() {
  %1 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 16, i32 16, i32 0, i8 0 }, i32 16, i1 false)
  %2 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 11, i32 11, i32 0, i8 0 }, i32 11, i1 false)
  %3 = call %dx.types.Handle @dx.op.createHandleFromBinding(i32 217, %dx.types.ResBind { i32 0, i32 0, i32 0, i8 2 }, i32 0, i1 false)
  %4 = call %dx.types.Handle @dx.op.annotateHandle(i32 216, %dx.types.Handle %1, %dx.types.ResourceProperties { i32 2, i32 1033 })
  %5 = call %dx.types.Handle @dx.op.annotateHandle(i32 216, %dx.types.Handle %2, %dx.types.ResourceProperties { i32 12, i32 16 })
  %6 = call %dx.types.Handle @dx.op.annotateHandle(i32 216, %dx.types.Handle %3, %dx.types.ResourceProperties { i32 13, i32 6748 })
  %10 = call float @dx.op.loadInput.f32(i32 4, i32 2, i32 0, i8 0, i32 undef)
  %11 = call float @dx.op.loadInput.f32(i32 4, i32 2, i32 0, i8 1, i32 undef)
  %12 = call float @dx.op.loadInput.f32(i32 4, i32 1, i32 0, i8 0, i32 undef)
  %13 = call float @dx.op.loadInput.f32(i32 4, i32 1, i32 0, i8 1, i32 undef)
  %14 = call float @dx.op.loadInput.f32(i32 4, i32 1, i32 0, i8 2, i32 undef)
  %20 = call %dx.types.CBufRet.f32 @dx.op.cbufferLoadLegacy.f32(i32 59, %dx.types.Handle %6, i32 167)
  %21 = extractvalue %dx.types.CBufRet.f32 %20, 2
  %22 = fmul fast float %21, 2.000000e+00
  %23 = fadd fast float %22, %11
  %30 = call %dx.types.ResRet.f32 @dx.op.sample.f32(i32 60, %dx.types.Handle %4, %dx.types.Handle %4, float %10, float %23, float undef, float undef, i32 0, i32 0, i32 undef, float undef)
  %31 = extractvalue %dx.types.ResRet.f32 %30, 0
  %32 = fmul fast float %31, 0x3FD0000000000000
  %40 = call %dx.types.ResRet.f32 @dx.op.rawBufferLoad.f32(i32 139, %dx.types.Handle %5, i32 2, i32 0, i8 15, i32 4)
  %41 = extractvalue %dx.types.ResRet.f32 %40, 2
  %42 = call %dx.types.ResRet.f32 @dx.op.rawBufferLoad.f32(i32 139, %dx.types.Handle %5, i32 3, i32 0, i8 15, i32 4)
  %43 = extractvalue %dx.types.ResRet.f32 %42, 2
  %44 = call %dx.types.ResRet.f32 @dx.op.rawBufferLoad.f32(i32 139, %dx.types.Handle %5, i32 4, i32 0, i8 15, i32 4)
  %45 = extractvalue %dx.types.ResRet.f32 %44, 2
  %46 = call float @dx.op.dot3.f32(i32 55, float %12, float %13, float %14, float %41, float %43, float %45)
  %47 = call float @dx.op.unary.f32(i32 6, float %46)
  %48 = fsub fast float 1.000000e+00, %47
  %49 = fmul fast float %32, %48
  %50 = call float @dx.op.unary.f32(i32 7, float %49)
  br label %60
60:
  %61 = phi float [ %50, %0 ], [ 0.000000e+00, %70 ]
  ret void
70:
  br label %60
}
!dx.resources = !{!4}
!dx.entryPoints = !{!38}
!4 = !{!5, null, !27, null}
!5 = !{!20, !25}
!20 = !{i32 0, %"class.StructuredBuffer<vector<float, 4> >"* undef, !"", i32 0, i32 11, i32 1, i32 12, i32 0, !19}
!25 = !{i32 1, %"class.Texture2D<vector<float, 4> >"* undef, !"", i32 0, i32 16, i32 1, i32 2, i32 0, !9}
!27 = !{!31}
!31 = !{i32 0, %"hostlayout.View"* undef, !"", i32 0, i32 0, i32 1, i32 6748, null}
!38 = !{void ()* @MainPS, !"MainPS", !39, !4, null}
!39 = !{!40, null, null}
!40 = !{!46, !48}
!46 = !{i32 1, !"TEXCOORD11_centroid", i8 9, i8 0, !47, i8 2, i32 1, i8 4, i32 1, i8 0, null}
!48 = !{i32 2, !"TEXCOORD", i8 9, i8 0, !47, i8 2, i32 1, i8 4, i32 2, i8 0, null}
!47 = !{i32 0}
`

describe("emitProgram", () => {
  it("emits the fragment-dependent chain and folds the rest", () => {
    const m = parseModule(PS)
    const evaluator = new Evaluator(m, { cbuf: () => undefined, sample: () => 0.5 })
    const p = emitProgram(
      m,
      { evaluator, materialTextures: new Set([16]), bc5: new Set(), isTime: (ref) => ref === "View[167].z" },
      "ballestAlpha",
      ["%61"]
    )
    assert.strictEqual(p.unsupported, 0)
    assert.deepStrictEqual(p.textures, [{ uniform: "uTex0", register: 16 }])
    const code = p.code
    assert.include(code, "float ballestAlpha(vec2 uv, vec3 nrm, vec3 pos, float time) {")
    // the scroll: time * 2 + uv.y, then the read at (uv.x, that)
    assert.include(code, "(time * 2.0)")
    assert.include(code, "texture2D(uTex0, vec2(uv.x, ")
    // the parameter folds to its literal, the hex double too
    assert.include(code, " * 0.25)")
    // the transform rows fold to the identity: the dot is the normal's z, nothing else survives
    assert.include(code, "float t47 = abs(nrm.z);")
    assert.include(code, "(1.0 - t47)")
    assert.include(code, "clamp(")
    // the phi takes the plain (entry-block) path
    assert.include(code, "return t50;")
  })

  it("prints floats GLSL can parse", () => {
    assert.strictEqual(glslFloat(1), "1.0")
    assert.strictEqual(glslFloat(0.25), "0.25")
    assert.strictEqual(glslFloat(1e-7), "1.0e-7")
    assert.strictEqual(glslFloat(Number.NaN), "0.0")
  })
})
