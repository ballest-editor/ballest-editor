import { assert, describe, it } from "@effect/vitest"
import { DoubleSide } from "three"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { editLineShader, hiddenLineMaterial, LINE_SHADER_ANCHORS, lineMaterial, screenDashes } from "./screenLines"

/** Three's fat line shader, as a `LineMaterial` has it. */
const lineShader = () => {
  const { vertexShader, fragmentShader } = new LineMaterial()
  return { vertexShader, fragmentShader }
}

const count = (source: string, anchor: string) => source.split(anchor).length - 1

describe("the scene's lines", () => {
  it("finds each place it edits in three's line shader once", () => {
    const { vertexShader, fragmentShader } = lineShader()
    assert.strictEqual(count(vertexShader, LINE_SHADER_ANCHORS.ends), 1)
    assert.strictEqual(count(vertexShader, LINE_SHADER_ANCHORS.place), 1)
    assert.strictEqual(count(fragmentShader, LINE_SHADER_ANCHORS.fragment), 1)
  })

  it("dashes on screen, and lets a later edit place the corner", () => {
    const shader = lineShader()
    editLineShader([screenDashes(), { place: "gl_Position = vec4( 0.0 );" }])(shader)
    assert.include(shader.vertexShader, "vDashRun = length( screenRun );")
    assert.include(shader.vertexShader, "gl_Position = vec4( 0.0 );")
    assert.notInclude(shader.vertexShader, LINE_SHADER_ANCHORS.place)
    assert.include(shader.fragmentShader, "discard;")
    // the dash's code runs after what it reads is set: the ends' screen places and this corner's
    const vertex = shader.vertexShader
    assert.isBelow(vertex.indexOf("vec3 ndcEnd"), vertex.indexOf("vDashRun = "))
  })

  it("draws under a mirror: the game's frame to the scene's turns a line's triangles away", () => {
    assert.strictEqual(lineMaterial({}).side, DoubleSide)
    assert.strictEqual(hiddenLineMaterial("#ffffff").side, DoubleSide)
  })

  it("says so when three's shader has moved on", () => {
    assert.throws(() => editLineShader([])({ vertexShader: "void main() {}", fragmentShader: "void main() {" }))
  })
})
