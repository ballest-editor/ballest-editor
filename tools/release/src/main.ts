#!/usr/bin/env -S node --experimental-strip-types
// Release tooling (tools/release/README.md): package the desktop app, read a release tag, check a release's assets.
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Option, Path, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { githubFeed, MOCK_UPDATE_SERVER_PORT, mockFeed, platforms } from "./config.ts"
import { packageDesktop } from "./desktop.ts"
import { serveMockUpdates } from "./mockUpdateServer.ts"
import { verifyRelease } from "./releaseAssets.ts"
import { smoke } from "./smoke.ts"
import { readJson, repoRoot } from "./stage.ts"
import { parseRelease } from "./version.ts"

/** The version a local build gets without `--version`: apps/desktop's, which is also what `pnpm start` reports. */
const workspaceVersion = Effect.gen(function*() {
  const path = yield* Path.Path
  const file = path.join(yield* repoRoot, "apps/desktop/package.json")
  return (yield* readJson(file, Schema.Struct({ version: Schema.String }))).version
})

const desktop = Command.make(
  "desktop",
  {
    platform: Flag.Literals("platform", platforms).pipe(
      Flag.withDescription("installer to build: win (NSIS), linux (AppImage)")
    ),
    version: Flag.String("app-version").pipe(
      Flag.withDescription("app version, or a tag like v0.2.0-rc.1 (default: apps/desktop/package.json's)"),
      Flag.optional
    ),
    output: Flag.String("output").pipe(
      Flag.withDescription("output directory, relative to the repo root (default: release, or release-mock)"),
      Flag.optional
    ),
    skipBuild: Flag.Boolean("skip-build").pipe(
      Flag.withDescription(
        "package the existing apps/web/dist and apps/desktop/dist-electron instead of running turbo"
      ),
      Flag.withDefault(false)
    ),
    mockUpdates: Flag.Boolean("mock-updates").pipe(
      Flag.withDescription("check the mock update server on localhost for updates, not GitHub; writes to release-mock"),
      Flag.withDefault(false)
    ),
    mockUpdatePort: Flag.Int("mock-update-port").pipe(
      Flag.withDescription(`the mock update server's port (default: ${MOCK_UPDATE_SERVER_PORT})`),
      Flag.withDefault(MOCK_UPDATE_SERVER_PORT)
    )
  },
  Effect.fn(function*({ mockUpdatePort, mockUpdates, output, platform, skipBuild, version }) {
    const release = yield* parseRelease(Option.isSome(version) ? version.value : yield* workspaceVersion)
    yield* packageDesktop({
      platform,
      version: release.version,
      output: Option.getOrElse(output, () => mockUpdates ? MOCK_RELEASE_DIR : "release"),
      build: !skipBuild,
      feed: mockUpdates ? mockFeed(mockUpdatePort) : githubFeed
    })
  })
).pipe(
  Command.withDescription("Build the installer for one platform with electron-builder (unsigned, never published)")
)

const versionCommand = Command.make(
  "version",
  { tag: Argument.String("tag").pipe(Argument.withDescription("a release tag, v1.2.3 or v1.2.3-rc.1")) },
  Effect.fn(function*({ tag }) {
    const release = yield* parseRelease(tag)
    yield* Console.log(`version=${release.version}\nprerelease=${release.prerelease}`)
  })
).pipe(Command.withDescription("Print a tag's version and whether it's a prerelease, as GITHUB_OUTPUT lines"))

const verify = Command.make(
  "verify",
  {
    directory: Argument.String("directory").pipe(Argument.withDescription("the collected release assets")),
    version: Flag.String("app-version").pipe(Flag.withDescription("the version being released"))
  },
  Effect.fn(function*({ directory, version }) {
    const release = yield* parseRelease(version)
    yield* Console.log(yield* verifyRelease(directory, release.version, platforms))
  })
).pipe(Command.withDescription("Check every platform's installer, blockmap and update manifest; write SHA256SUMS"))

/** Where `--mock-updates` builds go, and what the mock update server serves. */
const MOCK_RELEASE_DIR = "release-mock"

const mockServer = Command.make(
  "mock-server",
  {
    directory: Flag.String("directory").pipe(
      Flag.withDescription("the artifacts to serve, relative to the repo root"),
      Flag.withDefault(MOCK_RELEASE_DIR)
    ),
    port: Flag.Int("port").pipe(Flag.withDefault(MOCK_UPDATE_SERVER_PORT))
  },
  Effect.fn(function*({ directory, port }) {
    const path = yield* Path.Path
    return yield* serveMockUpdates({ directory: path.resolve(yield* repoRoot, directory), port })
  })
).pipe(Command.withDescription("Serve --mock-updates builds on localhost as an update feed, until stopped"))

const smokeCommand = Command.make("smoke", {}, smoke).pipe(
  Command.withDescription("Stage the built app and lay it out unpacked with electron-builder, then check the result")
)

Command.make("release").pipe(
  Command.withSubcommands([desktop, versionCommand, verify, smokeCommand, mockServer]),
  Command.run({ version: "0.1.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
