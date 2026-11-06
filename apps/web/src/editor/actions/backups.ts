/** Backups and Recover (docs/DESKTOP.md § Backups): the versions main kept of the map files and prefabs it wrote over. */
import { Effect } from "effect"
import { mapLabelOf } from "../../domain/factory"
import { MapCodec } from "../../services/MapCodec"
import { type MapBackup, Platform, type PrefabBackup } from "../../services/Platform"
import { useEditor } from "../store"
import { checkPrefabs } from "./prefabs"
import { run } from "./run"
import { fileOf, loadMapFile, refreshProject, showMap } from "./shared"
import { unlessCancelledFor } from "./unsaved"

/** The versions main kept of the files it wrote over, newest first, for the Recover dialog (desktop). */
export const listBackups = () => run(Effect.flatMap(Effect.service(Platform), (platform) => platform.listBackups))

/** What a backup holds, decoded the way Open would: its map's names and item count, or why it can't be opened. */
export type BackupSummary =
  | {
    readonly _tag: "Map"
    readonly displayName: string
    readonly creatorName: string
    readonly items: number
  }
  | { readonly _tag: "Unreadable"; readonly message: string }

export const describeBackupEffect = Effect.fn("describeBackupEffect")(function*(backup: MapBackup) {
  const file = yield* (yield* Platform).readBackup(backup)
  const map = yield* MapCodec.use((codec) => codec.decode(file.text))
  const { levelDisplayName, creatorName } = map.worldSettings.levelData
  return { _tag: "Map", displayName: levelDisplayName, creatorName, items: map.items.length } satisfies BackupSummary
}, Effect.catch((error) => Effect.succeed({ _tag: "Unreadable", message: error.message } satisfies BackupSummary)))

export const describeBackup = (backup: MapBackup) => run(describeBackupEffect(backup))

/**
 * Recover: opens a backup, with the sidecar kept with it, as unsaved edits of the project map it is a version of, so
 * Save writes it over that map (whose file is backed up first). A map no longer in the project opens as a new one, named
 * on Save. It shows in the map's tab when one has it open (`open`; `recoverBackup` asks about that tab's unsaved edits
 * first), else a new tab.
 */
export const recoverBackupEffect = Effect.fn("recoverBackupEffect")(function*(backup: MapBackup, open = false) {
  const file = yield* (yield* Platform).readBackup(backup)
  const { loaded, map } = yield* loadMapFile(file)
  yield* refreshProject
  const inProject = useEditor.getState().projectMaps.find((m) => m.fileName === backup.fileName)
  yield* showMap(map, inProject === undefined ? null : fileOf(inProject), {
    dirty: true,
    into: open ? "active" : "newTab",
    loaded
  })
  const label = mapLabelOf(backup.fileName)
  useEditor.getState().notify(
    "info",
    inProject === undefined
      ? `Opened a previous version of ${label} (${map.items.length} items). It is no longer in the project: Save adds it.`
      : `Opened a previous version of ${label} (${map.items.length} items), unsaved. Save writes it over the map; the current file is backed up first.`
  )
})

export const recoverBackup = (backup: MapBackup) =>
  run(unlessCancelledFor(backup.fileName, "recover", (open) => recoverBackupEffect(backup, open)))

/** The versions main kept of the prefabs of both tiers, newest first, for the Recover dialog (desktop). */
export const listPrefabBackups = () =>
  run(Effect.flatMap(Effect.service(Platform), (platform) => platform.listPrefabBackups))

/** What a prefab's backup holds; a file that has gone or can't be read holds no prefab, as one that isn't a prefab. */
export const describePrefabBackup = (backup: PrefabBackup) =>
  run(
    Effect.flatMap(Effect.service(Platform), (platform) => platform.describePrefabBackup(backup)).pipe(
      Effect.orElseSucceed(() => ({ itemCount: null, firstClass: null }))
    )
  )

/**
 * Recover for a prefab: main writes the version back, the file it replaces going to the backups, and everything that
 * follows a definition takes it up as it would any change to the file (docs/DESKTOP.md § Prefabs).
 */
export const restorePrefabBackupEffect = Effect.fn("restorePrefabBackupEffect")(function*(backup: PrefabBackup) {
  yield* (yield* Platform).restorePrefabBackup(backup)
  yield* checkPrefabs
  useEditor.getState().notify(
    "info",
    `Restored a previous version of ${backup.name}. The file it replaced, if there was one, went to the backups.`
  )
})

export const restorePrefabBackup = (backup: PrefabBackup) => run(restorePrefabBackupEffect(backup))
