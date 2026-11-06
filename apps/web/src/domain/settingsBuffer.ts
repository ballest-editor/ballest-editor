/**
 * Project settings' unsaved edits (docs/DESKTOP.md § Project settings): what the dialog holds until Save, per map entry
 * and for the project's name. A buffer holds only what differs from what is saved, so undoing an edit by hand leaves
 * nothing to save, and it never holds a whole level: a map's other fields stay whatever they are when Save writes it.
 */
import { withLevelNames } from "./edits"
import type { LevelData } from "./MapFile"

/**
 * A map's entry in the dialog: `map:<file name>` is a map in the project, `map:open` the open map while it has no file
 * yet, `map:tab:<tab id>` another tab's map while it has none.
 */
export type MapEntryId = `map:${string}`

export const OPEN_UNSAVED: MapEntryId = "map:open"
const UNSAVED_TAB = "map:tab:"
export const unsavedTabEntry = (tabId: string): MapEntryId => `${UNSAVED_TAB}${tabId}`
export const entryOf = (fileName: string): MapEntryId => `map:${fileName}`

/** What an entry edits: the active tab's map, a tab's map, or a project map, which a tab may have open. */
export type MapEntryTarget =
  | { readonly _tag: "OpenMap" }
  | { readonly _tag: "Tab"; readonly tabId: string }
  | { readonly _tag: "File"; readonly fileName: string }

export const targetOf = (entry: MapEntryId): MapEntryTarget => {
  if (entry === OPEN_UNSAVED) return { _tag: "OpenMap" }
  return entry.startsWith(UNSAVED_TAB)
    ? { _tag: "Tab", tabId: entry.slice(UNSAVED_TAB.length) }
    : { _tag: "File", fileName: entry.slice("map:".length) }
}

/** A map's Workshop page: what its difficulty and tags write. */
type Workshop = Pick<LevelData, "levelDifficulty" | "mapTags">

/** One map's unsaved edits. A name is kept as typed, so it may not be usable until the field is left. */
export interface MapDraft {
  readonly name?: string
  readonly workshop?: Workshop
  readonly exportOnSave?: boolean
}

/** What a map has saved, which a draft is compared with. */
export interface SavedMapValues {
  readonly levelData: LevelData
  readonly exportOnSave: boolean
}

export interface SettingsBuffer {
  readonly projectName?: string
  readonly maps: ReadonlyMap<MapEntryId, MapDraft>
}

export const EMPTY_BUFFER: SettingsBuffer = { maps: new Map() }

export const hasUnsaved = (buffer: SettingsBuffer): boolean => buffer.projectName !== undefined || buffer.maps.size > 0

const tagSetOf = ({ mapTags }: Workshop): ReadonlySet<string> =>
  new Set(mapTags.gameplayTags.map((t) => t.tagName.toLowerCase()))

/**
 * Whether two Workshop pages show the same: the same tags, in any order, because turning a tag off and on again moves
 * it. `levelDifficulty` doesn't count: published maps keep it at "Beginner" whatever their tag says.
 */
const sameWorkshop = (a: Workshop, b: Workshop): boolean => {
  const [tags, others] = [tagSetOf(a), tagSetOf(b)]
  return tags.size === others.size && [...tags].every((tag) => others.has(tag))
}

const changedFrom = (draft: MapDraft, saved: SavedMapValues): MapDraft => ({
  ...(draft.name !== undefined && draft.name !== saved.levelData.levelDisplayName && { name: draft.name }),
  ...(draft.workshop !== undefined && !sameWorkshop(draft.workshop, saved.levelData) && { workshop: draft.workshop }),
  ...(draft.exportOnSave !== undefined && draft.exportOnSave !== saved.exportOnSave &&
    { exportOnSave: draft.exportOnSave })
})

/** `edit` on top of the entry's draft; a field back at its saved value is dropped, and with it an empty draft. */
export const withMapEdit = (
  buffer: SettingsBuffer,
  entry: MapEntryId,
  saved: SavedMapValues,
  edit: MapDraft
): SettingsBuffer => {
  const draft = changedFrom({ ...buffer.maps.get(entry), ...edit }, saved)
  const maps = new Map(buffer.maps)
  if (Object.keys(draft).length === 0) maps.delete(entry)
  else maps.set(entry, draft)
  return { ...buffer, maps }
}

/** The project's name as typed; back at `saved` (null: Untitled Project, which has none) nothing is left to save. */
export const withProjectName = (buffer: SettingsBuffer, name: string, saved: string | null): SettingsBuffer => {
  const { projectName: _previous, ...rest } = buffer
  return name === (saved ?? "") ? rest : { ...rest, projectName: name }
}

/** The buffer without what Save wrote. */
export const withoutProjectName = (buffer: SettingsBuffer): SettingsBuffer => {
  const { projectName: _saved, ...rest } = buffer
  return rest
}

export const withoutMap = (buffer: SettingsBuffer, entry: MapEntryId): SettingsBuffer => {
  const maps = new Map(buffer.maps)
  maps.delete(entry)
  return { ...buffer, maps }
}

/** Whether a draft changes the map's file, or only the prefs kept for it. */
export const changesLevelData = (draft: MapDraft): boolean => draft.name !== undefined || draft.workshop !== undefined

/**
 * `levelData` as the draft would leave it. A map made before a creator was saved has none yet, so a rename gives it
 * `savedCreator`, as Export would.
 */
export const withMapDraft = (levelData: LevelData, draft: MapDraft | undefined, savedCreator: string): LevelData => {
  const edited = { ...levelData, ...draft?.workshop }
  return draft?.name === undefined
    ? edited
    : withLevelNames(edited, draft.name, levelData.creatorName || savedCreator)
}

/** Which of a map's two pages have unsaved edits. */
export const unsavedPagesOf = (draft: MapDraft): { readonly map: boolean; readonly workshop: boolean } => ({
  map: draft.name !== undefined || draft.exportOnSave !== undefined,
  workshop: draft.workshop !== undefined
})
