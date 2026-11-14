// The models the bench and the golden check run on: free test models fetched once into a cache folder and never
// checked in, and any model someone put in a folder inside it. Each is read as the app reads it.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  defaultUpAxis,
  type LoadedModel,
  placeModel,
  readModel
} from "../../../apps/web/src/editor/approximate/loadModel.ts"

export interface SampleModel {
  /** What the tables and the cases call it. */
  readonly name: string
  /** Its file, from the models folder. */
  readonly file: string
  /** Where it is fetched from. A model someone put in the folder has none. */
  readonly url?: string
}

const fetched = (name: string, repository: string, file: string): SampleModel => ({
  name,
  file: path.basename(file),
  url: `https://raw.githubusercontent.com/${repository}/${file}`
})

const TEST_MODELS = "alecjacobson/common-3d-test-models/master/data"
const GLTF_SAMPLES = "KhronosGroup/glTF-Sample-Assets/main/Models"
const THREE_STL = "mrdoob/three.js/dev/examples/models/stl"

export const SAMPLE_MODELS: ReadonlyArray<SampleModel> = [
  fetched("bunny", TEST_MODELS, "stanford-bunny.obj"),
  fetched("teapot", TEST_MODELS, "teapot.obj"),
  fetched("duck", GLTF_SAMPLES, "Duck/glTF-Binary/Duck.glb"),
  fetched("fox", GLTF_SAMPLES, "Fox/glTF-Binary/Fox.glb"),
  fetched("slotted disk", THREE_STL, "ascii/slotted_disk.stl"),
  fetched("pr2_head_pan", THREE_STL, "binary/pr2_head_pan.stl")
]

export const DEFAULT_MODEL_FOLDER = path.join(os.homedir(), ".cache", "ballest-editor", "approximate-models")

/**
 * The models in the folders inside `folder`, each named by its file name: ones that can't be fetched, such as models
 * read out of a game.
 */
const localModels = (folder: string): ReadonlyArray<SampleModel> => {
  if (!fs.existsSync(folder)) return []
  return fs.readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      fs.readdirSync(path.join(folder, entry.name))
        .filter((file) => /\.(obj|stl|glb)$/i.test(file))
        .map((file) => ({ name: path.parse(file).name, file: path.join(entry.name, file) }))
    )
}

/** The fetched samples, then the ones someone put in `folder`. */
export const sampleModels = (folder: string): ReadonlyArray<SampleModel> => [...SAMPLE_MODELS, ...localModels(folder)]

/** Fetches the ones of `models` that `folder` doesn't have yet. */
export const ensureModels = async (folder: string, models: ReadonlyArray<SampleModel>): Promise<void> => {
  fs.mkdirSync(folder, { recursive: true })
  const missing = models.filter((model) => !fs.existsSync(path.join(folder, model.file)))
  await Promise.all(missing.map(async ({ file, url }) => {
    if (url === undefined) throw new Error(`${file} is missing from ${folder}`)
    console.error(`Fetching ${url}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`)
    fs.writeFileSync(path.join(folder, file), new Uint8Array(await response.arrayBuffer()))
  }))
}

const JSON_CHUNK = 0x4E4F534A

/**
 * A GLB without its images, and its materials emptied of the textures that were made of them. Node can't decode
 * images, and only the geometry is read. A GLB is a 12-byte header whose third word is the file's length, then
 * chunks of a length, a type and that many bytes, the JSON chunk first.
 */
const withoutImages = (glb: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
  const words = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  const afterJson = 20 + words.getUint32(12, true)
  const parsed: unknown = JSON.parse(new TextDecoder().decode(glb.subarray(20, afterJson)))
  if (typeof parsed !== "object" || parsed === null) throw new Error("A GLB without its JSON chunk")
  const { images: _images, samplers: _samplers, textures: _textures, ...json }: Record<string, unknown> = { ...parsed }
  if (Array.isArray(json["materials"])) json["materials"] = json["materials"].map(() => ({}))
  const text = new TextEncoder().encode(JSON.stringify(json))
  // A chunk is a whole number of words long: JSON is padded with spaces.
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20)
  padded.set(text)
  const out = new Uint8Array(20 + padded.length + glb.length - afterJson)
  out.set(glb.subarray(0, 12))
  out.set(padded, 20)
  out.set(glb.subarray(afterJson), 20 + padded.length)
  const outWords = new DataView(out.buffer)
  outWords.setUint32(8, out.length, true)
  outWords.setUint32(12, padded.length, true)
  outWords.setUint32(16, JSON_CHUNK, true)
  return out
}

/** `model` read as the app reads it, with the up axis its format mostly means and its longest side `size` cm. */
export const loadSample = async (folder: string, model: SampleModel, size: number): Promise<LoadedModel> => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(folder, model.file)))
  const file = new File([/\.glb$/i.test(model.file) ? withoutImages(bytes) : bytes], model.file)
  return placeModel(model.file, await readModel(file, defaultUpAxis(model.file)), size)
}
