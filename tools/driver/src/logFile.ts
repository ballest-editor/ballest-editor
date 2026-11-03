import { Effect, type FileSystem } from "effect"

// Reading host.log as it grows: the channels note its size before a command and read what came after.

/** The file's size in bytes, 0 when it isn't there. */
export const logSize = (fs: FileSystem.FileSystem, file: string) =>
  fs.stat(file).pipe(Effect.map((info) => Number(info.size)), Effect.orElseSucceed(() => 0))

/** The file's text from a byte offset on, "" when it isn't there. */
export const logFrom = (fs: FileSystem.FileSystem, file: string, offset: number) =>
  fs.readFile(file).pipe(
    Effect.map((bytes) => new TextDecoder().decode(bytes.subarray(offset))),
    Effect.orElseSucceed(() => "")
  )
