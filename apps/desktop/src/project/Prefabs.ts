import {
  isPrefabName,
  type PrefabBackup,
  type PrefabBackupRef,
  type PrefabBackups,
  type PrefabBackupSummary,
  prefabFileNameOf,
  type PrefabInfo,
  type PrefabInfos,
  prefabNameOfFile,
  type PrefabRead,
  type PrefabRef,
  prefabSummaryOf,
  type PrefabTier,
  type RenamePrefabPayload,
  type WritePrefabPayload
} from "@ballest/contracts"
import { Context, Effect, FileSystem, Option, Path } from "effect"
import { type GamePathError, GamePaths } from "../game/GamePaths"
import { prefabsFolderBeside } from "../game/locations"
import { type BackupError, Backups, parseBackupId } from "./Backups"
import { MAX_MAP_BYTES, sha256 } from "./files"
import { backupsFolderIn, type ProjectError, projectError, Projects } from "./Projects"

/** A tier's folder in a project. */
export const prefabsFolderIn = (path: Path.Path, project: string) => path.join(project, "prefabs")

type PrefabsEffect<A> = Effect.Effect<A, ProjectError | GamePathError | BackupError>

/**
 * The prefabs of each tier (docs/DESKTOP.md § Prefabs), named by name, never by path: `user` is the game's own prefabs
 * folder, the one place in the game's files this writes, and `project` is the project's `prefabs/`. The page encodes and
 * decodes them, and main moves bytes. Every write over or away from a prefab goes through `Backups`, into the project's
 * backups for its own and `<userData>/backups/` for the game's, and Recover restores from those. What a file's bytes say
 * is read again only when its time or size changes.
 */
