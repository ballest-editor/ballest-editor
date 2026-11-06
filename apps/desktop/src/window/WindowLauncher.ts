import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { spawn } from "node:child_process"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { ElectronApp } from "../electron/ElectronApp"
import { inheritedFlags, projectArgOf } from "./launchArgs"

export class WindowLaunchError extends Schema.TaggedError<WindowLaunchError>()("WindowLaunchError", {
  project: Schema.String,
  cause: Schema.Defect()
}) {
  override get message(): string {
    return `Couldn't start a new window for ${this.project}.`
  }
}

/** A program to run and its arguments. */
interface LaunchCommand {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

/**
 * How to start another copy of this app on `project`, in each way it runs:
 * - Packaged, the executable itself, except that an AppImage runs from a mount that goes when the copy that made it
 *   exits, so a new window starts from the AppImage's own file (`APPIMAGE`).
 * - Unpackaged (`pnpm dev:desktop`, the `start` script), the Electron binary with the app's folder. The environment
 *   carries the dev server's URL and the dev profile. The dev runner doesn't follow this copy: it outlives Ctrl+C.
 */
export const launchCommand = (
  { appImage, appPath, argv, execPath, isPackaged }: {
    readonly isPackaged: boolean
    readonly execPath: string
    readonly appPath: string
    /** `APPIMAGE`, which the AppImage runtime sets. */
    readonly appImage: Option.Option<string>
    readonly argv: ReadonlyArray<string>
  },
  project: string
): LaunchCommand => {
  const args = [...inheritedFlags(argv), projectArgOf(project)]
  if (!isPackaged) return { command: execPath, args: [appPath, ...args] }
  return { command: Option.getOrElse(appImage, () => execPath), args }
}

/**
 * Runs `command` on its own: it outlives this process, and fails here only if it can't be started. `ELECTRON_RUN_AS_NODE`
 * is dropped, because Electron-based terminals export it and it turns the binary into plain Node.
 */
export const spawnDetached = ({ args, command }: LaunchCommand, cwd: string) =>
  Effect.callback<void, unknown>((resume) => {
    const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env
    try {
      const child = spawn(command, args, { cwd, detached: true, env, stdio: "ignore" })
      child.once("error", (error) => resume(Effect.fail(error)))
      child.once("spawn", () => {
        child.unref()
        resume(Effect.void)
      })
    } catch (error) {
      resume(Effect.fail(error))
    }
  })

/** Starts windows: each is another running copy of the app (docs/DESKTOP.md § Other windows). */
export class WindowLauncher extends Context.Service<WindowLauncher, {
  /** Starts another copy of the app on `project`, which goes straight there. */
  readonly open: (project: string) => Effect.Effect<void, WindowLaunchError>
}>()("ballest/desktop/window/WindowLauncher") {
  static readonly layer = Layer.effect(
    WindowLauncher,
    Effect.gen(function*() {
      const { isPackaged, userData } = yield* DesktopEnvironment
      const { appPath } = yield* (yield* ElectronApp).metadata
      const appImage = yield* Config.String("APPIMAGE").pipe(Config.option)
      const open = Effect.fn("WindowLauncher.open")(function*(project: string) {
        const command = launchCommand(
          { isPackaged, execPath: process.execPath, appPath, appImage, argv: process.argv },
          project
        )
        yield* spawnDetached(command, userData).pipe(
          Effect.tapError((cause) => Effect.logWarning(`Could not start ${command.command}`, cause)),
          Effect.mapError((cause) => new WindowLaunchError({ project, cause }))
        )
      })
      return WindowLauncher.of({ open })
    })
  )
}
