/** Backups and Recover (docs/DESKTOP.md § Backups): the versions main kept of the map files it wrote over. */
import { Effect } from "effect"
import { mapLabelOf } from "../../domain/factory"
import { MapCodec } from "../../services/MapCodec"
import { type MapBackup, Platform } from "../../services/Platform"
import { useEditor } from "../store"
import { run } from "./run"
import { fileOf, refreshProject, showMap } from "./shared"
import { unlessCancelledFor } from "./unsaved"

/** The versions main kept of the files it wrote over, newest first, for the Recover dialog (desktop). */
export const listBackups = () =>
  run(Effect.gen(function*() {
    return yield* (yield* Platform).listBackups
  }))

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
 * Recover: opens a backup as unsaved edits of the project map it is a version of, so Save writes it over that map
 * (whose file is backed up first). A map no longer in the project opens as a new one, named on Save. It shows in the
 * map's tab when one has it open (`open`; `recoverBackup` asks about that tab's unsaved edits first), else a new tab.
 */
export const recoverBackupEffect = Effect.fn("recoverBackupEffect")(function*(backup: MapBackup, open = false) {
  const file = yield* (yield* Platform).readBackup(backup)
  const map = yield* MapCodec.use((codec) => codec.decode(file.text))
  yield* refreshProject
  const inProject = useEditor.getState().projectMaps.find((m) => m.fileName === backup.fileName)
  yield* showMap(map, inProject === undefined ? null : fileOf(inProject), {
    dirty: true,
    into: open ? "active" : "newTab"
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