export class Prefabs extends Context.Service<Prefabs, {
  /** A tier's prefabs by name; none while it has no folder (no project, the game never ran). */
  readonly list: (tier: PrefabTier) => Effect.Effect<PrefabInfos, ProjectError>
  readonly read: (ref: PrefabRef) => Effect.Effect<PrefabRead, ProjectError>
  /** Writes a prefab, keeping the file it replaces; without `replace`, fails when there is one. */
  readonly write: (payload: WritePrefabPayload) => PrefabsEffect<PrefabInfo>
  /** Moves a prefab to the backups; a prefab that has gone is fine. */
  readonly remove: (ref: PrefabRef) => PrefabsEffect<void>
  /** Writes `to` and moves `from` to the backups; fails when `to` exists. */
  readonly rename: (payload: RenamePrefabPayload) => PrefabsEffect<PrefabInfo>
  /** A tier's folder, for the file manager; none when it isn't there. */
  readonly folderOf: (tier: PrefabTier) => Effect.Effect<Option.Option<string>>
  /** Both tiers' backups, newest first. */
  readonly backups: Effect.Effect<PrefabBackups>
  /** What a backup `backups` listed holds; any other name is refused. */
  readonly describeBackup: (ref: PrefabBackupRef) => Effect.Effect<PrefabBackupSummary, ProjectError>
  /** Writes a backup's bytes back as its prefab, keeping the file they replace; any other name is refused. */
  readonly restoreBackup: (ref: PrefabBackupRef) => PrefabsEffect<PrefabInfo>
}>()("ballest/desktop/project/Prefabs") {
  /** `userBackups` keeps what was written over in the game's prefabs folder. */
  static readonly make = Effect.fn("Prefabs.make")(function*(userBackups: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const projects = yield* Projects
    const game = yield* GamePaths
    const backups = yield* Backups

    /** Where `tier` keeps its prefabs for reading, if it has anywhere yet. */
    const folderToRead = Effect.fnUntraced(function*(tier: PrefabTier) {
      if (tier === "project") return Option.map(yield* projects.current, (project) => prefabsFolderIn(path, project))
      const { mapsFolder } = yield* game.get
      return mapsFolder.path === null ? Option.none() : Option.some(prefabsFolderBeside(mapsFolder.path, path))
    })

    /** Where `tier` writes, made if it has to be, and its backups. */
    const folderToWrite = Effect.fnUntraced(function*(tier: PrefabTier) {
      if (tier === "project") {
        const project = yield* projects.ensure
        return { folder: prefabsFolderIn(path, project), kept: backupsFolderIn(path, project) }
      }
      return { folder: prefabsFolderBeside(yield* game.mapsFolderForWrite, path), kept: userBackups }
    })

    const fileIn = Effect.fnUntraced(function*(folder: string, name: string) {
      if (!isPrefabName(name)) return yield* projectError("prefabName", name)()
      return path.join(folder, prefabFileNameOf(name))
    })

    const stamps = new Map<
      string,
      { readonly stamp: string; readonly hash: string } & ReturnType<typeof prefabSummaryOf>
    >()

    const infoAt = Effect.fnUntraced(function*(tier: PrefabTier, name: string, file: string) {
      const stat = yield* fs.stat(file).pipe(
        Effect.mapError((cause) => projectError(cause.reason._tag === "NotFound" ? "notFound" : "read", file)(cause))
      )
      if (Number(stat.size) > MAX_MAP_BYTES) return yield* projectError("tooLarge", file)()
      const modifiedAt = Option.getOrElse(stat.mtime, () => new Date(0)).toISOString()
      const stamp = `${modifiedAt} ${stat.size}`
      const known = stamps.get(file)
      const read = known?.stamp === stamp ? known : {
        stamp,
        ...yield* fs.readFile(file).pipe(
          Effect.map((bytes) => ({ hash: sha256(bytes), ...prefabSummaryOf(new TextDecoder().decode(bytes)) })),
          Effect.mapError(projectError("read", file))
        )
      }
      stamps.set(file, read)
      const { firstClass, hash, itemCount } = read
      return { tier, name, path: file, modifiedAt, hash, itemCount, firstClass } satisfies PrefabInfo
    })

    const list = Effect.fn("Prefabs.list")(function*(tier: PrefabTier) {
      const folder = yield* folderToRead(tier)
      if (Option.isNone(folder)) return []
      const dir = folder.value
      if (!(yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false)))) return []
      const files = yield* fs.readDirectory(dir).pipe(Effect.mapError(projectError("read", dir)))
      const infos = yield* Effect.forEach(files, (file) => {
        const name = prefabNameOfFile(file)
        return name === undefined ? Effect.succeedNone : infoAt(tier, name, path.join(dir, file)).pipe(Effect.option)
      })
      return infos.flatMap(Option.toArray).sort((a, b) => a.name.localeCompare(b.name))
    })

    const read = Effect.fn("Prefabs.read")(function*({ name, tier }: PrefabRef) {
      const folder = yield* folderToRead(tier)
      if (Option.isNone(folder)) return yield* projectError("notFound", name)()
      const file = yield* fileIn(folder.value, name)
      const info = yield* infoAt(tier, name, file)
      const text = yield* fs.readFileString(file).pipe(Effect.mapError(projectError("read", file)))
      return { ...info, text } satisfies PrefabRead
    })

    const exists = (file: string) => fs.exists(file).pipe(Effect.mapError(projectError("read", file)))

    const write = Effect.fn("Prefabs.write")(function*({ name, replace, text, tier }: WritePrefabPayload) {
      const { folder, kept } = yield* folderToWrite(tier)
      const file = yield* fileIn(folder, name)
      if (!replace && (yield* exists(file))) return yield* projectError("prefabExists", name)()
      yield* fs.makeDirectory(folder, { recursive: true }).pipe(Effect.mapError(projectError("write", folder)))
      yield* backups.overwrite(kept, file, text)
      return yield* infoAt(tier, name, file)
    })

    const remove = Effect.fn("Prefabs.remove")(function*({ name, tier }: PrefabRef) {
      const { folder, kept } = yield* folderToWrite(tier)
      yield* backups.retire(kept, yield* fileIn(folder, name))
    })

    const rename = Effect.fn("Prefabs.rename")(function*({ from, tier, to }: RenamePrefabPayload) {
      const { text } = yield* read({ name: from, tier })
      const saved = yield* write({ name: to, replace: false, text, tier })
      yield* remove({ name: from, tier })
      return saved
    })

    const folderOf = (tier: PrefabTier) =>
      folderToRead(tier).pipe(
        Effect.flatMap((folder) =>
          Option.match(folder, {
            onNone: () => Effect.succeedNone,
            onSome: (dir) => fs.exists(dir).pipe(Effect.map((found) => found ? Option.some(dir) : Option.none()))
          })
        ),
        Effect.orElseSucceed(() => Option.none<string>())
      )

    /** Where `tier`'s backups are for reading: none for the project's while there is no project. */
    const keptToRead = Effect.fnUntraced(function*(tier: PrefabTier) {
      return tier === "user"
        ? Option.some(userBackups)
        : Option.map(yield* projects.current, (project) => backupsFolderIn(path, project))
    })

    const backupsIn = Effect.fnUntraced(function*(tier: PrefabTier) {
      const kept = yield* keptToRead(tier)
      if (Option.isNone(kept)) return []
      return (yield* backups.list(kept.value)).flatMap(({ at, fileName, id }): ReadonlyArray<PrefabBackup> => {
        const name = prefabNameOfFile(fileName)
        return name === undefined ? [] : [{ tier, id, name, at }]
      })
    })

    const listBackups = Effect.gen(function*() {
      const [user, project] = [yield* backupsIn("user"), yield* backupsIn("project")]
      return [...user, ...project].sort((a, b) => b.at.localeCompare(a.at))
    }).pipe(Effect.withSpan("Prefabs.backups"))

    /** The bytes of a backup of a prefab, and which prefab. A name this didn't write could be a way out of the folder. */
    const readKept = Effect.fnUntraced(function*({ id, tier }: PrefabBackupRef) {
      const kept = yield* keptToRead(tier)
      const backup = parseBackupId(id)
      const name = Option.isSome(backup) ? prefabNameOfFile(backup.value.fileName) : undefined
      if (Option.isNone(kept) || name === undefined) return yield* projectError("notFound", id)()
      const file = path.join(kept.value, id)
      const bytes = yield* fs.readFile(file).pipe(
        Effect.mapError((cause) => projectError(cause.reason._tag === "NotFound" ? "notFound" : "read", file)(cause))
      )
      return { bytes, name }
    })

    const describeBackup = Effect.fn("Prefabs.describeBackup")(function*(ref: PrefabBackupRef) {
      const { bytes } = yield* readKept(ref)
      return prefabSummaryOf(new TextDecoder().decode(bytes))
    })

    const restoreBackup = Effect.fn("Prefabs.restoreBackup")(function*(ref: PrefabBackupRef) {
      const { bytes, name } = yield* readKept(ref)
      const { folder, kept } = yield* folderToWrite(ref.tier)
      const file = yield* fileIn(folder, name)
      yield* fs.makeDirectory(folder, { recursive: true }).pipe(Effect.mapError(projectError("write", folder)))
      yield* backups.overwrite(kept, file, bytes)
      return yield* infoAt(ref.tier, name, file)
    })

    return Prefabs.of({
      list,
      read,
      write,
      remove,
      rename,
      folderOf,
      backups: listBackups,
      describeBackup,
      restoreBackup
    })
  })
}
