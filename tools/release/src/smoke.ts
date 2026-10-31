// `release smoke` (`pnpm release:smoke`; release.yml runs it after the build, before packaging): stages the built
// app into a temp directory and has electron-builder lay it out unpacked for Linux, then checks the result has what
// the packaged app reads. It catches a bad config, a renamed bundle or a lost asset without building an installer.
import { Effect, FileSystem, Path } from "effect"
import { githubFeed, stageLayout } from "./config.ts"
import { electronBuilder } from "./desktop.ts"
import { ReleaseAssetsInvalid } from "./releaseAssets.ts"
import { stage } from "./stage.ts"

const SMOKE_VERSION = "0.0.0-smoke.0"

export const smoke = Effect.fn("smoke")(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "ballest-smoke-" })
  const app = path.join(directory, "app")
  const output = path.join(directory, "release")
  yield* fs.makeDirectory(app)
  const staged = yield* stage({ platform: "linux", version: SMOKE_VERSION, output, feed: githubFeed, directory: app })

  const expectStaged = [
    `${stageLayout.main}/main.cjs`,
    `${stageLayout.main}/preload.cjs`,
    `${stageLayout.main}/icon.png`,
    `${stageLayout.renderer}/index.html`,
    `${stageLayout.assets}/catalog.json`,
    `${stageLayout.plugins}/ballest-editor-link/info.toml`,
    `${stageLayout.plugins}/ballest-editor-link/main.as`,
    `${stageLayout.buildResources}/icon.ico`,
    `${stageLayout.buildResources}/icons/512x512.png`
  ]
  // The renderer's copy of the game assets is dropped: they ship once, beside app.asar.
  const expectNotStaged = [`${stageLayout.renderer}/assets/catalog.json`]

  yield* electronBuilder(app, ["--linux", "dir", "--x64"])
  const resources = path.join(output, "linux-unpacked", "resources")
  const expectPackaged = [
    "app.asar",
    "app-update.yml",
    "assets/catalog.json",
    "plugins/ballest-editor-link/info.toml",
    "plugins/ballest-editor-link/main.as"
  ]

  const problems = [
    ...yield* Effect.filter(expectStaged, (file) => Effect.map(fs.exists(path.join(app, file)), (ok) => !ok)),
    ...yield* Effect.filter(expectNotStaged, (file) => fs.exists(path.join(app, file))),
    ...yield* Effect.filter(expectPackaged, (file) => Effect.map(fs.exists(path.join(resources, file)), (ok) => !ok))
  ]
  if (problems.length > 0) {
    return yield* new ReleaseAssetsInvalid({
      directory,
      problems: problems.map((file) => `${file} is ${expectNotStaged.includes(file) ? "present" : "missing"}`)
    })
  }
  yield* Effect.logInfo(`Smoke OK: ${staged.renderer} renderer files, ${staged.assets} assets, unpacked in ${output}`)
}, Effect.scoped)
