/**
 * A recovery snapshot (docs/DESKTOP.md § Recovery): a tab's unsaved document, as much of it as opening it again needs.
 * It keeps the document as the tab holds it, not as Save would write it, so nothing it can't yet save is lost: a prefab
 * under the game's two items, say. The undo history isn't kept.
 */
import { PrefabTier } from "@ballest/contracts"
import { Schema } from "effect"
import { Item, MapFile } from "./MapFile"
import { MapSidecar } from "./MapSidecar"
import { PrefabFile, PrefabItem } from "./PrefabFile"

/** What a snapshot's sidecar says it was written for: it travels with its map, so any hash would do. */
export const RECOVERY_MAP_HASH = "0".repeat(64)

/** A definition's tab: its `PrefabDocument`, with what each item was in the file as `sources`' entries. */
const RecoveredPrefab = Schema.Struct({
  tier: PrefabTier,
  /** Not always a file's: a new prefab goes by "Untitled prefab" until its first Save. */
  name: Schema.String,
  /** Empty for a new prefab, which has no file. */
  hash: Schema.String,
  file: PrefabFile,
  sources: Schema.Array(Schema.Struct({ key: Schema.String, item: Item, prefab: PrefabItem }))
})

export const RecoverySnapshot = Schema.Struct({
  formatVersion: Schema.Literal(1),
  /** When the tab was last edited. */
  editedAt: Schema.String,
  /** The project's folder; null in Untitled Project, whose snapshots any project can take in. */
  project: Schema.NullOr(Schema.String),
  /** What the tab went by. */
  label: Schema.String,
  /** The file the tab had open; null for one with no file yet. */
  file: Schema.NullOr(Schema.Struct({ name: Schema.String, path: Schema.NullOr(Schema.String) })),
  /** The tab was a new document, so its first Save names it. */
  fresh: Schema.Boolean,
  /** A restored backup that hasn't been saved (`isBackupTab`). */
  backup: Schema.Boolean,
  map: MapFile,
  sidecar: MapSidecar,
  /** Null for a map's tab. */
  prefab: Schema.NullOr(RecoveredPrefab)
})
export type RecoverySnapshot = typeof RecoverySnapshot.Type

/** A snapshot another session left, by the key main keeps it under. */
export interface RecoveredTab {
  readonly key: string
  readonly snapshot: RecoverySnapshot
}
