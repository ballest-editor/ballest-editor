import {
  type ExportChecks,
  type ExportMapPayload,
  type ExportMapResult,
  fileTextProblems,
  isMapFileName,
  type MapLink,
  type ProjectMapFile
} from "@ballest/contracts"
import { Context, DateTime, Effect, FileSystem, Option, Path, Schema, Semaphore } from "effect"
import { ElectronWindow } from "../electron/ElectronWindow"
import { type GamePathError, GamePaths } from "../game/GamePaths"
import { GameProcess } from "../game/GameProcess"
import { reportGameWriteProgress } from "../game/gameWriteProgress"
import { type BackupError, Backups } from "./Backups"
import { isSamePath, sha256 } from "./files"
import { MapFiles, PublishedId } from "./MapFiles"
import { emptyLink, type MapLinkError, MapLinks } from "./MapLinks"
import { backupsFolderIn, type ProjectError, projectError, Projects } from "./Projects"
import { type ExportReport, seeExport } from "./sync"

/** A project file the game would discard, so nothing was exported. `message` says why. */
export class MapRefusedError extends Schema.TaggedError<MapRefusedError>()("MapRefusedError", {
  message: Schema.String
}) {}

/** The game's maps folder doesn't hold the bytes Export just wrote there. `message` says so. */
export class ExportUnverifiedError extends Schema.TaggedError<ExportUnverifiedError>()("ExportUnverifiedError", {
  message: Schema.String
}) {}

/**
 * Export to game and sync (docs/PROJECTS.md § Sync): copies a project map into the game's maps folder, keeping the
 * game's old copy in `<userData>/backups/` (`exportBackups`), records each export in the map's link, and looks at the
 * exports again to tell what the game changed since. Main writes into the game's maps folder only here.
 */
