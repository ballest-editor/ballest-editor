// The asset pack: web-assets/ (compress.mjs's output) as a gzipped tarball attached to a GitHub release tagged
// `assets-<tree hash>`. publish.mjs creates it and writes web-assets.json; download.mjs fetches it back.
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

export const REPO = "ballest-editor/ballest-editor"
export const ASSET = "web-assets.tar.gz"

export const downloadUrl = (tag) => `https://github.com/${REPO}/releases/download/${tag}/${ASSET}`

/** Files under `dir`, relative, forward slashes, sorted: the tarball's entries and the tree hash's order. */
export const treeFiles = (dir) =>
  readdirSync(dir, { recursive: true })
    .map((f) => f.replaceAll("\\", "/"))
    .filter((f) => statSync(join(dir, f)).isFile())
    .sort()

/** A hash of every path and its bytes, so the same tree always gets the same tag. */
export const treeHash = (dir, files = treeFiles(dir)) => {
  const hash = createHash("sha256")
  for (const f of files) {
    hash.update(f).update("\0").update(readFileSync(join(dir, f))).update("\0")
  }
  return hash.digest("hex").slice(0, 16)
}

export const tagOf = (hash) => `assets-${hash}`

/** web-assets.json: `{ tag, sha256, size }` of the published tarball, or undefined when absent or malformed. */
export const readPointer = (file) => {
  if (!existsSync(file)) return undefined
  const { tag, sha256, size } = JSON.parse(readFileSync(file, "utf8"))
  return typeof tag === "string" && typeof sha256 === "string" && typeof size === "number"
    ? { tag, sha256, size }
    : undefined
}
