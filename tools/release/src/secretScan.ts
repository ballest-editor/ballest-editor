// Part of `release smoke`: nothing that grants access ships in the app (docs/DESKTOP.md § Feedback and usage
// statistics). The app holds no credential: the collect endpoint has the only secrets. This catches one that leaked in
// anyway, a token inlined into a bundle or a key file copied with the assets, before it reaches an installer.
import { Effect, FileSystem, Path } from "effect"

/** What a secret looks like, by what it is. Each is a credential's own shape, so ordinary code never matches. */
const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["a GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/],
  ["a GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{60,}\b/],
  ["a private key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ["a database URL with a password", /\bpostgres(?:ql)?:\/\/[^:\s/"'`]+:[^@\s/"'`]+@/],
  // The collect endpoint's own variables: the app never reads them, so their names in a bundle mean someone wired one in.
  ["a collect endpoint secret's name", /\b(?:GITHUB_APP_PRIVATE_KEY|IP_HASH_SALT|DATABASE_URL)\b/]
]

/** The files read as text: code, markup and data. The meshes and textures are binary and never hold one. */
const TEXT_FILE = /\.(?:c?js|mjs|map|html|css|json|toml|as|ya?ml|txt|md|env|pem|key)$/i

/** What `text` holds that looks like a secret, by kind. */
export const secretsIn = (text: string): ReadonlyArray<string> =>
  SECRET_PATTERNS.flatMap(([kind, pattern]) => pattern.test(text) ? [kind] : [])

/** Every text file under `directory` that looks like it holds a secret, as `<file>: <kind>`, relative to `directory`. */
export const scanForSecrets = Effect.fn("scanForSecrets")(function*(directory: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const files = (yield* fs.readDirectory(directory, { recursive: true })).filter((file) => TEXT_FILE.test(file))
  const found = yield* Effect.forEach(files, (file) =>
    fs.readFileString(path.join(directory, file)).pipe(
      Effect.map((text) => secretsIn(text).map((kind) => `${file} holds ${kind}`)),
      // a directory named like a file, or one that isn't UTF-8: nothing to scan
      Effect.orElseSucceed(() => [])
    ), { concurrency: 16 })
  return found.flat()
})
