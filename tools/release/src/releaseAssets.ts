// The release job's last check before publishing: every platform's installer, blockmap and update manifest is
// there, the manifests describe this version and point at files that exist, and SHA256SUMS covers what's uploaded.
import { Effect, FileSystem, Path, Schema } from "effect"
import { createHash } from "node:crypto"
import { installerName, type Platform, releaseFiles, updateManifestName } from "./config.ts"

export const CHECKSUMS = "SHA256SUMS"

export class ReleaseAssetsInvalid extends Schema.TaggedError<ReleaseAssetsInvalid>()("ReleaseAssetsInvalid", {
  directory: Schema.String,
  problems: Schema.Array(Schema.String)
}) {
  override get message(): string {
    return `${this.directory} isn't a complete release:\n${this.problems.map((problem) => `  - ${problem}`).join("\n")}`
  }
}

export interface UpdateManifest {
  readonly version: string | undefined
  /** `files[].url` and `path`: the artifacts electron-updater downloads. */
  readonly files: ReadonlyArray<string>
}

const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, "$2")

/**
 * The fields of an electron-builder update manifest (`latest.yml`) that point at artifacts. It's a flat YAML file
 * electron-builder writes itself, so this reads the `version`, `path` and `- url` lines rather than pulling in a
 * YAML parser.
 */
export const parseUpdateManifest = (text: string): UpdateManifest => {
  const lines = text.split(/\r?\n/)
  const value = (pattern: RegExp) => lines.flatMap((line) => pattern.exec(line)?.[1] ?? []).map(unquote)
  return {
    version: value(/^version:(.*)$/)[0],
    files: [...new Set([...value(/^\s*-\s*url:(.*)$/), ...value(/^path:(.*)$/)])]
  }
}

/** What's wrong with `directory` as the release of `version` for `platforms`; empty when it's complete. */
export const releaseProblems = Effect.fn("releaseProblems")(
  function*(directory: string, version: string, platforms: ReadonlyArray<Platform>) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const exists = (file: string) => fs.exists(path.join(directory, file))
    const problems: Array<string> = []
    for (const platform of platforms) {
      const missing = yield* Effect.filter(
        releaseFiles(platform, version),
        (file) => Effect.map(exists(file), (ok) => !ok)
      )
      problems.push(...missing.map((file) => `${file} is missing`))
      const installer = installerName(platform, version)
      const manifestFile = updateManifestName(platform)
      if (missing.includes(manifestFile)) continue
      const manifest = parseUpdateManifest(yield* fs.readFileString(path.join(directory, manifestFile)))
      if (manifest.version !== version) {
        problems.push(`${manifestFile} is for version ${manifest.version ?? "(none)"}, not ${version}`)
      }
      if (!manifest.files.includes(installer)) problems.push(`${manifestFile} doesn't list ${installer}`)
      for (const file of manifest.files) {
        if (!(yield* exists(file))) problems.push(`${manifestFile} points at ${file}, which is missing`)
      }
    }
    return problems
  }
)

/** `sha256sum` format, one line per file directly in `directory` (except SHA256SUMS itself), sorted by name. */
export const checksums = Effect.fn("checksums")(function*(directory: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const names = yield* Effect.filter(
    (yield* fs.readDirectory(directory)).filter((name) => name !== CHECKSUMS).sort(),
    (name) => fs.stat(path.join(directory, name)).pipe(Effect.map((info) => info.type === "File"))
  )
  const lines = yield* Effect.forEach(names, (name) =>
    fs.readFile(path.join(directory, name)).pipe(
      Effect.map((bytes) => `${createHash("sha256").update(bytes).digest("hex")}  ${name}`)
    ))
  return lines.map((line) => `${line}\n`).join("")
})

/** Fails with every problem found, or writes `SHA256SUMS` and returns its contents. */
export const verifyRelease = Effect.fn("verifyRelease")(
  function*(directory: string, version: string, platforms: ReadonlyArray<Platform>) {
    const problems = yield* releaseProblems(directory, version, platforms)
    if (problems.length > 0) return yield* new ReleaseAssetsInvalid({ directory, problems })
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const sums = yield* checksums(directory)
    yield* fs.writeFileString(path.join(directory, CHECKSUMS), sums)
    return sums
  }
)
