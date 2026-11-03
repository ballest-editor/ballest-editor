import { Effect, type FileSystem, type Path } from "effect"
import { createHash } from "node:crypto"

/** The game's largest maps are a few MB; anything this size isn't a map. */
export const MAX_MAP_BYTES = 64 * 1024 * 1024

/** The SHA-256 of `bytes` as lowercase hex: what a link record keeps of a file. */
export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

/**
 * Writes `data` to `file` through a temp file renamed over it, so a crash leaves the old file, never half of one. The
 * text is written as is: UTF-8, no BOM added, line endings untouched.
 */
export const writeAtomic = (fs: FileSystem.FileSystem, file: string, data: string | Uint8Array) => {
  const temp = `${file}.${process.pid}.tmp`
  const write = typeof data === "string" ? fs.writeFileString(temp, data) : fs.writeFile(temp, data)
  return write.pipe(
    Effect.andThen(fs.rename(temp, file)),
    Effect.tapError(() => Effect.ignore(fs.remove(temp, { force: true })))
  )
}

/** Writes `value` as indented JSON (the project's files are meant to be read and diffed), atomically. */
export const writeJson = (fs: FileSystem.FileSystem, file: string, value: unknown) =>
  writeAtomic(fs, file, `${JSON.stringify(value, null, 2)}\n`)

/** Whether `child` is `parent` or inside it. Windows paths compare case-insensitively. */
export const isWithin = (path: Path.Path, parent: string, child: string, platform: NodeJS.Platform): boolean => {
  const fold = (p: string) => platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p)
  const relative = path.relative(fold(parent), fold(child))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

/** Whether `a` and `b` are the same folder or file. Windows paths compare case-insensitively. */
export const isSamePath = (path: Path.Path, a: string, b: string, platform: NodeJS.Platform): boolean =>
  isWithin(path, a, b, platform) && isWithin(path, b, a, platform)
