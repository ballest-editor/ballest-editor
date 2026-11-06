/** Backups and Recover (docs/DESKTOP.md § Backups): the versions main kept of the map files and prefabs it wrote over. */
import { Effect } from "effect"
import { asNewMap, setLevelNames } from "../../domain/edits"
import { mapLabelOf, nextFreeName } from "../../domain/factory"
import { diffMaps, type MapDiff, type MapVersion } from "../../domain/mapDiff"
import type { Item } from "../../domain/MapFile"
import { loadStructure } from "../../domain/sidecar"
import { MapCodec } from "../../services/MapCodec"
import { type MapBackup, Platform, type PrefabBackup, type ProjectMapFile } from "../../services/Platform"
import { tabLabels, tabStateOf, tabWithFile, useEditor } from "../store"
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

/** A file's map and each item's key, saying nothing about a sidecar that doesn't fit: the preview only looks. */
const versionOfFile = Effect.fnUntraced(function*(file: Pick<ProjectMapFile, "text" | "hash" | "sidecar">) {
  const codec = yield* MapCodec
  const map = yield* codec.decode(file.text)
  const sidecar = file.sidecar === null
    ? null
    : yield* codec.decodeSidecar(file.sidecar).pipe(Effect.orElseSucceed(() => null))
  const { ids } = loadStructure(map, file.hash, sidecar)
  return { map, ids } satisfies MapVersion
})

/**
 * The map `fileName` as it is now: in its tab with any unsaved edits, else its project file. Null when the project has
 * no such map any more, or its file can't be read.
 */
const currentVersionOf = Effect.fnUntraced(function*(fileName: string) {
  const state = useEditor.getState()
  const tabId = tabWithFile(state, fileName)
  const tab = tabId === undefined ? undefined : tabStateOf(state, tabId)
  if (tab !== undefined) return tab.doc satisfies MapVersion
  return yield* (yield* Platform).readMap(fileName).pipe(
    Effect.flatMap(versionOfFile),
    Effect.orElseSucceed(() => null)
  )
})

/** What the Recover dialog shows of the backup selected in it. */
export type BackupPreview =
  | {
    readonly _tag: "Map"
    /** Names these items for as long as the backup lasts: the hash of its bytes. */
    readonly id: string
    readonly items: ReadonlyArray<Item>
    readonly bytes: number
    /** What changed in the current map since this backup; null with no current map to compare it with. */
    readonly diff: MapDiff | null
  }
  | { readonly _tag: "Unreadable" }

export const previewBackupEffect = Effect.fn("previewBackupEffect")(function*(backup: MapBackup) {
  const file = yield* (yield* Platform).readBackup(backup)
  const version = yield* versionOfFile(file)
  const current = yield* currentVersionOf(backup.fileName)
  return {
    _tag: "Map",
    id: file.hash,
    items: version.map.items,
    bytes: new TextEncoder().encode(file.text).length,
    diff: current === null ? null : diffMaps(version, current)
  } satisfies BackupPreview
}, Effect.orElseSucceed(() => ({ _tag: "Unreadable" } satisfies BackupPreview)))

export const previewBackup = (backup: MapBackup) => run(previewBackupEffect(backup))

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

/**
 * Recover as a new map: opens a backup, with the sidecar kept with it, in a new tab of its own, leaving the map it is a
 * version of alone. It has no file yet and goes by `<name> (backup)`, or the next number the open tabs leave free, until
 * Save names it.
 */
export const restoreBackupAsNewEffect = Effect.fn("restoreBackupAsNewEffect")(function*(backup: MapBackup) {
  const file = yield* (yield* Platform).readBackup(backup)
  const { loaded, map } = yield* loadMapFile(file)
  const taken = new Set(tabLabels(useEditor.getState()))
  const label = mapLabelOf(backup.fileName)
  const name = nextFreeName(`${label} (backup)`, (candidate) => taken.has(candidate))
  const named = asNewMap(setLevelNames(map, name, map.worldSettings.levelData.creatorName))
  yield* showMap(named, null, { dirty: true, into: "newTab", loaded })
  useEditor.getState().notify(
    "info",
    `Opened a previous version of ${label} (${map.items.length} items) as a new map. ${label} is as it was: Save names the new one.`
  )
})

export const restoreBackupAsNew = (backup: MapBackup) => run(restoreBackupAsNewEffect(backup))

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
