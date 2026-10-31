// `release desktop`: builds the app, stages it and runs electron-builder for one platform (docs/DESKTOP.md
// § Packaging). Unsigned: electron-builder is told not to look for a certificate.
import { Effect, FileSystem, Path, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { createRequire } from "node:module"
import type { Platform, UpdateFeed } from "./config.ts"
import { ReleaseAssetsInvalid, releaseProblems } from "./releaseAssets.ts"
import { repoRoot, stage } from "./stage.ts"

export class CommandFailed extends Schema.TaggedError<CommandFailed>()("CommandFailed", {
  command: Schema.String,
  exitCode: Schema.Int
}) {
  override get message(): string {
    return `\`${this.command}\` exited with ${this.exitCode}`
  }
}

const electronBuilderCli = createRequire(import.meta.url).resolve("electron-builder/cli.js")

/** Runs a command with this process's stdio and fails unless it exits 0. */
export const run = Effect.fn("run")(function*(command: string, args: ReadonlyArray<string>, options: {
  readonly cwd: string
  readonly env?: Record<string, string>
  /** Through a shell, which Node needs for `.cmd` shims on Windows. Arguments aren't quoted, so no spaces. */
  readonly shell?: boolean
}) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const exitCode = yield* spawner.exitCode(ChildProcess.make(command, args, {
    cwd: options.cwd,
    ...(options.env === undefined ? {} : { env: options.env, extendEnv: true }),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    shell: options.shell ?? false
  }))
  if (exitCode !== 0) return yield* new CommandFailed({ command: [command, ...args].join(" "), exitCode })
})

/**
 * Runs electron-builder on a staged app (its package.json holds the config), never publishing, never signing. The
 * staged app has no node_modules: the main and preload bundles inline every dependency but `electron`.
 */
export const electronBuilder = (directory: string, targets: ReadonlyArray<string>) =>
  run(process.execPath, [electronBuilderCli, ...targets, "--publish", "never", "--projectDir", directory], {
    cwd: directory,
    env: { CSC_IDENTITY_AUTO_DISCOVERY: "false" }
  })

/** turbo builds apps/web, its assets and apps/desktop, replaying whatever is cached. */
export const buildApp = Effect.fn("buildApp")(function*() {
  // `pnpm` is a .cmd shim on Windows.
  yield* run("pnpm", ["exec", "turbo", "run", "build", "--filter=@ballest/desktop"], {
    cwd: yield* repoRoot,
    shell: process.platform === "win32"
  })
})

export const packageDesktop = Effect.fn("packageDesktop")(function*(options: {
  readonly platform: Platform
  readonly version: string
  /** Relative to the repo root. */
  readonly output: string
  readonly build: boolean
  readonly feed: UpdateFeed
}) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const output = path.resolve(yield* repoRoot, options.output)
  if (options.build) yield* buildApp()

  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ballest-release-" })
  const staged = yield* stage({
    platform: options.platform,
    version: options.version,
    output,
    feed: options.feed,
    directory
  })
  yield* Effect.logInfo(
    `Staged ${options.version} in ${directory}: ${staged.renderer} renderer files, ${staged.assets} assets`
  )

  yield* electronBuilder(directory, [`--${options.platform}`, "--x64"])

  const problems = yield* releaseProblems(output, options.version, [options.platform])
  if (problems.length > 0) return yield* new ReleaseAssetsInvalid({ directory: output, problems })
  yield* Effect.logInfo(`Wrote ${options.platform} artifacts for ${options.version} to ${output}`)
}, Effect.scoped)
