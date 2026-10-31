import { Context, Effect, FileSystem, Layer, Path } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { GameHost } from "./GameHost"
import { GAME_EXE } from "./locations"

/** Whether `tasklist /FO CSV /NH` output lists the game. */
export const tasklistHasGame = (output: string): boolean =>
  output.split(/\r?\n/).some((line) => line.toLowerCase().startsWith(`"${GAME_EXE.toLowerCase()}"`))

/**
 * Whether a process's `/proc/<pid>/cmdline` (NUL-separated arguments) runs the game. Under Proton the exe is an
 * argument (`…\Ballest-Win64-Shipping.exe`, through wine and Proton's own launchers), never the process name.
 */
export const cmdlineRunsGame = (cmdline: string): boolean =>
  cmdline.split("\0").some((arg) => /(?:^|[\\/])ballest-win64-shipping\.exe$/i.test(arg))

/** Is the game running? Windows asks `tasklist`; Linux reads the process table. */
export class GameProcess extends Context.Service<GameProcess, {
  readonly isRunning: Effect.Effect<boolean>
}>()("ballest/desktop/game/GameProcess") {
  static readonly make = Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const host = yield* GameHost
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

    const windows = spawner.string(
      ChildProcess.make("tasklist", ["/FI", `IMAGENAME eq ${GAME_EXE}`, "/FO", "CSV", "/NH"])
    ).pipe(Effect.map(tasklistHasGame), Effect.orElseSucceed(() => false))

    const linux = Effect.gen(function*() {
      const pids = (yield* fs.readDirectory(host.procDir)).filter((name) => /^\d+$/.test(name))
      const runs = yield* Effect.forEach(
        pids,
        (pid) =>
          fs.readFileString(path.join(host.procDir, pid, "cmdline")).pipe(
            Effect.map(cmdlineRunsGame),
            // A process can exit between the listing and the read, and others' may be unreadable.
            Effect.orElseSucceed(() => false)
          ),
        { concurrency: 16 }
      )
      return runs.includes(true)
    }).pipe(Effect.orElseSucceed(() => false))

    return GameProcess.of({
      isRunning: (host.platform === "win32" ? windows : linux).pipe(Effect.withSpan("GameProcess.isRunning"))
    })
  })

  static readonly layer = Layer.effect(GameProcess, GameProcess.make)
}
