// A piece's triangles from its .glb, in the piece's own frame (UE cm, Z up: the extractor writes them unconverted), as
// the cap survey reads them. Reads the asset pack's meshopt-compressed files (EXT_meshopt_compression) and plain ones.
import { Schema } from "effect"
import { MeshoptDecoder } from "meshoptimizer"
import { readFile } from "node:fs/promises"
import { nth } from "./nth.ts"

export type Vec = readonly [number, number, number]

/** A mesh as a list of corners and the triangles between them, three indices each. */
export interface Triangles {
  readonly positions: Float64Array
  readonly indices: Uint32Array
}

const Index = Schema.Int
const optional = <S extends Schema.Top>(schema: S) => Schema.optionalKey(schema)

const BufferView = Schema.Struct({
  buffer: Index,
  byteOffset: optional(Index),
  byteLength: Index,
  byteStride: optional(Index),
  extensions: optional(Schema.Struct({
    EXT_meshopt_compression: optional(Schema.Struct({
      buffer: Index,
      byteOffset: optional(Index),
      byteLength: Index,
      byteStride: Index,
      count: Index,
      mode: Schema.Literals(["ATTRIBUTES", "TRIANGLES", "INDICES"]),
      filter: optional(Schema.Literals(["NONE", "OCTAHEDRAL", "QUATERNION", "EXPONENTIAL"]))
    }))
  }))
})
type BufferView = typeof BufferView.Type

const Number3 = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])

/** What of a glTF's JSON the survey reads: the default scene's node tree, its meshes' positions and indices. */
const Gltf = Schema.Struct({
  nodes: Schema.Array(Schema.Struct({
    mesh: optional(Index),
    children: optional(Schema.Array(Index)),
    matrix: optional(Schema.Array(Schema.Finite)),
    translation: optional(Number3),
    rotation: optional(Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite])),
    scale: optional(Number3)
  })),
  scenes: Schema.Array(Schema.Struct({ nodes: Schema.Array(Index) })),
  scene: optional(Index),
  meshes: Schema.Array(Schema.Struct({
    primitives: Schema.Array(Schema.Struct({
      attributes: Schema.Struct({ POSITION: Index }),
      indices: optional(Index),
      mode: optional(Index)
    }))
  })),
  accessors: Schema.Array(Schema.Struct({
    bufferView: Index,
    byteOffset: optional(Index),
    componentType: Index,
    count: Index
  })),
  bufferViews: Schema.Array(BufferView)
})
type Gltf = typeof Gltf.Type
type GltfNode = Gltf["nodes"][number]

type Matrix = ReadonlyArray<number>

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Column-major, as glTF writes it. */
const multiply = (a: Matrix, b: Matrix): Matrix =>
  Array.from({ length: 16 }, (_, i) => {
    const column = Math.floor(i / 4)
    const row = i % 4
    return [0, 1, 2, 3].reduce((sum, k) => sum + nth(a, k * 4 + row) * nth(b, column * 4 + k), 0)
  })

const localMatrix = (node: GltfNode): Matrix => {
  if (node.matrix !== undefined) return node.matrix
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1
  ]
}

const chunks = (file: Uint8Array): { readonly json: Gltf; readonly bin: Uint8Array } => {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a .glb")
  const jsonLength = view.getUint32(12, true)
  const json = Schema.decodeSync(Schema.fromJsonString(Gltf))(
    new TextDecoder().decode(file.subarray(20, 20 + jsonLength))
  )
  const binStart = 20 + jsonLength + 8
  return { json, bin: file.subarray(binStart, binStart + view.getUint32(20 + jsonLength, true)) }
}

/** The bytes of a buffer view, decompressed. A .glb's buffers are its one BIN chunk; a fallback buffer has none. */
const viewBytes = (view: BufferView, bin: Uint8Array): Uint8Array => {
  const compressed = view.extensions?.EXT_meshopt_compression
  if (compressed === undefined) {
    const start = view.byteOffset ?? 0
    return bin.subarray(start, start + view.byteLength)
  }
  const out = new Uint8Array(compressed.count * compressed.byteStride)
  const start = compressed.byteOffset ?? 0
  MeshoptDecoder.decodeGltfBuffer(
    out,
    compressed.count,
    compressed.byteStride,
    bin.subarray(start, start + compressed.byteLength),
    compressed.mode,
    compressed.filter ?? "NONE"
  )
  return out
}

/** The component types positions and indices come in: unsigned byte, short and int, and float. */
const components = new Map<
  number,
  { readonly size: number; readonly read: (view: DataView, offset: number) => number }
>([
  [5121, { size: 1, read: (view, offset) => view.getUint8(offset) }],
  [5123, { size: 2, read: (view, offset) => view.getUint16(offset, true) }],
  [5125, { size: 4, read: (view, offset) => view.getUint32(offset, true) }],
  [5126, { size: 4, read: (view, offset) => view.getFloat32(offset, true) }]
])

const readAccessor = (gltf: Gltf, bin: Uint8Array, index: number, width: number): Array<number> => {
  const accessor = nth(gltf.accessors, index)
  const view = nth(gltf.bufferViews, accessor.bufferView)
  const bytes = viewBytes(view, bin)
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const component = components.get(accessor.componentType)
  if (component === undefined) throw new Error(`component type ${accessor.componentType}`)
  const { read, size } = component
  const stride = view.byteStride ?? view.extensions?.EXT_meshopt_compression?.byteStride ?? size * width
  const out: Array<number> = []
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < width; c++) out.push(read(data, (accessor.byteOffset ?? 0) + i * stride + c * size))
  }
  return out
}

/** Every triangle of the .glb's default scene, each node's transform applied. */
export const loadTriangles = async (path: string): Promise<Triangles> => {
  await MeshoptDecoder.ready
  const { bin, json } = chunks(new Uint8Array(await readFile(path)))
  const positions: Array<number> = []
  const indices: Array<number> = []
  const visit = (index: number, parent: Matrix) => {
    const node = nth(json.nodes, index)
    const world = multiply(parent, localMatrix(node))
    for (const primitive of node.mesh === undefined ? [] : nth(json.meshes, node.mesh).primitives) {
      if ((primitive.mode ?? 4) !== 4) continue
      const base = positions.length / 3
      const corners = readAccessor(json, bin, primitive.attributes.POSITION, 3)
      for (let i = 0; i < corners.length; i += 3) {
        const [x, y, z] = [nth(corners, i), nth(corners, i + 1), nth(corners, i + 2)]
        for (let row = 0; row < 3; row++) {
          positions.push(nth(world, row) * x + nth(world, 4 + row) * y + nth(world, 8 + row) * z + nth(world, 12 + row))
        }
      }
      const own = primitive.indices === undefined
        ? Array.from({ length: corners.length / 3 }, (_, i) => i)
        : readAccessor(json, bin, primitive.indices, 1)
      for (const i of own) indices.push(base + i)
    }
    for (const child of node.children ?? []) visit(child, world)
  }
  for (const root of nth(json.scenes, json.scene ?? 0).nodes) visit(root, IDENTITY)
  return { positions: Float64Array.from(positions), indices: Uint32Array.from(indices) }
}
