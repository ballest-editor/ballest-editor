/**
 * Reads a 3D file into one flat triangle list in the game's frame (cm, left-handed, Z up): `readModel` turns the
 * file's axes into the game's, `placeModel` scales the result and stands it on the origin. The one place a model's
 * frame turns into the game's. Only the one file is read, so a `.gltf` must have its buffers embedded.
 */
import * as THREE from "three"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js"
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js"
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js"
import { trianglesUnder } from "./meshTriangles"

/** Which of the file's axes points up. Both kinds of file are right-handed. */
export type UpAxis = "y" | "z"

interface Format {
  /** What files of the format mostly mean: Y for the ones made for drawing, Z for the CAD and printing ones. */
  readonly up: UpAxis
  readonly read: (file: File) => Promise<THREE.Object3D>
}

const gltf: Format = {
  up: "y",
  read: async (file) =>
    (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(await file.arrayBuffer(), "")).scene
}

/** The formats by file extension, in the order the dialog lists them. */
const FORMATS: Readonly<Record<string, Format>> = {
  ".glb": gltf,
  ".gltf": gltf,
  ".stl": { up: "z", read: async (file) => new THREE.Mesh(new STLLoader().parse(await file.arrayBuffer())) },
  ".obj": { up: "y", read: async (file) => new OBJLoader().parse(await file.text()) },
  ".ply": { up: "z", read: async (file) => new THREE.Mesh(new PLYLoader().parse(await file.arrayBuffer())) },
  ".3mf": { up: "z", read: async (file) => new ThreeMFLoader().parse(await file.arrayBuffer()) },
  ".fbx": { up: "y", read: async (file) => new FBXLoader().parse(await file.arrayBuffer(), "") }
}

export const MODEL_EXTENSIONS: ReadonlyArray<string> = Object.keys(FORMATS)

const formatOf = (fileName: string): Format | undefined => FORMATS[/\.[^.]*$/.exec(fileName)?.[0].toLowerCase() ?? ""]

/** The up axis to assume for a file until the user says otherwise. */
export const defaultUpAxis = (fileName: string): UpAxis => formatOf(fileName)?.up ?? "y"

/**
 * Every triangle of `file`, unscaled, in the game's axes with `up` as the file's up axis. A right-handed frame
 * becomes the game's left-handed one by a mirror: with Y up, Y and Z swap; with Z up, Y changes sign.
 */
export const readModel = async (file: File, up: UpAxis): Promise<Float32Array> => {
  const format = formatOf(file.name)
  if (format === undefined) throw new Error(`Can't read ${file.name}. Try ${MODEL_EXTENSIONS.join(", ")}.`)
  const triangles = trianglesUnder(await format.read(file))
  for (let i = 0; i < triangles.length; i += 3) {
    const y = triangles[i + 1] ?? 0, z = triangles[i + 2] ?? 0
    triangles[i + 1] = up === "y" ? z : -y
    triangles[i + 2] = up === "y" ? y : z
  }
  return triangles
}

export interface LoadedModel {
  readonly name: string
  /** Triangles in the game's frame, nine numbers each, scaled and placed as `placeModel` says. */
  readonly triangles: Float32Array
  readonly triangleCount: number
}

/** `raw` scaled so its longest side is `size` cm, standing on z = 0 with the middle of its bounds on the Z axis. */
export const placeModel = (name: string, raw: Float32Array, size: number): LoadedModel => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  raw.forEach((value, i) => {
    min[i % 3] = Math.min(min[i % 3] ?? 0, value)
    max[i % 3] = Math.max(max[i % 3] ?? 0, value)
  })
  const [x0 = 0, y0 = 0, z0 = 0] = min
  const [x1 = 0, y1 = 0, z1 = 0] = max
  // A model with no extent at all (one point, or nothing) keeps a finite scale.
  const scale = size / Math.max(x1 - x0, y1 - y0, z1 - z0, 1e-9)
  const shift = [-(x0 + x1) / 2, -(y0 + y1) / 2, -z0]
  return {
    name,
    triangles: raw.map((value, i) => (value + (shift[i % 3] ?? 0)) * scale),
    triangleCount: raw.length / 9
  }
}
