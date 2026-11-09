import {
  type BackupRef,
  type GameMap,
  type GameMaps,
  type ImportMapPayload,
  type ImportMapResult,
  isMapFileName,
  MAP_EXTENSIONS,
  type MapBackup,
  type MapBackupFile,
  type MapBackups,
  type MapLink,
  type MapThumbnailPng,
  type OpenedMapFile,
  type ProjectMap,
  type ProjectMapFile,
  type ProjectMaps,
  sidecarFileNameOf,
  type WriteMapThumbnailPayload
} from "@ballest/contracts"
import { Context, DateTime, Effect, FileSystem, Option, Path, Schema } from "effect"
import { Buffer } from "node:buffer"
import { GamePaths } from "../game/GamePaths"
import { type Backup, type BackupError, Backups, parseBackupId } from "./Backups"
import { isSamePath, MAX_MAP_BYTES, sha256, writeAtomic } from "./files"
import { emptyLink, type MapLinkError, MapLinks } from "./MapLinks"
import {
  backupsFolderIn,
  mapsFolderIn,
  type ProjectError,
  projectError,
  Projects,
  readError,
  thumbnailsFolderIn
} from "./Projects"

const PublishedIdFields = Schema.Struct({
  worldSettings: Schema.Struct({ levelData: Schema.Struct({ levelPublishedFileId: Schema.Finite }) })
})

/** Only the field Export looks at in a map file; everything else is ignored. */
export const PublishedId = Schema.fromJsonString(PublishedIdFields)

/** What the game's maps list shows of a map file besides its published id; everything else is ignored. */
const MapHeading = Schema.Struct({
  worldSettings: Schema.Struct({
    levelData: Schema.Struct({ levelDisplayName: Schema.String, creatorName: Schema.String })
  }),
  items: Schema.Array(Schema.Unknown)
})

/**
 * What a map file's text says (`MapContents` less its hash): its `levelPublishedFileId`, -1 (never published) when it
 * has none or doesn't decode, and its name, creator and item count, null when they don't.
 */
const contentsOfText = (text: string): Omit<MapContents, "hash"> => {
  const json = Schema.decodeOption(Schema.fromJsonString(Schema.Unknown))(text)
  const heading = Option.flatMap(json, Schema.decodeUnknownOption(MapHeading))
  return {
    publishedFileId: Option.flatMap(json, Schema.decodeUnknownOption(PublishedIdFields)).pipe(
      Option.map((map) => map.worldSettings.levelData.levelPublishedFileId),
      Option.getOrElse(() => -1)
    ),
    displayName: Option.getOrNull(Option.map(heading, (map) => map.worldSettings.levelData.levelDisplayName)),
    creatorName: Option.getOrNull(Option.map(heading, (map) => map.worldSettings.levelData.creatorName)),
    itemCount: Option.getOrNull(Option.map(heading, (map) => map.items.length))
  }
}

const PNG_DATA_URL = "data:image/png;base64,"

/** A thumbnail's file: the hash of the map's bytes it shows. Nothing else in the folder is ours to remove. */
const THUMBNAIL_FILE = /^[0-9a-f]{64}\.png$/

/** What `listMaps` and `listGameMaps` report of a map's bytes. */
interface MapContents {
  readonly hash: string
  readonly publishedFileId: number
  readonly displayName: string | null
  readonly creatorName: string | null
  readonly itemCount: number | null
}

type MapFilesEffect<A> = Effect.Effect<A, ProjectError | MapLinkError | BackupError>

/**
 * The maps in the project in use (docs/PROJECTS.md § The files): its `maps/` folder, the files picked in the Import
 * dialog or the game's maps list (read only), the game's maps folder's list, and the backups, the project's and the exports' (`<userData>/backups/`). Maps are named by file
 * name, never by path. Every write over a map goes through `Backups.overwrite`. What a map's bytes say is cached by
 * the file's time, size and inode. A map's sidecar is the page's text to main: it is kept beside the map, goes where the
 * map goes, and is backed up the way the map is.
 */
