#!/usr/bin/env node
// usage: node tools/compress/download.mjs [WEB_ASSETS_DIR] [POINTER_FILE] [ASSETS_DIR]
//        (defaults: ./web-assets ./tools/compress/web-assets.json ./assets)
//
// Fetches the asset pack web-assets.json points at (publish.mjs made it) into web-assets/, for machines without
// the game: CI, Vercel, a fresh clone. Runs after compress.mjs in `pnpm assets`, and does nothing when the raw
// meshes are on disk (compress.mjs wrote web-assets/ from them) or web-assets/ already matches the pack's tag.
// The tarball is checked against the recorded size and SHA-256, and the extracted tree against the tag's hash.
import { createHash } from "node:crypto"
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { extract } from "tar"
import { downloadUrl, readPointer, tagOf, treeHash } from "./pack.mjs"

const [dir = "web-assets", pointer = "tools/compress/web-assets.json", assets = "assets"] = process.argv
  .slice(2)
  .map((p) => resolve(p))
const log = (msg) => console.error(`[download] ${msg}`)
const fail = (msg) => {
  console.error(`[download] ${msg}`)
  process.exit(1)
}

const pack = readPointer(pointer)
const local = existsSync(join(dir, "pieces")) ? tagOf(treeHash(dir)) : undefined

if (existsSync(join(assets, "pieces"))) {
  if (local !== undefined && local !== pack?.tag) {
    log(`${dir} (${local}) is not the published pack (${pack?.tag ?? "none"}): run \`pnpm assets:publish\``)
  }
  process.exit(0)
}
if (pack === undefined) fail(`no valid ${pointer}: run \`pnpm assets:publish\` where the game is extracted`)
if (local === pack.tag) {
  log(`${dir} is ${pack.tag}`)
  process.exit(0)
}

const url = downloadUrl(pack.tag)
const tmp = mkdtempSync(join(tmpdir(), "ballest-pack-"))
try {
  const file = join(tmp, "pack.tar.gz")
  log(`${url} (${(pack.size / 1e6).toFixed(1)} MB)`)
  const response = await fetch(url)
  if (!response.ok || response.body === null) throw new Error(`${url}: HTTP ${response.status}`)
  const hash = createHash("sha256")
  let size = 0
  await pipeline(
    Readable.fromWeb(response.body),
    new Transform({
      transform(chunk, _encoding, done) {
        hash.update(chunk)
        size += chunk.length
        done(null, chunk)
      }
    }),
    createWriteStream(file)
  )
  const sha256 = hash.digest("hex")
  if (size !== pack.size || sha256 !== pack.sha256) {
    throw new Error(`${url}: got ${size} bytes, sha256 ${sha256}; ${pointer} says ${pack.size}, ${pack.sha256}`)
  }

  const staged = join(tmp, "web-assets")
  mkdirSync(staged)
  await extract({ file, cwd: staged, strict: true })
  const got = tagOf(treeHash(staged))
  if (got !== pack.tag) throw new Error(`${url} unpacks to ${got}, not ${pack.tag}`)
  rmSync(dir, { recursive: true, force: true })
  try {
    renameSync(staged, dir)
  } catch {
    // tmpdir() can be on another file system; extract in place instead.
    mkdirSync(dir, { recursive: true })
    await extract({ file, cwd: dir, strict: true })
  }
  log(`wrote ${dir} (${pack.tag})`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
