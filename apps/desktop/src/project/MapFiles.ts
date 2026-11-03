import {
  type BackupRef,
  type ImportMapPayload,
  type ImportMapResult,
  isMapFileName,
  MAP_EXTENSIONS,
  type MapBackup,
  type MapBackupFile,
  type MapBackups,
  type MapLink,
  type OpenedMapFile,
  type ProjectMap,
  type ProjectMapFile,
  type ProjectMaps
} from "@ballest/contracts"
import { Context, DateTime, Effect, FileSystem, Option, Path, Schema } from "effect"
import { GamePaths } from "../game/GamePaths"
import { type Backup, type BackupError, Backups, parseBackupId } from "./Backups"
import { isSamePath, MAX_MAP_BYTES, sha256, writeAtomic } from "./files"
import { emptyLink, type MapLinkError, MapLinks } from "./MapLinks"
import { backupsFolderIn, mapsFolderIn, type ProjectError, projectError, Projects } from "./Projects"

/** Only the field Export looks at in a map file; everything else is ignored. */
export const PublishedId = Schema.fromJsonString(Schema.Struct({
  worldSettings: Schema.Struct({ levelData: Schema.Struct({ levelPublishedFileId: Schema.Finite }) })
}))

/** A map file's `levelPublishedFileId`; -1 (never published) when it has none or doesn't decode. */
const publishedIdOf = (text: string): number =>
  Schema.decodeOption(PublishedId)(text).pipe(
    Option.map((map) => map.worldSettings.levelData.levelPublishedFileId),
    Option.getOrElse(() => -1)
  )

/** What `listMaps` reports of a map's bytes. */
interface MapContents {
  readonly hash: string
  readonly publishedFileId: number
}

type MapFilesEffect<A> = Effect.Effect<A, ProjectError | MapLinkError | BackupError>

/**
 * The maps in the project in use (docs/PROJECTS.md § The files): its `maps/` folder, the files picked in the Import
 * dialog (read only), and the backups, the project's and the exports' (`<userData>/backups/`). Maps are named by file
 * name, never by path. Every write over a map goes through `Backups.overwrite`. What a map's bytes say is cached by
 * the file's time, size and inode.
 */
