/**
 * The naming rules main and the page both apply: a map's file name, the map and creator names it is made of, a project
 * folder's name, and which maps the plugin manager races. Pure functions, so the renderer checks a name as it is typed
 * and main refuses the same names when they arrive (`MapFileName` applies `isMapFileName` to every IPC payload).
 */

/** The game's `systemLevelName` for maps made in its editor, and the prefix of their file names. */
export const SYSTEM_LEVEL_NAME = "Map_LevelEditorMain"

/** What may be imported at all; only `.balledit` files live in a project or the game's maps folder. */
export const MAP_EXTENSIONS = [".balledit", ".ballmap", ".json"] as const

/** A file name for a project's `maps/` or the game's maps folder: a `.balledit` name that can't leave the folder or upset Windows. */
export const isMapFileName = (name: string): boolean =>
  name.toLowerCase().endsWith(".balledit") && name.length > ".balledit".length &&
  // oxlint-disable-next-line eslint/no-control-regex -- control characters are exactly what is refused here
  !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !name.startsWith(".") && !name.endsWith(" ")

/**
 * Map and creator names: letters, digits and spaces only. The game joins them with `_` into `userLevelName` and the
 * file name, so `_` (and anything Windows rejects in a file name) is out.
 */
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ]*$/u
export const isValidName = (name: string): boolean => NAME_PATTERN.test(name) && name.trim() === name
export const NAME_RULE = "letters, digits and spaces only"

export const userLevelNameOf = (displayName: string, creatorName: string): string => `${displayName}_${creatorName}`

/** The file a map is saved as, in a project and in the game's maps folder: `Map_LevelEditorMain&<name>_<creator>.balledit`. */
export const mapFileNameOf = (displayName: string, creatorName: string): string =>
  `${SYSTEM_LEVEL_NAME}&${userLevelNameOf(displayName, creatorName)}.balledit`

/**
 * A project folder's name, as New project and the first Save accept it: letters, digits, spaces, `-` and `_`, not
 * starting with a dot or a space, at most 64 characters, so every OS accepts it.
 */
export const isProjectName = (name: string): boolean => /^[\p{L}\p{N}_-][\p{L}\p{N} _-]{0,63}$/u.test(name)

/** Whether a map was never published (`levelPublishedFileId` -1): the plugin manager races no other kind. */
export const isNeverPublished = (publishedFileId: number): boolean => publishedFileId < 0
