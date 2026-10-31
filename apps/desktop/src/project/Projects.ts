import type {
  BackupRef,
  ExportMapPayload,
  ExportMapResult,
  ImportMapPayload,
  ImportMapResult,
  MapBackup,
  MapBackupFile,
  MapBackups,
  MapLink,
  OpenedMapFile,
  ProjectInfo,
  ProjectMap,
  ProjectMapFile,
  ProjectMaps,
  ProjectState
} from "@ballest/contracts"
import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { type GamePathError, GamePaths } from "../game/GamePaths"
import { DesktopSettings, type ProjectSettings } from "../settings/DesktopSettings"
import { type Backup, type BackupError, Backups, parseBackupId } from "./Backups"
import { isMapFileName, isWithin, MAP_EXTENSIONS, MAX_MAP_BYTES, sha256, writeAtomic, writeJson } from "./files"
import { emptyLink, type MapLinkError, MapLinks } from "./MapLinks"

/** `ballest-project.json`, at the project's root: what is shared with the project (docs/PROJECTS.md). */
export const ProjectFile = Schema.Struct({
  formatVersion: Schema.Literal(1),
  name: Schema.String,
  /** The creator new maps get; unset, Settings › General's. */
  defaultCreator: Schema.optionalKey(Schema.String),
  /** Where Export writes: the game's maps folder (a folder of the user's choosing comes later). */
  exportTarget: Schema.Literal("game")
})
export type ProjectFile = typeof ProjectFile.Type

export const PROJECT_FILE = "ballest-project.json"
const RECENT_LIMIT = 8

export class ProjectError extends Schema.TaggedError<ProjectError>()("ProjectError", {
  path: Schema.String,
  reason: Schema.Literals([
    "inGameMaps",
    "fileName",
    "exists",
    "notFound",
    "notPicked",
    "extension",
    "tooLarge",
    "read",
    "write"
  ]),
  cause: Schema.optional(Schema.Defect())
}) {
  override get message(): string {
    switch (this.reason) {
      case "inGameMaps":
        return `${this.path} is the game's maps folder or inside it. The game rewrites the maps it finds there, so a project can't live in it: choose another folder, and use Export to game to put a map there.`
      case "fileName":
        return `${this.path} isn't a map file name (a .balledit name, no folders).`
      case "exists":
        return `The project already has a map called ${this.path}.`
      case "notFound":
        return `${this.path} doesn't exist any more.`
      case "notPicked":
        return `${this.path} wasn't picked in a dialog.`
      case "extension":
        return `${this.path} isn't a map file (${MAP_EXTENSIONS.join(", ")}).`
      case "tooLarge":
        return `${this.path} is too large to be a map.`
      case "read":
        return `Couldn't read ${this.path}.`
      case "write":
        return `Couldn't write ${this.path}.`
    }
  }
}

/** Only the field Export looks at in the file it would replace; everything else is ignored. */
const PublishedId = Schema.fromJsonString(Schema.Struct({
  worldSettings: Schema.Struct({ levelData: Schema.Struct({ levelPublishedFileId: Schema.Finite }) })
}))

type ProjectEffect<A> = Effect.Effect<A, ProjectError | MapLinkError | BackupError>

/**
 * The project folder and the maps in it (docs/PROJECTS.md). One project is in use at a time: the default
 * (`Documents/Ballest Editor/Maps`) until the user picks another. A project exists on disk from the first New map or
 * Import. Main touches only its `maps/` and `.ballest/` folders, the game's maps folder (Export), the backups of the
 * files Export wrote over there (`<userData>/backups/`), and the files the user picks in the Import dialog (read only).
 * Maps are named by file name, never by path. Every write over a map goes through `Backups.overwrite`.
 */
