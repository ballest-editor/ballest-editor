import { assert, describe, it } from "@effect/vitest"
import { defaultUpAxis, MODEL_EXTENSIONS, placeModel, readModel } from "./loadModel"

/** One triangle, no two of its nine numbers alike, so a swapped or mirrored axis shows. */
const CORNERS = [[1, 2, 3], [4, 5, 6], [7, 8, 10]] as const

const fileOf = (name: string, lines: ReadonlyArray<string>) => new File([lines.join("\n")], name)

const obj = fileOf("tri.obj", [...CORNERS.map((corner) => `v ${corner.join(" ")}`), "f 1 2 3", ""])

const stl = fileOf("TRI.STL", [
  "solid tri",
  "facet normal 0 0 1",
  "outer loop",
  ...CORNERS.map((corner) => `vertex ${corner.join(" ")}`),
  "endloop",
  "endfacet",
  "endsolid tri",
  ""
])

/** A GLB of the triangle by index, last corner first, under a node that moves and stretches it. */
const glb = () => {
  const bin = new DataView(new ArrayBuffer(44))
  CORNERS.flat().forEach((value, i) => bin.setFloat32(i * 4, value, true))
  ;[2, 0, 1].forEach((corner, i) => bin.setUint16(36 + i * 2, corner, true))
  const text = JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [100, 0, 0], scale: [1, 2, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [1, 2, 3], max: [7, 8, 10] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" }
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }],
    buffers: [{ byteLength: 44 }]
  })
  const json = new TextEncoder().encode(text.padEnd(Math.ceil(text.length / 4) * 4))
  const chunk = (type: number, length: number) => new Uint32Array([length, type])
  const header = new Uint32Array([0x46546C67, 2, 12 + 8 + json.length + 8 + 44])
  return new File([header, chunk(0x4E4F534A, json.length), json, chunk(0x004E4942, 44), bin], "tri.glb")
}

describe("readModel", () => {
  it("swaps Y and Z of a file whose Y is up, and negates Y of one whose Z is up", async () => {
    assert.deepStrictEqual([...await readModel(obj, "y")], [1, 3, 2, 4, 6, 5, 7, 10, 8])
    assert.deepStrictEqual([...await readModel(obj, "z")], [1, -2, 3, 4, -5, 6, 7, -8, 10])
    assert.deepStrictEqual([...await readModel(stl, "z")], [1, -2, 3, 4, -5, 6, 7, -8, 10])
  })

  it("reads a mesh's triangles by its index, where its node puts them", async () => {
    assert.deepStrictEqual([...await readModel(glb(), "y")], [107, 10, 16, 101, 3, 4, 104, 6, 10])
  })

  it("says which files it reads when given another", async () => {
    const failure = await readModel(new File(["x"], "model.blend"), "y").then(() => undefined, (e: unknown) => e)
    assert.instanceOf(failure, Error)
    assert.include(failure.message, ".glb, .gltf, .stl, .obj, .ply, .3mf, .fbx")
  })
})

describe("defaultUpAxis", () => {
  it("is Z for the CAD and printing formats and Y for the rest, whatever the case", () => {
    assert.deepStrictEqual(
      MODEL_EXTENSIONS.map((extension) => [extension, defaultUpAxis(`a.b${extension.toUpperCase()}`)]),
      [[".glb", "y"], [".gltf", "y"], [".stl", "z"], [".obj", "y"], [".ply", "z"], [".3mf", "z"], [".fbx", "y"]]
    )
    assert.strictEqual(defaultUpAxis("no extension"), "y")
  })
})

describe("placeModel", () => {
  it("scales the longest side to the size, stands the model on z = 0 and centres it on the Z axis", () => {
    // 2 by 4 by 8 from (10, 20, 30): two triangles that reach every side of that box.
    const raw = new Float32Array([10, 20, 30, 12, 24, 38, 10, 24, 30, 12, 20, 38, 11, 22, 34, 10, 20, 38])
    const placed = placeModel("box.stl", raw, 400)
    assert.strictEqual(placed.name, "box.stl")
    assert.strictEqual(placed.triangleCount, 2)
    assert.deepStrictEqual(
      [...placed.triangles],
      [-50, -100, 0, 50, 100, 400, -50, 100, 0, 50, -100, 400, 0, 0, 200, -50, -100, 400]
    )
    // the caller's triangles are left as they were
    assert.strictEqual(raw[0], 10)
  })

  it("leaves a model with no triangles empty", () => {
    assert.lengthOf(placeModel("empty.obj", new Float32Array(0), 400).triangles, 0)
  })
})
