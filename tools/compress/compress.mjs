#!/usr/bin/env node
// usage: node tools/compress/compress.mjs [ASSETS_DIR] [OUT_DIR]   (defaults: ./assets ./web-assets)
//
// Compresses the extractor's big binaries into the tree the editor serves under /assets/*:
//   pieces/**.glb    -> meshopt-compressed glb, lossless (gltfpack -cc without quantization; same names)
//   textures/**.png  -> AVIF, 4:4:4, quality 80 (avifenc; .png -> .avif, the editor asks for .avif)
// Everything else under assets/ (catalog, materials, keybinds, thumbs, ...) is small and committed, and is
// served from assets/ directly. OUT_DIR is owned by this script and rebuilt from scratch on every run. It is
// gitignored: `pnpm assets:publish` publishes it as a GitHub release asset pack (see README.md), which
// download.mjs fetches on machines without the raw files.
import { pack } from "gltfpack"
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import { dirname, join, resolve } from "node:path"

const [assets = "assets", out = "web-assets"] = process.argv.slice(2).map((p) => resolve(p))
const log = (msg) => console.error(`[compress] ${msg}`)
/** Paths relative to `dir`, forward slashes, sorted. */
const files = (dir, ext) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true })
      .map((f) => f.replaceAll("\\", "/"))
      .filter((f) => f.endsWith(ext))
      .sort()
    : []

// Lossless: -noq keeps float attributes as they are; -kn/-km/-ke/-kv keep the node, material, extras and
// vertex-attribute structure the editor relies on. Checked to decode to identical triangles for every piece.
const GLTFPACK_ARGS = ["-cc", "-noq", "-kn", "-km", "-ke", "-kv"]
// Chosen against the PNGs: ~5x smaller, worst texture (T_concrete_normal) 38.5 dB PSNR. 4:4:4 because
// normal maps and packed masks store data in the colour channels, which chroma subsampling would smear.
// tune=ssim pins what was measured: aom >= 3.13 defaults to tune=iq, a perceptual mode that cost the concrete
// normal map 9 dB at the same -q.
const AVIFENC_ARGS = ["--speed", "6", "-q", "80", "-y", "444", "-a", "tune=ssim"]

/** avifenc from PATH, else built from the flake's pinned nixpkgs. */
const findAvifenc = () => {
  try {
    execFileSync("avifenc", ["--version"], { stdio: "ignore" })
    return "avifenc"
  } catch {
    try {
      const store = execFileSync("nix", ["build", "--no-link", "--print-out-paths", ".#libavif"], {
        cwd: resolve(import.meta.dirname, "../.."),
        encoding: "utf8"
      })
      return join(store.trim().split("\n").at(-1), "bin", "avifenc")
    } catch {
      throw new Error("avifenc not found: run inside `nix develop`, or install libavif")
    }
  }
}

const run = (cmd, args) =>
  new Promise((ok, fail) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    child.stderr.on("data", (d) => (stderr += d))
    child.on("error", fail)
    child.on("close", (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(" ")}\n${stderr}`))))
  })

const pool = async (items, size, task) => {
  let next = 0
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) await task(items[next++])
  }))
}

if (!existsSync(join(assets, "catalog.json"))) {
  console.error(`no catalog.json in ${assets}: run tools/extract first`)
  process.exit(2)
}
const raw = ["pieces", "textures"].filter((dir) => existsSync(join(assets, dir)))
if (raw.length === 0) {
  log(
    `no ${assets}/pieces or textures (not extracted here): ${"download.mjs fetches the published pack"}`
  )
  process.exit(0)
}
if (raw.length === 1) {
  console.error(`only ${raw[0]}/ in ${assets}: rerun tools/extract so both pieces/ and textures/ are present`)
  process.exit(2)
}
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const glbs = files(join(assets, "pieces"), ".glb")
for (const glb of glbs) {
  const dst = join(out, "pieces", glb)
  mkdirSync(dirname(dst), { recursive: true })
  // gltfpack's wasm instance isn't reentrant, so one file at a time.
  await pack(["-i", join(assets, "pieces", glb), "-o", dst, ...GLTFPACK_ARGS], {
    read: (p) => readFileSync(p),
    write: (p, data) => writeFileSync(p, data)
  })
}
log(`${glbs.length} meshes`)

const pngs = files(join(assets, "textures"), ".png")
if (pngs.length > 0) {
  const avifenc = findAvifenc()
  await pool(pngs, availableParallelism(), async (png) => {
    const dst = join(out, "textures", png.replace(/\.png$/, ".avif"))
    mkdirSync(dirname(dst), { recursive: true })
    await run(avifenc, [...AVIFENC_ARGS, join(assets, "textures", png), dst])
  })
}
log(`${pngs.length} textures`)
log(`wrote ${out}; run \`pnpm assets:publish\` to publish it`)
