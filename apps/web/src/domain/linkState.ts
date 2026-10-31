/**
 * How a project map stands against its export in the game's maps folder (docs/PROJECTS.md § Sync), shown in the status
 * bar and on the Start tab.
 */

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
  readonly link: { readonly export: LinkedFile | null } | null
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

export interface LinkCheck {
  /** The map is open with edits that aren't saved yet, so they aren't in the export either. */
  readonly unsaved?: boolean
  /** The hash of the export as it is in the game's maps folder now; undefined when nobody has looked (sync, #141). */
  readonly gameHash?: string
}

/** The state of `map`. A change in the game outranks the published flag, which outranks the project side. */
export const linkStateOf = (map: LinkedMap, check: LinkCheck = {}): LinkState => {
  const exported = map.link?.export ?? null
  if (exported === null) return "notExported"
  const edited = check.unsaved === true || map.hash !== exported.hash
  if (check.gameHash !== undefined && check.gameHash !== exported.hash) return edited ? "bothChanged" : "changedInGame"
  if (map.publishedFileId > 0) return "publishedDraft"
  return edited ? "editedSinceExport" : "inSync"
}
