#!/usr/bin/env node
// Dependency-free sanity check of exported .glb files: parses the GLB container,
// recomputes POSITION bounds from the binary buffer and prints counts.
// usage: node verify.mjs [--materials ASSETS_DIR] FILE.glb...
import { readFileSync, statSync } from "node:fs"

function inspect(file) {
  const buf = readFileSync(file)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB")
  const jsonLen = buf.readUInt32LE(12)
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"))
  const binStart = 20 + jsonLen + 8
  const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen))
  const acc = (i) => {
    const a = gltf.accessors[i]
    const v = gltf.bufferViews[a.bufferView]
    return { a, off: (v.byteOffset ?? 0) + (a.byteOffset ?? 0) }
  }
  const mesh = gltf.meshes[0]
  const { a: pa, off: po } = acc(mesh.primitives[0].attributes.POSITION)
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pa.count; i++) {
    for (let k = 0; k < 3; k++) {
      const x = bin.readFloatLE(po + (i * 3 + k) * 4)
      min[k] = Math.min(min[k], x)
      max[k] = Math.max(max[k], x)
    }
  }
  let tris = 0, maxIndex = 0, volume = 0
  const pos = (i) => [0, 1, 2].map((k) => bin.readFloatLE(po + (i * 3 + k) * 4))
  for (const p of mesh.primitives) {
    const { a, off } = acc(p.indices)
    tris += a.count / 3
    const ix = []
    for (let i = 0; i < a.count; i++) {
      const v = a.componentType === 5123 ? bin.readUInt16LE(off + i * 2) : bin.readUInt32LE(off + i * 4)
      if (v > maxIndex) maxIndex = v
      ix.push(v)
    }
    // Signed volume (right-handed math on the stored positions): > 0 means CCW-outward faces.
    for (let t = 0; t + 2 < ix.length; t += 3) {
      if (Math.max(ix[t], ix[t + 1], ix[t + 2]) >= pa.count) continue
      const [A, B, C] = [pos(ix[t]), pos(ix[t + 1]), pos(ix[t + 2])]
      volume +=
        (A[0] * (B[1] * C[2] - B[2] * C[1]) + A[1] * (B[2] * C[0] - B[0] * C[2]) + A[2] * (B[0] * C[1] - B[1] * C[0])) /
        6
    }
  }
  if (maxIndex >= pa.count) throw new Error(`index ${maxIndex} out of range (${pa.count} vertices)`)
  const size = max.map((m, k) => +(m - min[k]).toFixed(2))
  console.log(
    `${file}\n  asset=${gltf.asset.extras?.ueAssetPath} vertices=${pa.count} triangles=${tris} primitives=${mesh.primitives.length}` +
      ` materials=[${gltf.materials.map((m) => m.name).join(", ")}] primitiveMaterials=[${
        mesh.primitives.map((p) => p.material)
      }]` +
      `\n  signedVolume=${Math.round(volume)} (${
        volume > 0 ? "CCW-outward, glTF front faces" : "CW-outward / open mesh"
      })` +
      `\n  bounds min=[${min.map((x) => +x.toFixed(2))}] max=[${max.map((x) => +x.toFixed(2))}] size(cm)=[${size}]`
  )
}

// --materials ASSETS_DIR: check materials.json against assets/textures.
function verifyMaterials(dir) {
  const m = JSON.parse(readFileSync(`${dir}/materials.json`, "utf8"))
  const exists = (p) => {
    try {
      return statSync(`${dir}/${p}`).isFile()
    } catch {
      return false
    }
  }
  const missing = new Set()
  for (const r of m.materials) {
    for (const t of Object.values(r.textures)) if (t && (t.startsWith("missing:") || !exists(t))) missing.add(t)
    for (const k of ["baseColorTexture", "normalTexture", "ormTexture"]) {
      if (r.approx[k] && !exists(r.approx[k])) missing.add(r.approx[k])
    }
  }
  const png = m.textures.filter((t) => t.png)
  const bytes = png.reduce((n, t) => n + (t.bytes ?? 0), 0)
  console.log(
    `materials: ${m.materials.length} total, ${m.materials.filter((r) => r.recovered).length} recovered, ` +
      `${
        m.materials.filter((r) => r.approx.baseColorTexture || r.approx.normalTexture).length
      } with base/normal textures; ` +
      `textures: ${png.length}/${m.textures.length} decoded, ${(bytes / 1e6).toFixed(1)} MB, ${missing.size} missing` +
      (missing.size ? `\n  missing: ${[...missing].join(", ")}` : "")
  )
  return missing.size === 0 && png.length === m.textures.length
}

let failed = 0
const argv = process.argv.slice(2)
const mi = argv.indexOf("--materials")
if (mi >= 0) {
  if (!verifyMaterials(argv[mi + 1])) failed++
  argv.splice(mi, 2)
}
for (const f of argv) {
  try {
    inspect(f)
  } catch (e) {
    failed++
    console.log(`${f}: FAIL ${e.message}`)
  }
}
process.exit(failed ? 1 : 0)
