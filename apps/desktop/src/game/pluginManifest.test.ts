import { assert, describe, it } from "@effect/vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { compareVersions, isPluginFileName, parseManifest } from "./pluginManifest"

describe("parseManifest", () => {
  it("reads the plugin the app ships", () => {
    const text = Fs.readFileSync(
      Path.resolve(import.meta.dirname, "../../../../packages/ballest-editor-link/info.toml"),
      "utf8"
    )
    const manifest = parseManifest(text)
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
    assert.deepStrictEqual(manifest.files, ["main.as"])
  })

  it("reads sections, comments and lists as the plugin manager does", () => {
    const manifest = parseManifest(
      "# a plugin\r\n[meta]\r\nname = \"A # not a comment\"\r\nversion = \"1.2.3\"  # bumped\r\n\r\n[script]\r\nfiles = [ \"a.as\", \"lib/b.as\", ]\r\n"
    )
    assert.deepStrictEqual(manifest, { version: "1.2.3", files: ["a.as", "lib/b.as"] })
  })

  it("falls back to the plugin manager's defaults", () => {
    assert.deepStrictEqual(parseManifest("[meta]\nname = \"x\"\n"), { version: "0.0.0", files: ["main.as"] })
    // A version outside [meta] isn't the plugin's.
    assert.strictEqual(parseManifest("version = \"9.9.9\"\n").version, "0.0.0")
  })
})

describe("compareVersions", () => {
  it("orders dot-separated numbers, not strings", () => {
    assert.isBelow(compareVersions("0.1.0", "0.2.0"), 0)
    assert.isBelow(compareVersions("0.9.0", "0.10.0"), 0)
    assert.isAbove(compareVersions("1.0.0", "0.99.99"), 0)
    assert.strictEqual(compareVersions("0.1.0", "0.1.0"), 0)
  })

  it("counts a missing segment as 0 and reads a segment's leading digits, like the host's atol", () => {
    assert.strictEqual(compareVersions("0.1", "0.1.0"), 0)
    assert.isBelow(compareVersions("0.1", "0.1.1"), 0)
    assert.strictEqual(compareVersions("0.2.0-rc1", "0.2.0"), 0)
    assert.isBelow(compareVersions("dev", "0.0.1"), 0)
  })
})

describe("isPluginFileName", () => {
  it("allows names inside the plugin's folder only", () => {
    assert.isTrue(isPluginFileName("main.as"))
    assert.isTrue(isPluginFileName("lib/util.as"))
    for (const name of ["", "../main.as", "lib/../../x", "/etc/passwd", "C:\\x.as", "\\\\server\\x", "a//b"]) {
      assert.isFalse(isPluginFileName(name), name)
    }
  })
})
