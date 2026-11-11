import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, Option } from "effect"
import { tmpdir } from "node:os"
import { launchCommand, spawnDetached } from "./WindowLauncher"

const running = {
  isPackaged: true,
  execPath: "/opt/app/ballest-editor",
  appPath: "/opt/app/resources/app.asar",
  appImage: Option.none(),
  argv: ["/opt/app/ballest-editor"]
}

describe("launchCommand", () => {
  it("packaged, runs the executable (Windows, the Linux folder build)", () => {
    const execPath = "C:\\Program Files\\Ballest Editor\\Ballest Editor.exe"
    assert.deepStrictEqual(launchCommand({ ...running, execPath, argv: [execPath] }, "C:\\maps"), {
      command: execPath,
      args: ["--project=C:\\maps"]
    })
  })

  it("packaged as an AppImage, runs the AppImage's own file, never the mount it runs from", () => {
    const command = launchCommand(
      {
        ...running,
        execPath: "/tmp/.mount_BallesXYZ/ballest-editor",
        appImage: Option.some("/home/me/Ballest-Editor-x86_64.AppImage"),
        argv: ["/tmp/.mount_BallesXYZ/ballest-editor", "--no-sandbox"]
      },
      "/home/me/maps"
    )
    assert.deepStrictEqual(command, {
      command: "/home/me/Ballest-Editor-x86_64.AppImage",
      args: ["--no-sandbox", "--project=/home/me/maps"]
    })
  })

  it("unpackaged, runs Electron on the app's folder, whatever APPIMAGE a parent left behind", () => {
    const command = launchCommand(
      {
        isPackaged: false,
        execPath: "/repo/node_modules/electron/dist/electron",
        appPath: "/repo/apps/desktop",
        appImage: Option.some("/some/other/App.AppImage"),
        argv: ["/repo/node_modules/electron/dist/electron", "/repo/apps/desktop", "--project=/old"]
      },
      "/maps"
    )
    assert.deepStrictEqual(command, {
      command: "/repo/node_modules/electron/dist/electron",
      args: ["/repo/apps/desktop", "--project=/maps"]
    })
  })
})

describe("spawnDetached", () => {
  it.effect("completes once the program is started", () =>
    spawnDetached({ command: process.execPath, args: ["-e", ""] }, tmpdir()))

  it.effect("fails when the program can't be started", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(spawnDetached({ command: "/no/such/program", args: [] }, tmpdir()))
      assert.isTrue(Exit.isFailure(exit))
    }))
})
