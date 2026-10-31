import { Effect, type FileSystem } from "effect"

// Existence checks for folders the app doesn't own: anything unreadable counts as absent.

const isType = (type: FileSystem.File.Type) => (fs: FileSystem.FileSystem, path: string) =>
  fs.stat(path).pipe(Effect.map((info) => info.type === type), Effect.orElseSucceed(() => false))

export const isFile = isType("File")
export const isDirectory = isType("Directory")