export class MapFiles extends Context.Service<MapFiles, {
  readonly list: Effect.Effect<ProjectMaps, ProjectError>
  readonly read: (fileName: string) => Effect.Effect<ProjectMapFile, ProjectError>
  /** Writes a new map; fails when the project has one of that name. Makes the project first when needed. */
  readonly create: (fileName: string, text: string) => MapFilesEffect<ProjectMap>
  /** Writes over a map (or writes it, if it has gone); the old file goes to the project's backups. */
  readonly save: (fileName: string, text: string) => MapFilesEffect<ProjectMap>
  /** Writes `to`, moves `from` to the backups and its link and sidecar to `to`. Fails when `to` exists. */
  readonly rename: (from: string, to: string, text: string) => MapFilesEffect<ProjectMap>
  /** Writes over a map's sidecar (or writes it); the old one goes to the project's backups. */
  readonly writeSidecar: (fileName: string, text: string) => MapFilesEffect<void>
  /** The thumbnail kept for the map file with this hash; null when there is none, or no project. */
  readonly readThumbnail: (hash: string) => Effect.Effect<MapThumbnailPng | null>
  /** Keeps a thumbnail, unless no map has that hash any more, and drops those no map has. */
  readonly writeThumbnail: (thumbnail: WriteMapThumbnailPayload) => Effect.Effect<void, ProjectError>
  /** The text of a map's sidecar in `project`; null when it has none, or that can't be read (it is logged). */
  readonly sidecarOf: (project: string, fileName: string) => Effect.Effect<string | null, ProjectError>
  /** Reads a file the user picked in the Import dialog; it may be imported from now on. */
  readonly pick: (file: string) => Effect.Effect<OpenedMapFile, ProjectError>
  /** The maps in the game's maps folder, newest first, each with the project map it already is. */
  readonly listGameMaps: Effect.Effect<GameMaps, ProjectError>
  /** Reads a map in the game's maps folder as `pick` does; it may be imported from now on. */
  readonly pickGameMap: (fileName: string) => Effect.Effect<OpenedMapFile, ProjectError>
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
      const read = { stamp, hash: sha256(bytes), ...contentsOfText(new TextDecoder().decode(bytes)) }
      contents.set(file, read)
      return read
    })

    const stampOf = (stat: FileSystem.File.Info) =>
      `${Option.getOrElse(stat.mtime, () => new Date(0)).toISOString()} ${stat.size} ${
        Option.getOrElse(stat.ino, () => 0n)
      }`

    const contentsOf = (file: string) => fs.stat(file).pipe(Effect.flatMap((stat) => cached(file, stampOf(stat))))

    const info = Effect.fnUntraced(function*(project: string, fileName: string, link?: MapLink | null) {
      const file = yield* fileOf(project, fileName)
      const stat = yield* fs.stat(file).pipe(
        Effect.mapError((cause) => projectError(cause.reason._tag === "NotFound" ? "notFound" : "read", file)(cause))
      )
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
        Effect.catchTag("PlatformError", (cause) => Effect.fail(readError(file)(cause)))
      )

    const readBytes = (file: string) => readMapFile(file, fs.readFile(file))
    const readText = (file: string) => readMapFile(file, fs.readFileString(file))

    const sidecarFileIn = (project: string, fileName: string) =>
      Effect.map(fileOf(project, fileName), (file) => path.join(path.dirname(file), sidecarFileNameOf(fileName)))

    /** What a sidecar holds; a file that can't be read costs only what it held, so it never stops a map opening. */
    const readSidecarAt = (file: string) =>
      readText(file).pipe(
        Effect.catch((error) =>
          error.reason === "notFound"
            ? Effect.succeed(null)
            : Effect.logWarning(`Couldn't read ${file}`, error).pipe(Effect.as(null))
        )
      )

    const sidecarOf = (project: string, fileName: string) =>
      Effect.flatMap(sidecarFileIn(project, fileName), readSidecarAt)

    const read = Effect.fn("MapFiles.read")(function*(fileName: string) {
      const project = yield* projects.inUse
      const text = yield* readText(yield* fileOf(project, fileName))
      return {
        ...(yield* info(project, fileName)),
        text,
        sidecar: yield* sidecarOf(project, fileName)
      } satisfies ProjectMapFile
    })

    const write = (file: string, data: string | Uint8Array) =>
      writeAtomic(fs, file, data).pipe(Effect.mapError(projectError("write", file)))

    const exists = (file: string) => fs.exists(file).pipe(Effect.mapError(projectError("read", file)))

    /** A sidecar left without its map (the map was replaced, or removed by hand) goes to the backups. */
    const retireSidecar = Effect.fnUntraced(function*(project: string, fileName: string) {
      yield* backupStore.retire(backupsFolderIn(path, project), yield* sidecarFileIn(project, fileName))
    })

    const create = Effect.fn("MapFiles.create")(function*(fileName: string, text: string) {
      const project = yield* projects.ensure
      const file = yield* fileOf(project, fileName)
      if (yield* exists(file)) return yield* projectError("exists", fileName)()
      yield* write(file, text)
      yield* retireSidecar(project, fileName)
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
      const sidecar = yield* sidecarOf(project, from)
      yield* retireSidecar(project, to)
      if (sidecar !== null) yield* write(yield* sidecarFileIn(project, to), sidecar)
      yield* retireSidecar(project, from)
      yield* links.rename(project, from, to)
      return yield* info(project, to)
    })

    const writeSidecar = Effect.fn("MapFiles.writeSidecar")(function*(fileName: string, text: string) {
      const project = yield* projects.ensure
      yield* backupStore.overwrite(backupsFolderIn(path, project), yield* sidecarFileIn(project, fileName), text)
    })

    const thumbnailFileIn = (project: string, hash: string) =>
      path.join(thumbnailsFolderIn(path, project), `${hash}.png`)

    const readThumbnail = Effect.fn("MapFiles.readThumbnail")(function*(hash: string) {
      const project = Option.getOrNull(yield* projects.current)
      if (project === null) return null
      const bytes = yield* Effect.option(fs.readFile(thumbnailFileIn(project, hash)))
      return Option.isNone(bytes) ? null : `${PNG_DATA_URL}${Buffer.from(bytes.value).toString("base64")}`
    })

    const writeThumbnail = Effect.fn("MapFiles.writeThumbnail")(function*({ hash, png }: WriteMapThumbnailPayload) {
      const project = yield* projects.inUse
      const dir = thumbnailsFolderIn(path, project)
      const hashes = new Set((yield* list).map((map) => map.hash))
      // a render outlasts a save: the map may have been saved again, or left this project, by the time it is done
      if (hashes.has(hash)) {
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.mapError(projectError("write", dir)))
        yield* write(thumbnailFileIn(project, hash), Buffer.from(png.slice(PNG_DATA_URL.length), "base64"))
      }
      const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []))
      const stale = names.filter((name) => THUMBNAIL_FILE.test(name) && !hashes.has(name.slice(0, -".png".length)))
      yield* Effect.forEach(stale, (name) => Effect.ignore(fs.remove(path.join(dir, name), { force: true })))
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

    /** The game's maps folder as found or chosen; it may not be there yet. */
    const gameMapsFolder = Effect.map(game.get, ({ mapsFolder }) => Option.fromNullOr(mapsFolder.path))

    const listGameMaps = Effect.gen(function*() {
      const folder = yield* gameMapsFolder
      if (Option.isNone(folder)) return []
      const names = yield* fs.readDirectory(folder.value).pipe(Effect.orElseSucceed(() => []))
      const inProject = yield* list
      /** The project map the game's `file` already is, by its link or by its bytes under the same name. */
      const projectMapOf = (file: string, fileName: string, hash: string) =>
        inProject.find((map) =>
          [map.link?.export?.path, map.link?.origin?.path].some((linked) => linked != null && same(linked, file)) ||
          (map.fileName === fileName && map.hash === hash)
        )?.fileName ?? null
      const gameMapOf = Effect.fnUntraced(function*(fileName: string) {
        const file = path.join(folder.value, fileName)
        const stat = yield* fs.stat(file)
        if (stat.type !== "File" || Number(stat.size) > MAX_MAP_BYTES) return Option.none<GameMap>()
        const { hash, ...summary } = yield* cached(file, stampOf(stat))
        return Option.some<GameMap>({
          fileName,
          modifiedAt: Option.getOrElse(stat.mtime, () => new Date(0)).toISOString(),
          ...summary,
          inProject: projectMapOf(file, fileName, hash)
        })
      })
      // a file that went, or can't be read just now, is left out until the next look
      const maps = yield* Effect.forEach(
        names.filter(isMapFileName),
        (name) => gameMapOf(name).pipe(Effect.orElseSucceed(() => Option.none<GameMap>()))
      )
      return maps.flatMap(Option.toArray).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    }).pipe(Effect.withSpan("MapFiles.listGameMaps"))

    const pickGameMap = Effect.fn("MapFiles.pickGameMap")(function*(fileName: string) {
      if (!isMapFileName(fileName)) return yield* projectError("fileName", fileName)()
      const folder = yield* gameMapsFolder
      if (Option.isNone(folder)) return yield* projectError("notFound", fileName)()
      return yield* pick(path.join(folder.value, fileName))
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
        // the map it replaced takes its sidecar along; an import's own structure comes from its file
        yield* retireSidecar(project, fileName)

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

    /** The maps' backups in `folder`, which also keeps the sidecars' and the prefabs'. */
    const mapBackupsIn = (folder: string, place: BackupRef["place"]) =>
      backupStore.list(folder).pipe(
        Effect.map((all) => all.filter((backup) => isMapFileName(backup.fileName)).map(backupOf(place)))
      )

    const backups = Effect.gen(function*() {
      const project = Option.getOrNull(yield* projects.current)
      const inProject = project === null ? [] : yield* mapBackupsIn(backupsFolderIn(path, project), "project")
      const exported = yield* mapBackupsIn(exportBackups, "export")
      return [...inProject, ...exported].sort((a, b) => b.at.localeCompare(a.at))
    }).pipe(Effect.withSpan("MapFiles.backups"))

    /**
     * The sidecar for a map's backup. A Save or Rename keeps the map first and its sidecar right after, so in the
     * project's backups it is the oldest one kept since. The game's copies have none of their own, and neither has a
     * version from before the map had one: they get the map's sidecar as it is now. It need not be an exact fit, since
     * the page re-matches a sidecar whose `mapHash` isn't the backup's.
     */
    const sidecarBackupOf = Effect.fnUntraced(function*(project: string, place: BackupRef["place"], backup: Backup) {
      const dir = backupsFolderIn(path, project)
      const sidecarName = sidecarFileNameOf(backup.fileName)
      const kept = place === "project"
        ? (yield* backupStore.list(dir)).findLast((other) =>
          other.fileName === sidecarName && other.millis >= backup.millis
        )
        : undefined
      return kept === undefined
        ? yield* sidecarOf(project, backup.fileName)
        : yield* readSidecarAt(path.join(dir, kept.id))
    })

    const readBackup = Effect.fn("MapFiles.readBackup")(function*({ place, id }: BackupRef) {
      const project = yield* projects.inUse
      const file = path.join(place === "project" ? backupsFolderIn(path, project) : exportBackups, id)
      const backup = parseBackupId(id)
      if (Option.isNone(backup) || !isMapFileName(backup.value.fileName)) {
        return yield* projectError("notFound", file)()
      }
      const bytes = yield* readBytes(file)
      return {
        ...backupOf(place)(backup.value),
        text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes),
        hash: sha256(bytes),
        sidecar: yield* sidecarBackupOf(project, place, backup.value)
      } satisfies MapBackupFile
    })

    return MapFiles.of({
      list,
      read,
      create,
      save,
      rename,
      writeSidecar,
      readThumbnail,
      writeThumbnail,
      sidecarOf,
      pick,
      listGameMaps,
      pickGameMap,
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