export class Projects extends Context.Service<Projects, {
  readonly state: Effect.Effect<ProjectState>
  /** Uses `folder` as the project from now on; refused when it is the game's maps folder or inside it. */
  readonly use: (folder: string) => Effect.Effect<ProjectState, ProjectError>
  /** Goes back to a recent project, or the default; any other folder is refused. */
  readonly switchTo: (folder: string) => Effect.Effect<ProjectState, ProjectError>
  /** The current project's `maps/` folder, when it exists. */
  readonly mapsFolder: Effect.Effect<Option.Option<string>>
  readonly list: Effect.Effect<ProjectMaps, ProjectError>
  readonly read: (fileName: string) => Effect.Effect<ProjectMapFile, ProjectError>
  /** Writes a new map; fails when the project has one of that name. Makes the project first when needed. */
  readonly create: (fileName: string, text: string) => ProjectEffect<ProjectMap>
  /** Writes over a map (or writes it, if it has gone); the old file goes to the project's backups. */
  readonly save: (fileName: string, text: string) => ProjectEffect<ProjectMap>
  /** Writes `to`, moves `from` to the backups and its link to `to`. Fails when `to` exists. */
  readonly rename: (from: string, to: string, text: string) => ProjectEffect<ProjectMap>
  /** Reads a file the user picked in the Import dialog; it may be imported from now on. */
  readonly pick: (file: string) => Effect.Effect<OpenedMapFile, ProjectError>
  readonly importMap: (payload: ImportMapPayload) => ProjectEffect<ImportMapResult>
  /** Copies a map byte for byte into the game's maps folder and records the export in its link. */
  readonly exportMap: (
    payload: ExportMapPayload
  ) => Effect.Effect<ExportMapResult, ProjectError | MapLinkError | BackupError | GamePathError>
  /** The current project's backups and the exports', newest first. */
  readonly backups: Effect.Effect<MapBackups>
  /** Reads a backup `backups` listed; any other name is refused. */
  readonly readBackup: (ref: BackupRef) => Effect.Effect<MapBackupFile, ProjectError>
}>()("ballest/desktop/project/Projects") {
  /** `platform` decides how paths compare (Windows: case-insensitively); `exportBackups` keeps what Export wrote over. */
  static readonly make = Effect.fn("Projects.make")(function*(
    defaultFolder: string,
    platform: NodeJS.Platform,
    exportBackups: string
  ) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const settings = yield* DesktopSettings
    const links = yield* MapLinks
    const game = yield* GamePaths
    const backupStore = yield* Backups

    const picked = new Set<string>()
    const same = (a: string, b: string) => isWithin(path, a, b, platform) && isWithin(path, b, a, platform)
    const fail = (reason: ProjectError["reason"], file: string) => (cause?: unknown) =>
      new ProjectError({ path: file, reason, ...(cause === undefined ? {} : { cause }) })

    const remembered = settings.get.pipe(Effect.map((s): ProjectSettings => s.project ?? {}))
    const current = remembered.pipe(Effect.map((s) => s.recent?.[0] ?? defaultFolder))

    const info = (folder: string) =>
      fs.readFileString(path.join(folder, PROJECT_FILE)).pipe(
        Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(ProjectFile))),
        Effect.map((file) => ({ name: file.name, exists: true })),
        Effect.orElseSucceed(() => ({ name: path.basename(folder), exists: false })),
        Effect.map((found): ProjectInfo => ({ path: folder, ...found, isDefault: same(folder, defaultFolder) }))
      )

    const state = Effect.gen(function*() {
      const { recent = [] } = yield* remembered
      const [folder = defaultFolder, ...others] = recent
      const before = same(folder, defaultFolder) || others.some((p) => same(p, defaultFolder))
        ? others
        : [...others, defaultFolder]
      return {
        current: yield* info(folder),
        recent: yield* Effect.forEach(before, info)
      } satisfies ProjectState
    })

    /** Refuses the game's maps folder and anything inside it (wherever it is now, found or not). */
    const outsideGame = Effect.fnUntraced(function*(folder: string) {
      const maps = (yield* game.get).mapsFolder.path
      if (maps !== null && isWithin(path, maps, folder, platform)) return yield* fail("inGameMaps", folder)()
    })

    const use = Effect.fn("Projects.use")(function*(raw: string) {
      const folder = path.resolve(raw)
      yield* outsideGame(folder)
      yield* settings.update((s) => {
        const others = (s.project?.recent ?? []).filter((p) => !same(p, folder))
        return { ...s, project: { ...s.project, recent: [folder, ...others].slice(0, RECENT_LIMIT) } }
      }).pipe(Effect.mapError(fail("write", raw)))
      return yield* state
    })

    const switchTo = Effect.fn("Projects.switchTo")(function*(raw: string) {
      const { recent = [] } = yield* remembered
      if (!same(raw, defaultFolder) && !recent.some((p) => same(p, raw))) return yield* fail("notPicked", raw)()
      return yield* use(raw)
    })

    const mapsDir = (project: string) => path.join(project, "maps")

    /** The current project, made on disk if it isn't yet: `maps/`, `.ballest/`, `ballest-project.json`, `.gitignore`. */
    const ensure = Effect.gen(function*() {
      const project = yield* current
      yield* outsideGame(project)
      const writeIfMissing = (file: string, write: Effect.Effect<void, unknown>) =>
        fs.exists(file).pipe(Effect.flatMap((exists) => exists ? Effect.void : write))
      yield* Effect.gen(function*() {
        yield* fs.makeDirectory(mapsDir(project), { recursive: true })
        yield* fs.makeDirectory(path.join(project, ".ballest"), { recursive: true })
        const file: ProjectFile = { formatVersion: 1, name: path.basename(project), exportTarget: "game" }
        yield* writeIfMissing(path.join(project, PROJECT_FILE), writeJson(fs, path.join(project, PROJECT_FILE), file))
        yield* writeIfMissing(
          path.join(project, ".gitignore"),
          fs.writeFileString(path.join(project, ".gitignore"), ".ballest/\n")
        )
      }).pipe(Effect.mapError(fail("write", project)))
      return project
    })

    const target = Effect.fnUntraced(function*(project: string, fileName: string) {
      if (!isMapFileName(fileName)) return yield* fail("fileName", fileName)()
      return path.join(mapsDir(project), fileName)
    })

    const mapInfo = Effect.fnUntraced(function*(project: string, fileName: string, link?: MapLink | null) {
      const file = path.join(mapsDir(project), fileName)
      const stat = yield* fs.stat(file).pipe(Effect.mapError(fail("read", file)))
      return {
        fileName,
        path: file,
        modifiedAt: Option.getOrElse(stat.mtime, () => new Date(0)).toISOString(),
        link: link === undefined ? (yield* links.all(project))[fileName] ?? null : link
      } satisfies ProjectMap
    })

    const list = Effect.gen(function*() {
      const project = yield* current
      const dir = mapsDir(project)
      if (!(yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false)))) return []
      const names = yield* fs.readDirectory(dir).pipe(Effect.mapError(fail("read", dir)))
      const all = yield* links.all(project)
      const maps = yield* Effect.forEach(
        names.filter(isMapFileName),
        (name) => mapInfo(project, name, all[name] ?? null).pipe(Effect.option)
      )
      return maps.flatMap(Option.toArray).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    }).pipe(Effect.withSpan("Projects.list"))

    const readText = Effect.fnUntraced(function*(file: string) {
      return yield* fs.stat(file).pipe(
        Effect.filterOrFail((stat) => Number(stat.size) <= MAX_MAP_BYTES, () => fail("tooLarge", file)()),
        Effect.andThen(fs.readFileString(file)),
        Effect.catchTag(
          "PlatformError",
          (cause) => Effect.fail(fail(cause.reason._tag === "NotFound" ? "notFound" : "read", file)(cause))
        )
      )
    })

    const read = Effect.fn("Projects.read")(function*(fileName: string) {
      const project = yield* current
      const text = yield* readText(yield* target(project, fileName))
      return { ...(yield* mapInfo(project, fileName)), text } satisfies ProjectMapFile
    })

    const write = (file: string, data: string | Uint8Array) =>
      writeAtomic(fs, file, data).pipe(Effect.mapError(fail("write", file)))

    const exists = (file: string) => fs.exists(file).pipe(Effect.mapError(fail("read", file)))

    const projectBackups = (project: string) => path.join(project, ".ballest", "backups")
    const backupsIn = (place: BackupRef["place"], project: string) =>
      place === "project" ? projectBackups(project) : exportBackups

    const create = Effect.fn("Projects.create")(function*(fileName: string, text: string) {
      const project = yield* ensure
      const file = yield* target(project, fileName)
      if (yield* exists(file)) return yield* fail("exists", fileName)()
      yield* write(file, text)
      return yield* mapInfo(project, fileName)
    })

    const save = Effect.fn("Projects.save")(function*(fileName: string, text: string) {
      const project = yield* ensure
      yield* backupStore.overwrite(projectBackups(project), yield* target(project, fileName), text)
      return yield* mapInfo(project, fileName)
    })

    const rename = Effect.fn("Projects.rename")(function*(from: string, to: string, text: string) {
      if (from === to) return yield* save(to, text)
      const project = yield* ensure
      const old = yield* target(project, from)
      const next = yield* target(project, to)
      if (yield* exists(next)) return yield* fail("exists", to)()
      yield* write(next, text)
      yield* backupStore.retire(projectBackups(project), old)
      yield* links.rename(project, from, to)
      return yield* mapInfo(project, to)
    })

    const pick = Effect.fn("Projects.pick")(function*(raw: string) {
      const file = path.resolve(raw)
      if (!MAP_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext))) return yield* fail("extension", file)()
      const text = yield* readText(file)
      picked.add(file)
      return { path: file, name: path.basename(file), text } satisfies OpenedMapFile
    })

    const importMap = Effect.fn("Projects.importMap")(
      function*({ source: raw, fileName, text, replace }: ImportMapPayload) {
        const source = path.resolve(raw)
        if (!picked.has(source)) return yield* fail("notPicked", source)()
        const project = yield* ensure
        const file = yield* target(project, fileName)
        // Importing a file of this very project changes nothing.
        if (same(source, file)) return { _tag: "Imported", map: yield* mapInfo(project, fileName) } as const
        if (!replace && (yield* exists(file))) return { _tag: "Clash", fileName } as const
        const bytes = yield* fs.readFile(source).pipe(Effect.mapError(fail("read", source)))
        yield* backupStore.overwrite(projectBackups(project), file, text)

        const origin = { path: source, hash: sha256(bytes), at: DateTime.formatIso(yield* DateTime.now) }
        // A map imported from the game's maps folder under its own name is that file's export from the start.
        const gameMaps = (yield* game.get).mapsFolder.path
        const fromGame = gameMaps !== null && same(path.dirname(source), gameMaps) && path.basename(source) === fileName
        const link = yield* links.modify(project, fileName, (previous) => ({
          ...(previous ?? emptyLink),
          origin,
          ...(fromGame && { export: origin, lastSeenHash: origin.hash })
        }))
        return { _tag: "Imported", map: yield* mapInfo(project, fileName, link) } as const
      }
    )

    const exportMap = Effect.fn("Projects.exportMap")(function*({ fileName, replacePublished }: ExportMapPayload) {
      const project = yield* current
      const source = yield* target(project, fileName)
      const bytes = yield* fs.readFile(source).pipe(
        Effect.mapError((cause) => fail(cause.reason._tag === "NotFound" ? "notFound" : "read", source)(cause))
      )
      const file = path.join(yield* game.mapsFolderForWrite, fileName)

      if (!replacePublished) {
        const publishedFileId = yield* fs.readFileString(file).pipe(
          Effect.flatMap(Schema.decodeEffect(PublishedId)),
          Effect.map((map) => map.worldSettings.levelData.levelPublishedFileId),
          Effect.option
        )
        if (Option.isSome(publishedFileId) && publishedFileId.value > 0) {
          return {
            _tag: "Published",
            file: { path: file, name: fileName },
            publishedFileId: publishedFileId.value
          } as const
        }
      }

      yield* backupStore.overwrite(exportBackups, file, bytes)
      const exported = { path: file, hash: sha256(bytes), at: DateTime.formatIso(yield* DateTime.now) }
      const link = yield* links.modify(project, fileName, (previous) => ({
        ...(previous ?? emptyLink),
        export: exported,
        lastSeenHash: exported.hash
      }))
      return { _tag: "Exported", file: { path: file, name: fileName }, link: link ?? emptyLink } as const
    })

    const mapsFolder = current.pipe(
      Effect.map(mapsDir),
      Effect.flatMap((dir) =>
        fs.exists(dir).pipe(
          Effect.map((found) => found ? Option.some(dir) : Option.none()),
          Effect.orElseSucceed(Option.none)
        )
      )
    )

    const backupOf = (place: BackupRef["place"]) => ({ id, fileName, at }: Backup): MapBackup => ({
      place,
      id,
      fileName,
      at
    })

    const backups = Effect.gen(function*() {
      const project = yield* current
      const inProject = (yield* backupStore.list(projectBackups(project))).map(backupOf("project"))
      const exported = (yield* backupStore.list(exportBackups)).map(backupOf("export"))
      return [...inProject, ...exported].sort((a, b) => b.at.localeCompare(a.at))
    }).pipe(Effect.withSpan("Projects.backups"))

    const readBackup = Effect.fn("Projects.readBackup")(function*({ place, id }: BackupRef) {
      const file = path.join(backupsIn(place, yield* current), id)
      const backup = parseBackupId(id)
      if (Option.isNone(backup)) return yield* fail("notFound", file)()
      return { ...backupOf(place)(backup.value), text: yield* readText(file) } satisfies MapBackupFile
    })

    return Projects.of({
      state,
      use,
      switchTo,
      mapsFolder,
      list,
      read,
      create,
      save,
      rename,
      pick,
      importMap,
      exportMap,
      backups,
      readBackup
    })
  })

  static readonly layer = Layer.effect(
    Projects,
    Effect.gen(function*() {
      const { defaultProjectDir, platform, exportBackupsDir } = yield* DesktopEnvironment
      return yield* Projects.make(defaultProjectDir, platform, exportBackupsDir)
    })
  )
}
