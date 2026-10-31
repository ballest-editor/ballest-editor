import { NodeServices } from "@effect/platform-node"
import { assert, describe, it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Path } from "effect"
import { GameHost } from "./GameHost"
import { cmdlineRunsGame, GameProcess, tasklistHasGame } from "./GameProcess"

describe("GameProcess", () => {
  it("reads tasklist's CSV output", () => {
    assert.isTrue(tasklistHasGame("\"Ballest-Win64-Shipping.exe\",\"10212\",\"Console\",\"1\",\"2,104,320 K\"\r\n"))
    assert.isFalse(tasklistHasGame("INFO: No tasks are running which match the specified criteria.\r\n"))
  })

  it("recognises the game in a Proton command line", () => {
    assert.isTrue(
      cmdlineRunsGame(
        "Z:\\home\\player\\.local\\share\\Steam\\steamapps\\common\\Ballest of Them All\\Ballest\\Binaries\\Win64\\Ballest-Win64-Shipping.exe\0"
      )
    )
    assert.isTrue(cmdlineRunsGame("/usr/bin/wine\0C:/Games/Ballest-Win64-Shipping.exe\0-dx12\0"))
    assert.isFalse(cmdlineRunsGame("/usr/bin/grep\0Ballest-Win64-Shipping.exe.bak\0"))
    assert.isFalse(cmdlineRunsGame("electron\0--app=ballest-editor\0"))
  })

  it.effect("scans the process table on Linux", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const procDir = yield* fs.makeTempDirectoryScoped()
      const spawn = (pid: string, cmdline: string) =>
        fs.makeDirectory(path.join(procDir, pid)).pipe(
          Effect.andThen(fs.writeFileString(path.join(procDir, pid, "cmdline"), cmdline))
        )
      yield* spawn("1", "/sbin/init\0")
      yield* fs.makeDirectory(path.join(procDir, "self"))
      const isRunning = GameProcess.make.pipe(
        Effect.flatMap((game) => game.isRunning),
        Effect.provide(Layer.succeed(GameHost, GameHost.of({ platform: "linux", home: procDir, env: {}, procDir })))
      )
      assert.isFalse(yield* isRunning)
      yield* spawn("4242", "C:\\Ballest\\Binaries\\Win64\\Ballest-Win64-Shipping.exe\0")
      assert.isTrue(yield* isRunning)
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})
