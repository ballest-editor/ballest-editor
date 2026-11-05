import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { writeJson } from "./files"

/** What one running copy of the app has open: `<userData>/windows/<pid>.json`. */
export const WindowEntry = Schema.Struct({
  pid: Schema.Int,
  /** The project's folder; null for Untitled Project, and for a window showing the required chooser. */
  project: Schema.NullOr(Schema.String),
  /** Showing the required chooser: it holds no project and isn't Untitled Project. */
  choosing: Schema.Boolean
})
export type WindowEntry = typeof WindowEntry.Type

const EntryJson = Schema.fromJsonString(WindowEntry)

/**
 * Whether `pid` is running. Signal 0 only tests for the process, on Windows too (libuv opens it and reads its exit
 * code). EPERM means it runs under another account, as an elevated copy on Windows does, so it counts as running: a
 * project wrongly held is less harm than two windows writing one project's files.
 */
export const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

/**
 * What the other running copies have open (docs/DESKTOP.md § Other windows). Each window is a process of its own, so
 * they tell each other through files: one per copy, written at start and on every project change, removed on quit. A
 * crashed copy's file stays until someone notices its pid is gone. A reused pid reads as a live window until that
 * process ends, which is rare enough to accept: the cost is one project refused for a while.
 */
export class WindowRegistry extends Context.Service<WindowRegistry, {
  /** This copy's pid. */
  readonly pid: number
  /** The other live windows. Files of copies no longer running, and files that don't decode, are removed. */
  readonly others: Effect.Effect<ReadonlyArray<WindowEntry>>
  /** Says what this window has open. A failure is only logged: the registry mustn't stop a window from working. */
  readonly announce: (entry: Omit<WindowEntry, "pid">) => Effect.Effect<void>
  /** Takes this window out, on quit. */
  readonly leave: Effect.Effect<void>
}>()("ballest/desktop/project/WindowRegistry") {
  /** `isAlive` stands in for `isProcessAlive` in tests, where one process plays several windows. */
  static readonly make = Effect.fn("WindowRegistry.make")(function*(
    folder: string,
    pid: number,
    isAlive: (pid: number) => boolean
  ) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const remove = (file: string) => Effect.ignore(fs.remove(file, { force: true }))

    const entryAt = (file: string) =>
      fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeEffect(EntryJson)), Effect.option)

    /** The entry `name` holds, none when it belongs to a dead copy or isn't one. Temp files name their copy too. */
    const look = Effect.fnUntraced(function*(name: string) {
      const file = path.join(folder, name)
      const owner = Number.parseInt(name, 10)
      if (owner === pid) return []
      if (Number.isNaN(owner) || !isAlive(owner)) {
        yield* remove(file)
        return []
      }
      if (!name.endsWith(".json")) return []
      const entry = yield* entryAt(file)
      if (entry._tag === "None") {
        // gone between the listing and the read (it quit), or never an entry; either way there is no window here
        yield* remove(file)
        return []
      }
      return [entry.value]
    })

    const others = fs.readDirectory(folder).pipe(
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
      Effect.flatMap(Effect.forEach(look)),
      Effect.map((entries) => entries.flat())
    )

    const fileOfThis = path.join(folder, `${pid}.json`)

    const announce = (entry: Omit<WindowEntry, "pid">) =>
      fs.makeDirectory(folder, { recursive: true }).pipe(
        Effect.andThen(writeJson(fs, fileOfThis, { pid, ...entry })),
        Effect.catch((error) => Effect.logWarning("Could not record this window's project", error))
      )

    return WindowRegistry.of({ pid, others, announce, leave: remove(fileOfThis) })
  })

  static readonly layer = Layer.effect(
    WindowRegistry,
    Effect.gen(function*() {
      const { windowsDir } = yield* DesktopEnvironment
      return yield* WindowRegistry.make(windowsDir, process.pid, isProcessAlive)
    })
  )
}
