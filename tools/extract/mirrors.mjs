// Pairs the game's baked mirror meshes with the meshes they mirror.
//
// 0.4.1's level editor mirrors an item (Mirror X / Mirror Y) by swapping its mesh for a baked copy under
// /Game/LevelEditor/Mirror/Meshes/SM_Mirror_<hash>. DA_ItemMirrorCatalog, which maps them, is a native class
// (unreadable without the game's usmap), so the pairs come from the geometry: a baked mesh is its source with
// one local axis negated: the same triangle count, mirrored bounds, and the same distinct vertex positions. The
// bake welds vertices a little differently (SM_Paddle has 8839 vertices, its mirror 8838), so the positions are
// compared as sets, allowing a handful that only one of them has.
import { readFileSync } from "node:fs"
import { join } from "node:path"

export const MIRROR_DIR = "/Game/LevelEditor/Mirror/Meshes/"

/** POSITION accessors of a glb (BallestExtract's writer: float32 VEC3, one buffer). */
const positionsOf = (file) => {
  const buf = readFileSync(file)
  const jsonLength = buf.readUInt32LE(12)
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8"))
  const bin = 20 + jsonLength + 8
  const out = []
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const accessor = gltf.accessors[primitive.attributes.POSITION]
      const view = gltf.bufferViews[accessor.bufferView]
      const offset = bin + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
      for (let i = 0; i < accessor.count * 3; i++) out.push(buf.readFloatLE(offset + i * 4))
    }
  }
  return out
}

/** The distinct vertex positions, one local axis negated (0.1 mm grid). */
const positionSet = (positions, negate) => {
  const keys = new Set()
  for (let i = 0; i < positions.length; i += 3) {
    const p = [positions[i], positions[i + 1], positions[i + 2]]
    if (negate !== null) p[negate] = -p[negate]
    keys.add(p.map((v) => Math.round(v * 100)).join(","))
  }
  return keys
}

/** At most 0.5% of the distinct positions (and at least 2) in only one of the two sets. */
const samePositions = (a, b) => {
  let shared = 0
  for (const k of a) if (b.has(k)) shared++
  const different = a.size + b.size - 2 * shared
  return different <= Math.max(2, 0.005 * Math.max(a.size, b.size))
}

const close = (a, b) => Math.abs(a - b) < 0.05
const mirroredBounds = (a, b, axis) =>
  [0, 1, 2].every((k) =>
    k === axis
      ? close(a.min[k], -b.max[k]) && close(a.max[k], -b.min[k])
      : close(a.min[k], b.min[k]) && close(a.max[k], b.max[k])
  )

/**
 * meshes: the exporter's report entries ({ meshAssetPath, glb, vertices, triangles, bounds }), glbs under piecesDir.
 * Returns { pairs: [{ meshAssetPath, mirrorMeshAssetPath, axes: "x" | "y" | "xy" }], unpaired: [mirrorMeshAssetPath] }:
 * axes is the local axis the bake negates ("xy" for a source symmetric enough that either does).
 */
export const pairMirrors = (meshes, piecesDir) => {
  const baked = meshes.filter((m) => m.glb && m.meshAssetPath.startsWith(MIRROR_DIR))
  const sources = meshes.filter((m) => m.glb && !m.meshAssetPath.startsWith(MIRROR_DIR))
  const byTriangles = new Map()
  for (const m of sources) byTriangles.set(m.triangles, [...(byTriangles.get(m.triangles) ?? []), m])
  const positions = new Map()
  const positionsFor = (m) => {
    if (!positions.has(m.glb)) positions.set(m.glb, positionsOf(join(piecesDir, m.glb)))
    return positions.get(m.glb)
  }
  const slotNames = (m) => (m.materialSlots ?? []).map((slot) => slot.slotName).join(",")
  // Several sources can share a shape (SM_500_kicker and AJ_500_kicker1, each with its own bake): the ones whose
  // vertex count and slot names also match the bake are its source.
  const score = (source, mirror) =>
    (source.vertices === mirror.vertices ? 2 : 0) + (slotNames(source) === slotNames(mirror) ? 1 : 0)
  const pairs = []
  const unpaired = []
  for (const mirror of baked) {
    const own = positionSet(positionsFor(mirror), null)
    const matches = (byTriangles.get(mirror.triangles) ?? []).flatMap((source) => {
      const axes = [0, 1].filter((axis) =>
        mirroredBounds(mirror.bounds, source.bounds, axis) &&
        samePositions(positionSet(positionsFor(source), axis), own)
      )
      // a symmetric source matches with either axis negated
      return axes.length === 0 ? [] : [{ source, axes: axes.map((axis) => "xy"[axis]).join("") }]
    })
    const best = Math.max(...matches.map(({ source }) => score(source, mirror)))
    const kept = matches.filter(({ source }) => score(source, mirror) === best)
    // Identical sources (the same box cooked twice) all share the one bake.
    if (kept.length === 0) unpaired.push(mirror.meshAssetPath)
    for (const { axes, source } of kept) {
      pairs.push({ meshAssetPath: source.meshAssetPath, mirrorMeshAssetPath: mirror.meshAssetPath, axes })
    }
  }
  return {
    pairs: pairs.sort((a, b) =>
      a.meshAssetPath.localeCompare(b.meshAssetPath) || a.mirrorMeshAssetPath.localeCompare(b.mirrorMeshAssetPath)
    ),
    unpaired: unpaired.sort()
  }
}