export class MapFiles extends Context.Service<MapFiles, {
  readonly list: Effect.Effect<ProjectMaps, ProjectError>
  readonly read: (fileName: string) => Effect.Effect<ProjectMapFile, ProjectError>
  /** Writes a new map; fails when the project has one of that name. Makes the project first when needed. */
  readonly create: (fileName: string, text: string) => MapFilesEffect<ProjectMap>
  /** Writes over a map (or writes it, if it has gone); the old file goes to the project's backups. */
  readonly save: (fileName: string, text: string) => MapFilesEffect<ProjectMap>
  /** Writes `to`, moves `from` to the backups and its link to `to`. Fails when `to` exists. */
  readonly rename: (from: string, to: string, text: string) => MapFilesEffect<ProjectMap>
  /** Reads a file the user picked in the Import dialog; it may be imported from now on. */
  readonly pick: (file: string) => Effect.Effect<OpenedMapFile, ProjectError>
  readonly importMap: (payload: ImportMapPayload) => MapFilesEffect<ImportMapResult>
  /** The current project's backups and the exports', newest first. */
  readonly backups: Effect.Effect<MapBackups>
  /** Reads a backup `backups` listed; any other name is refused. */
  readonly readBackup: (ref: BackupRef) => Effect.Effect<MapBackupFile, ProjectError>
  /** The file `fileName` is in `project`'s `maps/`; refused when it isn't a map file's name. */
  readonly fileOf: (project: string, fileName: string) => Effect.Effect<string, ProjectError>
  /** A map in `project` as `listMaps` reports it; `link` when the caller has it, else read from `link.json`. */
  readonly info: (project: string, fileName: string, link?: MapLink | null) => Effect.Effect<ProjectMap, ProjectError>
  /** What any map file's bytes say, read again only once its time or size changes. */
  readonly contentsOf: (
    file: string
  ) => Effect.Effect<MapContents, ProjectError | Effect.Error<ReturnType<FileSystem.FileSystem["stat"]>>>
  /** Reads any map file, unless it is too large to be a map. */
  readonly readBytes: (file: string) => Effect.Effect<Uint8Array, ProjectError>
}>()("ballest/desktop/project/MapFiles") {
  /** `platform` decides how paths compare (Windows: case-insensitively); `exportBackups` keeps what Export wrote over. */
  static readonly make = Effect.fn("MapFiles.make")(function*(platform: NodeJS.Platform, exportBackups: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const projects = yield* Projects
    const links = yield* MapLinks
    const game = yield* GamePaths
    const backupStore = yield* Backups

    const picked = new Set<string>()
    const same = (a: string, b: string) => isSamePath(path, a, b, platform)

    const fileOf = Effect.fnUntraced(function*(project: string, fileName: string) {
      if (!isMapFileName(fileName)) return yield* projectError("fileName", fileName)()
      return path.join(mapsFolderIn(path, project), fileName)
    })

    const contents = new Map<string, MapContents & { readonly stamp: string }>()
    const cached = Effect.fnUntraced(function*(file: string, stamp: string) {
      const known = contents.get(file)
      if (known?.stamp === stamp) return known
      const bytes = yield* fs.readFile(file).pipe(Effect.mapError(projectError("read", file)))
      const read = { stamp, hash: sha256(bytes), publishedFileId: publishedIdOf(new TextDecoder().decode(bytes)) }
      contents.set(file, read)
      return read
    })

    const stampOf = (stat: FileSystem.File.Info) =>
      `${Option.getOrElse(stat.mtime, () => new Date(0)).toISOString()} ${stat.size} ${
        Option.getOrElse(stat.ino, () => 0n)
      }`

    const contentsOf = (file: string) => fs.stat(file).pipe(Effect.flatMap((stat) => cached(file, stampOf(stat))))

    const info = Effect.fnUntraced(function*(project: string, fileName: string, link?: MapLink | null) {
      const file = path.join(mapsFolderIn(path, project), fileName)
      const stat = yield* fs.stat(file).pipe(Effect.mapError(projectError("read", file)))
      const modifiedAt = Option.getOrElse(stat.mtime, () => new Date(0)).toISOString()
      const { hash, publishedFileId } = yield* cached(file, stampOf(stat))
      return {
        fileName,
        path: file,
        modifiedAt,
        hash,
        publishedFileId,
        link: link === undefined ? (yield* links.all(project))[fileName] ?? null : link
      } satisfies ProjectMap
    })

    const list = Effect.gen(function*() {
      // Untitled Project has no folder and nothing listed
      const project = Option.getOrNull(yield* projects.current)
      if (project === null) return []
      const dir = mapsFolderIn(path, project)
      if (!(yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false)))) return []
      const names = yield* fs.readDirectory(dir).pipe(Effect.mapError(projectError("read", dir)))
      const all = yield* links.all(project)
      const maps = yield* Effect.forEach(
        names.filter(isMapFileName),
        (name) => info(project, name, all[name] ?? null).pipe(Effect.option)
      )
      return maps.flatMap(Option.toArray).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    }).pipe(Effect.withSpan("MapFiles.list"))

    /** Reads a file with `read`, unless it is too large to be a map. */
    const readMapFile = <A>(
      file: string,
      read: Effect.Effect<A, Effect.Error<ReturnType<FileSystem.FileSystem["readFile"]>>>
    ) =>
      fs.stat(file).pipe(
        Effect.filterOrFail((stat) => Number(stat.size) <= MAX_MAP_BYTES, () => projectError("tooLarge", file)()),
        Effect.andThen(read),
        Effect.catchTag(
          "PlatformError",
          (cause) => Effect.fail(projectError(cause.reason._tag === "NotFound" ? "notFound" : "read", file)(cause))
        )
      )

    const readBytes = (file: string) => readMapFile(file, fs.readFile(file))
    const readText = (file: string) => readMapFile(file, fs.readFileString(file))

    const read = Effect.fn("MapFiles.read")(function*(fileName: string) {
      const project = yield* projects.inUse
      const text = yield* readText(yield* fileOf(project, fileName))
      return { ...(yield* info(project, fileName)), text } satisfies ProjectMapFile
    })

    const write = (file: string, data: string | Uint8Array) =>
      writeAtomic(fs, file, data).pipe(Effect.mapError(projectError("write", file)))

    const exists = (file: string) => fs.exists(file).pipe(Effect.mapError(projectError("read", file)))

    const create = Effect.fn("MapFiles.create")(function*(fileName: string, text: string) {
      const project = yield* projects.ensure
      const file = yield* fileOf(project, fileName)
      if (yield* exists(file)) return yield* projectError("exists", fileName)()
      yield* write(file, text)
      return yield* info(project, fileName)
    })

    const save = Effect.fn("MapFiles.save")(function*(fileName: string, text: string) {
      const project = yield* projects.ensure
      yield* backupStore.overwrite(backupsFolderIn(path, project), yield* fileOf(project, fileName), text)
      return yield* info(project, fileName)
    })

    const rename = Effect.fn("MapFiles.rename")(function*(from: string, to: string, text: string) {
      if (from === to) return yield* save(to, text)
      const project = yield* projects.ensure
      const old = yield* fileOf(project, from)
      const next = yield* fileOf(project, to)
      if (yield* exists(next)) return yield* projectError("exists", to)()
      yield* write(next, text)
      yield* backupStore.retire(backupsFolderIn(path, project), old)
      yield* links.rename(project, from, to)
      return yield* info(project, to)
    })

    const pick = Effect.fn("MapFiles.pick")(function*(raw: string) {
      const file = path.resolve(raw)
      if (!MAP_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext))) {
        return yield* projectError("extension", file)()
      }
      const text = yield* readText(file)
      picked.add(file)
      return { path: file, name: path.basename(file), text } satisfies OpenedMapFile
    })

    const importMap = Effect.fn("MapFiles.importMap")(
      function*({ source: raw, fileName, text, replace }: ImportMapPayload) {
        const source = path.resolve(raw)
        if (!picked.has(source)) return yield* projectError("notPicked", source)()
        const project = yield* projects.ensure
        const file = yield* fileOf(project, fileName)
        // Importing a file of this very project changes nothing.
        if (same(source, file)) return { _tag: "Imported", map: yield* info(project, fileName) } as const
        if (!replace && (yield* exists(file))) return { _tag: "Clash", fileName } as const
        const bytes = yield* fs.readFile(source).pipe(Effect.mapError(projectError("read", source)))
        yield* backupStore.overwrite(backupsFolderIn(path, project), file, text)

        const origin = { path: source, hash: sha256(bytes), at: DateTime.formatIso(yield* DateTime.now) }
        // A map imported from the game's maps folder under its own name is that file's export from the start.
        const gameMaps = (yield* game.get).mapsFolder.path
        const fromGame = gameMaps !== null && same(path.dirname(source), gameMaps) && path.basename(source) === fileName
        const link = yield* links.modify(project, fileName, (previous) => ({
          ...(previous ?? emptyLink),
          origin,
          ...(fromGame && { export: origin, lastSeenHash: origin.hash })
        }))
        return { _tag: "Imported", map: yield* info(project, fileName, link) } as const
      }
    )

    const backupOf = (place: BackupRef["place"]) => ({ id, fileName, at }: Backup): MapBackup => ({
      place,
      id,
      fileName,
      at
    })

    const backups = Effect.gen(function*() {
      const project = Option.getOrNull(yield* projects.current)
      const inProject = project === null
        ? []
        : (yield* backupStore.list(backupsFolderIn(path, project))).map(backupOf("project"))
      const exported = (yield* backupStore.list(exportBackups)).map(backupOf("export"))
      return [...inProject, ...exported].sort((a, b) => b.at.localeCompare(a.at))
    }).pipe(Effect.withSpan("MapFiles.backups"))

    const readBackup = Effect.fn("MapFiles.readBackup")(function*({ place, id }: BackupRef) {
      const project = yield* projects.inUse
      const file = path.join(place === "project" ? backupsFolderIn(path, project) : exportBackups, id)
      const backup = parseBackupId(id)
      if (Option.isNone(backup)) return yield* projectError("notFound", file)()
      return { ...backupOf(place)(backup.value), text: yield* readText(file) } satisfies MapBackupFile
    })

    return MapFiles.of({
      list,
      read,
      create,
      save,
      rename,
      pick,
      importMap,
      backups,
      readBackup,
      fileOf,
      info,
      contentsOf,
      readBytes
    })
  })
}
