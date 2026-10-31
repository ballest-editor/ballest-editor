#!/usr/bin/env node
// usage: node tools/compress/publish.mjs [WEB_ASSETS_DIR] [POINTER_FILE]   (defaults: ./web-assets ./web-assets.json)
//
// Publishes web-assets/ (tools/compress's output) as the asset pack: a tarball (sorted entries, mtime 0, portable
// modes) attached to a prerelease tagged `assets-<tree hash>` on GitHub, never marked latest. Writes the tag and the
// tarball's SHA-256 and size to web-assets.json, which download.mjs fetches and verifies on machines without the
// game (CI, Vercel, a fresh clone). Idempotent: when the release already has the tarball, its published digest is
// recorded and nothing is uploaded.
//
// Needs the GitHub CLI (`gh`), logged in with permission to create releases on the repo.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { create } from "tar"
import { ASSET, REPO, tagOf, treeFiles, treeHash } from "./pack.mjs"

const [dir = "web-assets", pointer = "web-assets.json"] = process.argv.slice(2).map((p) => resolve(p))
const log = (msg) => console.error(`[publish] ${msg}`)
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })

if (!existsSync(join(dir, "pieces")) || !existsSync(join(dir, "textures"))) {
  console.error(`${dir} has no pieces/ and textures/: run \`pnpm assets\` first`)
  process.exit(2)
}

const files = treeFiles(dir)
const hash = treeHash(dir, files)
const tag = tagOf(hash)
log(`${files.length} files, tag ${tag}`)

/** The release's tarball as `{ sha256, size }`, undefined when the release or the asset doesn't exist. */
const published = () => {
  let release
  try {
    release = JSON.parse(gh(["api", `repos/${REPO}/releases/tags/${tag}`]))
  } catch (error) {
    if (String(error.stderr).includes("HTTP 404")) return undefined
    throw error
  }
  const asset = release.assets.find((a) => a.name === ASSET)
  if (asset === undefined) return { release: true }
  if (typeof asset.digest !== "string" || !asset.digest.startsWith("sha256:")) {
    throw new Error(`${tag}/${ASSET} has no sha256 digest on GitHub`)
  }
  return { release: true, sha256: asset.digest.slice("sha256:".length), size: asset.size }
}

let pack = published()
if (pack?.sha256 === undefined) {
  const tmp = mkdtempSync(join(tmpdir(), "ballest-pack-"))
  try {
    const file = join(tmp, ASSET)
    await create({ file, cwd: dir, gzip: { level: 9 }, portable: true, mtime: new Date(0) }, files)
    const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex")
    const size = statSync(file).size
    log(`${ASSET}: ${(size / 1e6).toFixed(1)} MB, sha256 ${sha256}`)
    if (pack?.release === true) {
      gh(["release", "upload", tag, file, "--repo", REPO, "--clobber"])
    } else {
      gh([
        "release",
        "create",
        tag,
        file,
        "--repo",
        REPO,
        "--prerelease",
        "--latest=false",
        "--title",
        `Asset pack ${hash}`,
        "--notes",
        "Meshes and textures extracted from Ballest of Them All and compressed by tools/compress, for builds "
        + "without the game. Not an editor release. See NOTICE.md."
      ])
    }
    pack = { sha256, size }
    log(`published ${tag}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
} else {
  log(`${tag} already has ${ASSET}`)
}

writeFileSync(pointer, JSON.stringify({ tag, sha256: pack.sha256, size: pack.size }, null, 2) + "\n")
log(`wrote ${pointer}`)
