import { Effect, type FileSystem, type Path } from "effect"
import { createHash } from "node:crypto"

/** What may be imported at all; only `.balledit` files live in a project or the game's maps folder. */
export const MAP_EXTENSIONS = [".balledit", ".ballmap", ".json"] as const

/** The game's largest maps are a few MB; anything this size isn't a map. */
export const MAX_MAP_BYTES = 64 * 1024 * 1024

/** A file name for a project's `maps/` or the game's maps folder: a `.balledit` name that can't leave the folder or upset Windows. */
export const isMapFileName = (name: string): boolean =>
  name.toLowerCase().endsWith(".balledit") && name.length > ".balledit".length &&
  // oxlint-disable-next-line eslint/no-control-regex -- control characters are exactly what is refused here
  !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !name.startsWith(".") && !name.endsWith(" ")

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