export class MapExports extends Context.Service<MapExports, {
  /**
   * Copies a map byte for byte into the game's maps folder and records the export in its link. Refused
   * (`MapRefusedError`) past the game's character limit, measured on those bytes: the page's checks see the map it
   * decoded, which isn't the file's text, and may be older than the file. The copy is read back, and one that isn't
   * those bytes is `ExportUnverifiedError`; one that can't be read just now says nothing about the write and passes.
   */
  readonly exportMap: (
    payload: ExportMapPayload
  ) => Effect.Effect<
    ExportMapResult,
    MapRefusedError | ExportUnverifiedError | ProjectError | MapLinkError | BackupError | GamePathError
  >
  /**
   * Sync detection (docs/PROJECTS.md § Sync): looks at every linked map's export in the game's maps folder, keeps what
   * it saw in the link, and reports what changed since the last look. One check at a time, so a change seen by one is
   * never reported again by another running beside it.
   */
  readonly checkExports: Effect.Effect<ExportChecks, MapLinkError>
  /**
   * Replaces a project map with its export (the project's file goes to backups) and records the export as in sync.
   * `text` is the export with what the game drops put back: it goes over the game's copy too (which goes to backups).
   */
  readonly reimportMap: (
    fileName: string,
    text?: string
  ) => Effect.Effect<ProjectMapFile, ProjectError | MapLinkError | BackupError>
  /** The map's export as it is now, with the project's sidecar, for comparing it with the project's version. */
  readonly readExport: (fileName: string) => Effect.Effect<ProjectMapFile, ProjectError>
  /** The game loaded the last export, so it doesn't hold an older copy (`MapLink.exportedWhileRunning`). */
  readonly markExportLoaded: (fileName: string) => Effect.Effect<void, ProjectError | MapLinkError>
}>()("ballest/desktop/project/MapExports") {
  /** `platform` decides how paths compare (Windows: case-insensitively); `exportBackups` keeps what Export wrote over. */
  static readonly make = Effect.fn("MapExports.make")(function*(platform: NodeJS.Platform, exportBackups: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const projects = yield* Projects
    const files = yield* MapFiles
    const links = yield* MapLinks
    const game = yield* GamePaths
    const backupStore = yield* Backups
    const windows = yield* ElectronWindow
    const gameProcess = yield* GameProcess
    // A check looks at a game file and then at its link, and an Export writes one and then the other: run together,
    // the check would take the export for the game's doing.
    const gameFileLock = yield* Semaphore.make(1)

    const same = (a: string, b: string) => isSamePath(path, a, b, platform)

    /** The hash of a file in the game's maps folder: null when it is gone, none when it can't be read just now. */
    const gameHashOf = (file: string): Effect.Effect<Option.Option<string | null>> =>
      files.contentsOf(file).pipe(
        Effect.map((read) => Option.some(read.hash)),
        Effect.catch((error) =>
          error._tag === "PlatformError" && error.reason._tag === "NotFound"
            ? Effect.succeedSome(null)
            : Effect.logWarning(`Couldn't read ${file}`, error).pipe(Effect.as(Option.none()))
        )
      )

    /**
     * The file a link's export is, when it is `fileName` in the game's maps folder `gameMaps`. An export elsewhere (the
     * maps folder moved since) isn't looked at.
     */
    const exportIn = (gameMaps: string, fileName: string, link: MapLink | undefined): Option.Option<string> => {
      const file = path.join(gameMaps, fileName)
      const exported = link?.export ?? null
      return exported !== null && same(exported.path, file) ? Option.some(file) : Option.none()
    }

    /** The game's maps folder, when it is there: an unmounted drive or an uninstalled game drops no links. */
    const presentGameMaps = Effect.gen(function*() {
      const folder = (yield* game.get).mapsFolder.path
      if (folder === null) return Option.none<string>()
      return (yield* fs.exists(folder).pipe(Effect.orElseSucceed(() => false))) ? Option.some(folder) : Option.none()
    })

    /**
     * Whether Export would write over a version of `file` the game made since the last export (one that isn't the
     * bytes about to be written either, which lose nothing). The version is seen, so the next check doesn't report it.
     */
    const changedSinceExport = Effect.fnUntraced(
      function*(project: string, file: string, fileName: string, writing: string) {
        const exported = (yield* links.all(project))[fileName]?.export ?? null
        if (exported === null || !same(exported.path, file)) return false
        const now = Option.getOrNull(yield* gameHashOf(file))
        if (now === null || now === exported.hash || now === writing) return false
        yield* links.modify(project, fileName, (link) => link === null ? null : seeExport(link, now).link)
        return true
      }
    )

    const exportMap = Effect.fn("MapExports.exportMap")(function*(
      { fileName, replacePublished, overwriteChanged }: ExportMapPayload
    ) {
      const project = yield* projects.inUse
      const source = yield* files.fileOf(project, fileName)
      const bytes = yield* fs.readFile(source).pipe(
        Effect.mapError((cause) => projectError(cause.reason._tag === "NotFound" ? "notFound" : "read", source)(cause))
      )
      const problems = fileTextProblems(new TextDecoder().decode(bytes))
      if (problems.length > 0) return yield* new MapRefusedError({ message: problems.join(" ") })
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

      return yield* Effect.gen(function*() {
        if (!overwriteChanged) {
          const changed = yield* changedSinceExport(project, file, fileName, sha256(bytes))
          if (changed) return { _tag: "ChangedInGame", file: { path: file, name: fileName } } as const
        }

        const written = yield* backupStore.overwrite(exportBackups, file, bytes)
        const hash = sha256(bytes)
        yield* reportGameWriteProgress(windows, { fileName, stage: "verify" })
        const readBack = yield* fs.readFile(file).pipe(Effect.map(sha256), Effect.option)
        if (Option.isSome(readBack) && readBack.value !== hash) {
          return yield* new ExportUnverifiedError({ message: `The game's copy of ${fileName} isn't what was written.` })
        }
        const exported = { path: file, hash, at: DateTime.formatIso(yield* DateTime.now) }
        const underTheGame = written && (yield* gameProcess.isRunning)
        yield* links.modify(project, fileName, (previous) => ({
          ...(previous ?? emptyLink),
          export: exported,
          lastSeenHash: exported.hash,
          // the same bytes again are no newer than what the game had
          exportedWhileRunning: underTheGame || previous?.exportedWhileRunning === true
        }))
        return { _tag: "Exported" } as const
      }).pipe(gameFileLock.withPermits(1))
    })

    const checkExports = Effect.gen(function*() {
      const checks = { changed: Array<string>(), missing: Array<string>() }
      // nothing linked without a project
      const project = Option.getOrNull(yield* projects.current)
      if (project === null) return checks
      const gameMaps = yield* presentGameMaps
      if (Option.isNone(gameMaps)) return checks
      for (const [fileName, link] of Object.entries(yield* links.all(project))) {
        // a key no map could have (`link.json` edited by hand) isn't looked at: `MapFileName` couldn't report it
        if (!isMapFileName(fileName)) continue
        const file = exportIn(gameMaps.value, fileName, link)
        if (Option.isNone(file)) continue
        const hash = yield* gameHashOf(file.value)
        if (Option.isNone(hash)) continue
        // seen against the link as it is when written, should an Export have changed it since
        const seen: { report: ExportReport | null } = { report: null }
        yield* links.modify(project, fileName, (latest) => {
          if (latest === null) return null
          const next = seeExport(latest, hash.value)
          seen.report = next.report
          return next.link
        })
        if (seen.report !== null) checks[seen.report].push(fileName)
      }
      return checks satisfies ExportChecks
    }).pipe(gameFileLock.withPermits(1), Effect.withSpan("MapExports.checkExports"))

    /** The file `fileName`'s link says is its export in the game's maps folder; refused for a map without one. */
    const exportOf = Effect.fnUntraced(function*(project: string, fileName: string) {
      const gameMaps = Option.getOrNull(yield* presentGameMaps)
      const source = gameMaps === null
        ? Option.none<string>()
        : exportIn(gameMaps, fileName, (yield* links.all(project))[fileName])
      if (Option.isNone(source)) return yield* projectError("notExported", fileName)()
      return source.value
    })

    /** `bytes` as a project map's file: its text, and the project's sidecar for the page to match against them. */
    const fileWith = Effect.fnUntraced(function*(
      project: string,
      fileName: string,
      link: MapLink | null | undefined,
      bytes: Uint8Array
    ) {
      return {
        ...(yield* files.info(project, fileName, link)),
        // the game's bytes as they are: a BOM is kept, like everything else
        text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes),
        // left as it was: the page re-matches it against these bytes
        sidecar: yield* files.sidecarOf(project, fileName)
      } satisfies ProjectMapFile
    })

    const reimportMap = Effect.fn("MapExports.reimportMap")(function*(fileName: string, text?: string) {
      const project = yield* projects.inUse
      const file = yield* files.fileOf(project, fileName)
      return yield* Effect.gen(function*() {
        const source = yield* exportOf(project, fileName)
        const bytes = text === undefined ? yield* files.readBytes(source) : new TextEncoder().encode(text)
        yield* backupStore.overwrite(backupsFolderIn(path, project), file, bytes)
        if (text !== undefined) yield* backupStore.overwrite(exportBackups, source, bytes)
        const seen = { path: source, hash: sha256(bytes), at: DateTime.formatIso(yield* DateTime.now) }
        const link = yield* links.modify(project, fileName, (previous) => ({
          ...(previous ?? emptyLink),
          export: seen,
          lastSeenHash: seen.hash,
          exportedWhileRunning: false
        }))
        return yield* fileWith(project, fileName, link, bytes)
      }).pipe(gameFileLock.withPermits(1))
    })

    const readExport = Effect.fn("MapExports.readExport")(function*(fileName: string) {
      const project = yield* projects.inUse
      const bytes = yield* files.readBytes(yield* exportOf(project, fileName))
      return yield* fileWith(project, fileName, undefined, bytes)
    })

    const markExportLoaded = Effect.fn("MapExports.markExportLoaded")(function*(fileName: string) {
      const project = yield* projects.inUse
      yield* links.modify(project, fileName, (link) => link === null ? null : { ...link, exportedWhileRunning: false })
    })

    return MapExports.of({ exportMap, checkExports, reimportMap, readExport, markExportLoaded })
  })
}
