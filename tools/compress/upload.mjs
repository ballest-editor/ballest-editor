#!/usr/bin/env node
// usage: node tools/compress/upload.mjs [WEB_ASSETS_DIR] [POINTER_FILE]   (defaults: ./web-assets ./web-assets.json)
//
// Publishes web-assets/ (tools/compress's output) to the project's public Vercel Blob store, under a prefix
// that is the hash of the tree's contents, and writes the resulting base URL to web-assets.json. The editor
// build reads that file and points mesh and texture requests at the blob store whenever web-assets/ isn't
// on disk (Vercel, CI, a fresh clone). Content-addressed prefixes make blobs immutable, so they are served
// with a one-year cache and a re-extract never has to fight CDN or browser caches: it just gets a new prefix.
//
// Needs BLOB_READ_WRITE_TOKEN (the `pnpm assets:upload` script loads .env.local, written by `vercel link`).
// Blobs that already exist under the prefix are skipped, so a rerun after an interrupted upload is cheap.
import { list, put } from "@vercel/blob"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [dir = "web-assets", pointer = "web-assets.json"] = process.argv.slice(2).map((p) => resolve(p))
const log = (msg) => console.error(`[upload] ${msg}`)

if (!existsSync(join(dir, "pieces")) || !existsSync(join(dir, "textures"))) {
  console.error(`${dir} has no pieces/ and textures/: run \`pnpm assets\` first`)
  process.exit(2)
}
if (process.env.BLOB_READ_WRITE_TOKEN === undefined) {
  console.error("BLOB_READ_WRITE_TOKEN is not set: run `vercel link` (writes .env.local) or export it")
  process.exit(2)
}

const files = readdirSync(dir, { recursive: true })
  .map((f) => f.replaceAll("\\", "/"))
  .filter((f) => statSync(join(dir, f)).isFile())
  .sort()

// The prefix is a hash of every path and its bytes, so the same tree always maps to the same URLs.
const hash = createHash("sha256")
for (const f of files) {
  hash.update(f).update("\0").update(readFileSync(join(dir, f))).update("\0")
}
const prefix = hash.digest("hex").slice(0, 16)
log(`${files.length} files, tree ${prefix}`)

const existing = new Set()
let cursor
do {
  const page = await list({ prefix: `${prefix}/`, cursor, limit: 1000 })
  for (const blob of page.blobs) existing.add(blob.pathname)
  cursor = page.cursor
} while (cursor !== undefined)

const types = { ".glb": "model/gltf-binary", ".avif": "image/avif" }
let base
let uploaded = 0
let next = 0
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < files.length) {
    const f = files[next++]
    const pathname = `${prefix}/${f}`
    if (existing.has(pathname)) continue
    const ext = f.slice(f.lastIndexOf("."))
    const blob = await put(pathname, readFileSync(join(dir, f)), {
      access: "public",
      addRandomSuffix: false,
      contentType: types[ext] ?? "application/octet-stream",
      cacheControlMaxAge: 31536000
    })
    base ??= blob.url.slice(0, blob.url.length - f.length - 1)
    uploaded++
  }
}))
log(`uploaded ${uploaded}, ${files.length - uploaded} already there`)

if (base === undefined) {
  // Nothing uploaded: derive the base from any existing blob under the prefix.
  const page = await list({ prefix: `${prefix}/`, limit: 1 })
  const blob = page.blobs[0]
  base = blob.url.slice(0, blob.url.length - blob.pathname.length) + prefix
}
writeFileSync(pointer, JSON.stringify({ base }, null, 2) + "\n")
log(`wrote ${pointer}: ${base}`)
