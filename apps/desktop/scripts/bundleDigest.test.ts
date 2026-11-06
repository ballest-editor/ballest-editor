import { assert, describe, it } from "@effect/vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { bundleDigest } from "./bundleDigest"

const inTempDir = (body: (dir: string) => void) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-digest-"))
  try {
    body(dir)
  } finally {
    fs.rmSync(dir, { recursive: true })
  }
}

describe("bundleDigest", () => {
  const names = ["main.cjs", "preload.cjs"]

  it("stays the same when a rebuild writes the same bytes", () =>
    inTempDir((dir) => {
      fs.writeFileSync(path.join(dir, "main.cjs"), "main")
      fs.writeFileSync(path.join(dir, "preload.cjs"), "preload")
      const before = bundleDigest(dir, names)
      fs.writeFileSync(path.join(dir, "main.cjs"), "main")
      assert.strictEqual(bundleDigest(dir, names), before)
    }))

  it("changes with either bundle, and with one going missing", () =>
    inTempDir((dir) => {
      fs.writeFileSync(path.join(dir, "main.cjs"), "main")
      fs.writeFileSync(path.join(dir, "preload.cjs"), "preload")
      const before = bundleDigest(dir, names)
      fs.writeFileSync(path.join(dir, "preload.cjs"), "preload 2")
      const edited = bundleDigest(dir, names)
      assert.notStrictEqual(edited, before)
      fs.rmSync(path.join(dir, "main.cjs"))
      assert.notStrictEqual(bundleDigest(dir, names), edited)
    }))
})
