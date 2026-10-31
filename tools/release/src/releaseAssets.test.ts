import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { createHash } from "node:crypto"
import { CHECKSUMS, parseUpdateManifest, releaseProblems, verifyRelease } from "./releaseAssets.ts"

const VERSION = "9.9.9-smoke.0"
const EXE = `Ballest-Editor-${VERSION}-x64.exe`
const APPIMAGE = `Ballest-Editor-${VERSION}-x86_64.AppImage`

// What electron-builder 26 writes, quoting and all.
const manifest = (version: string, file: string) =>
  `version: ${version}
files:
  - url: ${file}
    sha512: c2hhNTEy
    size: 3
path: ${file}
sha512: c2hhNTEy
releaseDate: '2026-10-31T00:50:02.480Z'
`

/** A temp directory holding a complete two-platform release of VERSION. */
const release = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const dir = yield* fs.makeTempDirectoryScoped()
  const files = {
    [EXE]: "exe",
    [`${EXE}.blockmap`]: "map",
    [APPIMAGE]: "app",
    "latest.yml": manifest(VERSION, EXE),
    "latest-linux.yml": manifest(VERSION, APPIMAGE)
  }
  for (const [name, contents] of Object.entries(files)) yield* fs.writeFileString(path.join(dir, name), contents)
  return { fs, path, dir }
})

describe("parseUpdateManifest", () => {
  it("reads the version and every artifact, once each", () => {
    assert.deepStrictEqual(parseUpdateManifest(manifest("1.2.3", "a.exe")), { version: "1.2.3", files: ["a.exe"] })
    assert.deepStrictEqual(parseUpdateManifest("version: '1.0.0'\r\nfiles:\r\n  - url: \"b c.AppImage\"\r\n"), {
      version: "1.0.0",
      files: ["b c.AppImage"]
    })
    assert.deepStrictEqual(parseUpdateManifest(""), { version: undefined, files: [] })
  })
})

describe("verifyRelease", () => {
  it.effect("writes sha256sum lines for every file but itself, sorted", () =>
    Effect.gen(function*() {
      const { dir, fs, path } = yield* release
      yield* fs.makeDirectory(path.join(dir, "win-unpacked"))
      const sums = yield* verifyRelease(dir, VERSION, ["win", "linux"])
      assert.strictEqual(yield* fs.readFileString(path.join(dir, CHECKSUMS)), sums)
      const lines = sums.trimEnd().split("\n")
      assert.deepStrictEqual(lines.map((line) => line.split("  ")[1]), [
        EXE,
        `${EXE}.blockmap`,
        APPIMAGE,
        "latest-linux.yml",
        "latest.yml"
      ])
      assert.include(lines, `${createHash("sha256").update("exe").digest("hex")}  ${EXE}`)
      // Rerunning doesn't checksum the previous SHA256SUMS.
      assert.strictEqual(yield* verifyRelease(dir, VERSION, ["win", "linux"]), sums)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("lists every problem and writes nothing", () =>
    Effect.gen(function*() {
      const { dir, fs, path } = yield* release
      yield* fs.remove(path.join(dir, `${EXE}.blockmap`))
      yield* fs.writeFileString(path.join(dir, "latest-linux.yml"), manifest("9.9.8", "Other.AppImage"))
      assert.deepStrictEqual(yield* releaseProblems(dir, VERSION, ["win", "linux"]), [
        `${EXE}.blockmap is missing`,
        `latest-linux.yml is for version 9.9.8, not ${VERSION}`,
        `latest-linux.yml doesn't list ${APPIMAGE}`,
        "latest-linux.yml points at Other.AppImage, which is missing"
      ])
      const error = yield* Effect.flip(verifyRelease(dir, VERSION, ["win", "linux"]))
      assert.strictEqual(error._tag, "ReleaseAssetsInvalid")
      assert.isFalse(yield* fs.exists(path.join(dir, CHECKSUMS)))
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))

  it.effect("checks only the platforms asked for", () =>
    Effect.gen(function*() {
      const { dir, fs, path } = yield* release
      yield* fs.remove(path.join(dir, "latest.yml"))
      assert.deepStrictEqual(yield* releaseProblems(dir, VERSION, ["linux"]), [])
      assert.deepStrictEqual(yield* releaseProblems(dir, VERSION, ["win"]), ["latest.yml is missing"])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
