/**
 * How a project map stands against its export in the game's maps folder (docs/PROJECTS.md § Sync), and the one status
 * the status bar and the Project panel show for it.
 */
import { formatAgo, formatDateTime } from "./time"

/** The file a link record points at (`LinkedFile` in @ballest/contracts): its path, its bytes' hash, and when. */
export interface LinkedFile {
  readonly path: string
  readonly hash: string
  readonly at: string
}

/** What the state is worked out from: a project map (`ProjectMap` in @ballest/contracts). */
export interface LinkedMap {
  /** The SHA-256 of the project file's bytes. */
  readonly hash: string
  /** The project file's `levelPublishedFileId` (above 0: a published map's draft). */
  readonly publishedFileId: number
  /**
   * Its link record: the last export, and the export's hash when the editor last looked at the game's copy (sync
   * detection keeps it up to date; docs/PROJECTS.md § Sync).
   */
  readonly link: { readonly export: LinkedFile | null; readonly lastSeenHash: string | null } | null
}

/**
 * - `notExported`: never exported, or the export is gone.
 * - `inSync`: the export is the project file, byte for byte.
 * - `editedSinceExport`: the project map changed (saved, or with unsaved edits) since the export.
 * - `changedInGame`: the game's copy changed since the export (the in-game editor saved it).
 * - `bothChanged`: both of the above.
 * - `publishedDraft`: exported, and the map is a published map's draft (it has a `levelPublishedFileId`).
 */
export type LinkState =
  | "notExported"
  | "inSync"
  | "editedSinceExport"
  | "changedInGame"
  | "bothChanged"
  | "publishedDraft"

export const LINK_STATE_LABELS: Record<LinkState, string> = {
  notExported: "Not exported",
  inSync: "In sync",
  editedSinceExport: "Edited since export",
  changedInGame: "Changed in game",
  bothChanged: "Both changed",
  publishedDraft: "Published draft"
}

/**
 * What the status bar chip, its popover and a Project panel row say about a map: its link state, with the unsaved edits
 * folded in and the three changed states as one.
 */
export type SyncStatus = "unsaved" | "notExported" | "inSync" | "changedSinceExport" | "publishedDraft"

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  unsaved: "Unsaved",
  notExported: "Not exported",
  inSync: "In sync",
  changedSinceExport: "Changed since export",
  publishedDraft: "Published draft"
}

/** Which `--status-*` colours a status wears (docs/design/ui-system.md): neutral at rest, colour only when it says something. */
export type SyncTone = "neutral" | "ok" | "warn"

export const SYNC_STATUS_TONES: Record<SyncStatus, SyncTone> = {
  unsaved: "warn",
  notExported: "neutral",
  inSync: "ok",
  changedSinceExport: "warn",
  publishedDraft: "neutral"
}

const LINK_SYNC_STATUS: Record<LinkState, SyncStatus> = {
  notExported: "notExported",
  inSync: "inSync",
  editedSinceExport: "changedSinceExport",
  changedInGame: "changedSinceExport",
  bothChanged: "changedSinceExport",
  publishedDraft: "publishedDraft"
}

/** What the status bar chip can say: a map's status, or for a moment after a save, that it was saved. */
export type ChipStatus = SyncStatus | "saved"

export const CHIP_STATUS_LABELS: Record<ChipStatus, string> = { ...SYNC_STATUS_LABELS, saved: "Saved" }

export const CHIP_STATUS_TONES: Record<ChipStatus, SyncTone> = { ...SYNC_STATUS_TONES, saved: "ok" }

/** How long the chip says Saved. */
export const SAVED_CHIP_MS = 2_000

/** What the chip is looking at. */
export interface ChipView {
  /** Which load of a map into which tab: loading over a tab gives it a new saved document with no save. */
  readonly opened: string
  /** The document the tab's file holds, by identity: a new one, in the same `opened`, is a save. */
  readonly savedDoc: unknown
  readonly status: SyncStatus
}

/** The chip from one look at its map to the next: whether it is in Saved's 2 seconds. */
export interface SavedChip extends ChipView {
  readonly justSaved: boolean
}

/** The chip on first looking at `view`: it has seen no save. */
export const restingChip = (view: ChipView): SavedChip => ({ ...view, justSaved: false })

/**
 * The chip after a look at `view`. It says the status, except for Saved's 2 seconds after a save: a new saved document
 * with no edits on top starts them, and an edit, or another map, ends them, as does `SAVED_CHIP_MS` going by.
 */
export const nextSavedChip = (chip: SavedChip, view: ChipView): SavedChip => {
  const sameMap = view.opened === chip.opened
  const saved = sameMap && view.savedDoc !== chip.savedDoc
  return { ...view, justSaved: sameMap && view.status !== "unsaved" && (saved || chip.justSaved) }
}

/** What `chip` says. */
export const chipStatusOf = (chip: SavedChip): ChipStatus => chip.justSaved ? "saved" : chip.status

/** The status of a map in `state`. `unsaved` (its tab has unsaved edits) outranks every link state. */
export const syncStatusOf = (state: LinkState, unsaved: boolean): SyncStatus =>
  unsaved ? "unsaved" : LINK_SYNC_STATUS[state]

/**
 * The link state that `status` leaves out: which side changed, or what stands behind Unsaved. Null when the status says
 * the same, so a map changed in the game is still told apart under Unsaved or Changed since export.
 */
export const syncDetailOf = (state: LinkState, status: SyncStatus): string | null =>
  LINK_STATE_LABELS[state] === SYNC_STATUS_LABELS[status] ? null : LINK_STATE_LABELS[state]

export interface LinkCheck {
  /** The map is open with edits that aren't saved yet, so they aren't in the export either. */
  readonly unsaved?: boolean
}

/** Whether the game's copy of `map`, as last seen, differs from what was exported (the in-game editor saved it). */
export const changedInGame = (map: LinkedMap): boolean => {
  const exported = map.link?.export ?? null
  const seen = map.link?.lastSeenHash ?? null
  return exported !== null && seen !== null && seen !== exported.hash
}

/**
 * The state of `map`. The game's side is the export's hash when the editor last looked at it (`lastSeenHash`), so a
 * change shows from the first check that saw it. A change in the game outranks the published flag, which outranks the
 * project side.
 */
export const linkStateOf = (map: LinkedMap, check: LinkCheck = {}): LinkState => {
  const exported = map.link?.export ?? null
  if (exported === null) return "notExported"
  const edited = check.unsaved === true || map.hash !== exported.hash
  if (changedInGame(map)) return edited ? "bothChanged" : "changedInGame"
  if (map.publishedFileId > 0) return "publishedDraft"
  return edited ? "editedSinceExport" : "inSync"
}

/** `state` in a line with when `map` was last exported, for a tooltip. */
export const linkStateDetailOf = (map: LinkedMap, state: LinkState, now: number): string => {
  const exported = map.link?.export ?? null
  if (exported === null) return "Not exported yet"
  return `${LINK_STATE_LABELS[state]} · exported ${formatAgo(exported.at, now)} (${formatDateTime(exported.at)})`
}
