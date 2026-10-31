// Lays out the app electron-builder packages: package.json (with the config), the main and preload bundles, the
// renderer build, the game assets beside it and the icons.
import { Effect, FileSystem, Path, Schema } from "effect"
import { type Platform, stageLayout, stagePackageJson, type UpdateFeed } from "./config.ts"
import { writeIcons } from "./icons.ts"

export const repoRoot = Effect.gen(function*() {
  const path = yield* Path.Path
  return path.resolve(import.meta.dirname, "../../..")
})

export class MissingBuild extends Schema.TaggedError<MissingBuild>()("MissingBuild", {
  file: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `${this.file} is missing: ${this.hint}`
  }
}

/** Every file under `root`, relative to it with `/` separators. */
const filesUnder = Effect.fn("filesUnder")(function*(root: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const entries = yield* fs.readDirectory(root, { recursive: true })
  const files = yield* Effect.filter(
    entries,
    (entry) => fs.stat(path.join(root, entry)).pipe(Effect.map((info) => info.type === "File"))
  )
  return files.map((file) => file.split(path.sep).join("/")).sort()
})

const copyFiles = Effect.fn("copyFiles")(
  function*(from: string, to: string, files: ReadonlyArray<string>) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* Effect.forEach(
      files,
      (file) =>
        fs.makeDirectory(path.dirname(path.join(to, file)), { recursive: true }).pipe(
          Effect.andThen(fs.copyFile(path.join(from, file), path.join(to, file)))
        ),
      { concurrency: 16, discard: true }
    )
  }
)

export const readJson = <S extends Schema.Top & { readonly DecodingServices: never }>(file: string, schema: S) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return yield* Schema.decodeEffect(Schema.fromJsonString(schema))(yield* fs.readFileString(file))
  })

export interface StageOptions {
  readonly platform: Platform
  readonly version: string
  /** Where electron-builder writes the installers. */
  readonly output: string
  readonly feed: UpdateFeed
  /** An empty directory to stage into. */
  readonly directory: string
}

/**
 * Stages the app from what `turbo run build --filter=@ballest/desktop` left on disk. The game assets come from
 * `assets/` (minus the raw meshes and textures) and `web-assets/`, the same two trees apps/web's build copies into
 * `dist/assets/`; they're shipped once, as `resources/assets`, and left out of the renderer's copy.
 */
export const stage = Effect.fn("stage")(function*(options: StageOptions) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* repoRoot
  const from = {
    main: path.join(root, "apps/desktop/dist-electron"),
    renderer: path.join(root, "apps/web/dist"),
    assets: path.join(root, "assets"),
    webAssets: path.join(root, "web-assets"),
    icon: path.join(root, "apps/desktop/resources/icon.svg")
  }
  const required = [
    { file: path.join(from.main, "main.cjs"), hint: "build apps/desktop (`pnpm build`)" },
    { file: path.join(from.main, "preload.cjs"), hint: "build apps/desktop (`pnpm build`)" },
    { file: path.join(from.renderer, "index.html"), hint: "build apps/web (`pnpm build`)" },
    { file: path.join(from.assets, "catalog.json"), hint: "assets/ is committed; is this the repo root?" },
    { file: path.join(from.webAssets, "pieces"), hint: "fetch or compress the meshes and textures (`pnpm assets`)" }
  ]
  for (const { file, hint } of required) {
    if (!(yield* fs.exists(file))) return yield* new MissingBuild({ file, hint })
  }

  const to = (directory: string) => path.join(options.directory, directory)
  const rawOnly = ["pieces/", "textures/"]
  const assets = (yield* filesUnder(from.assets)).filter((file) => !rawOnly.some((dir) => file.startsWith(dir)))
  const webAssets = yield* filesUnder(from.webAssets)
  yield* copyFiles(from.assets, to(stageLayout.assets), assets)
  yield* copyFiles(from.webAssets, to(stageLayout.assets), webAssets)

  const shipped = new Set([...assets, ...webAssets].map((file) => `assets/${file}`))
  const renderer = (yield* filesUnder(from.renderer)).filter((file) => !shipped.has(file))
  yield* copyFiles(from.renderer, to(stageLayout.renderer), renderer)
  yield* copyFiles(from.main, to(stageLayout.main), yield* filesUnder(from.main))
  yield* writeIcons(from.icon, to(stageLayout.buildResources))

  // The pinned Electron (apps/desktop's devDependency) is what the packaged app runs on.
  const desktop = yield* readJson(
    path.join(root, "apps/desktop/package.json"),
    Schema.Struct({ devDependencies: Schema.Struct({ electron: Schema.String }) })
  )
  const manifest = stagePackageJson({ ...options, electronVersion: desktop.devDependencies.electron })
  yield* fs.writeFileString(path.join(options.directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return { assets: assets.length + webAssets.length, renderer: renderer.length }
})
