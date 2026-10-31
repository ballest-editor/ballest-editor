import { Schema } from "effect"

/** Runtime versions of the desktop app, for bug reports and the about dialog. */
export const DesktopVersions = Schema.Struct({
  electron: Schema.String,
  chrome: Schema.String,
  node: Schema.String
})
export type DesktopVersions = typeof DesktopVersions.Type

/** `ping`'s payload: anything the renderer wants echoed back, to check the IPC round trip. */
export const PingPayload = Schema.Struct({
  message: Schema.String.check(Schema.isMaxLength(1024))
})
export type PingPayload = typeof PingPayload.Type

export const PingResult = Schema.Struct({
  message: Schema.String
})
export type PingResult = typeof PingResult.Type

/** An absolute path on the user's machine. Only ever one main has handed out (a dialog's, or a recent file's). */
export const FilePath = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4096))

/** A map file's text: the game's JSON, exactly as written to disk. The game's own largest maps are a few MB. */
export const MapText = Schema.String.check(Schema.isMaxLength(64 * 1024 * 1024))

/** A map file on disk: where it is and its name (the path's last segment). */
export const MapFileRef = Schema.Struct({
  path: FilePath,
  name: Schema.String
})
export type MapFileRef = typeof MapFileRef.Type

/** A map file that was read, with its text. */
export const OpenedMapFile = Schema.Struct({
  path: FilePath,
  name: Schema.String,
  text: MapText
})
export type OpenedMapFile = typeof OpenedMapFile.Type

/** `openMap`'s result: null when the user cancelled the dialog. */
export const OpenMapResult = Schema.NullOr(OpenedMapFile)

/** `saveMap`'s payload: the file to write and where the dialog starts. */
export const SaveMapPayload = Schema.Struct({
  /** The file name the dialog suggests (the game's `Map_LevelEditorMain&<name>_<creator>.balledit`). */
  name: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(255)),
  text: MapText,
  /** The open map's file, if any: the dialog starts in its folder. */
  near: Schema.optionalKey(FilePath)
})
export type SaveMapPayload = typeof SaveMapPayload.Type

/** `saveMap`'s result: null when the user cancelled the dialog. */
export const SaveMapResult = Schema.NullOr(MapFileRef)

export const ReadMapPayload = Schema.Struct({ path: FilePath })
export type ReadMapPayload = typeof ReadMapPayload.Type

export const WriteMapPayload = Schema.Struct({ path: FilePath, text: MapText })
export type WriteMapPayload = typeof WriteMapPayload.Type

/** The files recently opened or saved, most recent first. */
export const RecentMapFiles = Schema.Array(MapFileRef)
export type RecentMapFiles = typeof RecentMapFiles.Type

export const WindowThemePayload = Schema.Struct({ dark: Schema.Boolean })
export type WindowThemePayload = typeof WindowThemePayload.Type

export const OpenExternalPayload = Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(8192)) })
export type OpenExternalPayload = typeof OpenExternalPayload.Type

/**
 * Where the in-app updater is (docs/DESKTOP.md § Packaging and release). `idle` until a check finds a newer release
 * (`available`), then `downloading` once the user asks for it and `ready` once it is on disk; restarting installs it.
 * `error` is a failed check, retried by the next one. `disabled` never changes: dev, unpackaged, turned off with
 * `BALLEST_DISABLE_AUTO_UPDATE`, or Linux but not the AppImage.
 */
export const UpdateStatus = Schema.Literals([
  "disabled",
  "idle",
  "checking",
  "available",
  "downloading",
  "ready",
  "error"
])
export type UpdateStatus = typeof UpdateStatus.Type

export const UpdateState = Schema.Struct({
  status: UpdateStatus,
  /** The running app's version. */
  currentVersion: Schema.String,
  /** The newer release on offer, from `available` on. */
  availableVersion: Schema.NullOr(Schema.String),
  /** That release's notes (its GitHub release body) as plain text; null when it has none. */
  releaseNotes: Schema.NullOr(Schema.String),
  /** 0 to 100 while `downloading`. */
  downloadPercent: Schema.NullOr(Schema.Finite),
  /**
   * Why updates are `disabled`, why the check failed (`error`), or why the last download (`available`) or install
   * (`ready`) failed; null otherwise.
   */
  message: Schema.NullOr(Schema.String)
})
export type UpdateState = typeof UpdateState.Type

/**
 * What the desktop preload exposes to the renderer as `window.ballest`. The renderer only sees this interface, so
 * everything crossing it is plain data (structured-clone safe). Main decodes every payload and encodes every result
 * with the schemas above; a payload that fails to decode rejects the returned promise.
 *
 * Main reads and writes only the files the user picked in one of its dialogs (or picked before: the recent files),
 * and only `.balledit`, `.ballmap` and `.json` ones. Reading or saving a file puts it first in the recent files.
 */
export interface DesktopBridge {
  readonly versions: DesktopVersions
  /** Echoes `message` back from the main process. */
  readonly ping: (message: string) => Promise<PingResult>
  /** The native open dialog, then the chosen file's text; null when cancelled. */
  readonly openMap: () => Promise<OpenedMapFile | null>
  /** The native save dialog, then writes `text` to the chosen file; null when cancelled. */
  readonly saveMap: (payload: SaveMapPayload) => Promise<MapFileRef | null>
  /** Reads a file the user picked before (a recent file). */
  readonly readMap: (path: string) => Promise<OpenedMapFile>
  /** Overwrites a file the user picked before (Save). The text is written as is: same bytes, no BOM. */
  readonly writeMap: (path: string, text: string) => Promise<MapFileRef>
  readonly recentMaps: () => Promise<RecentMapFiles>
  /** The page's resolved theme: the window controls drawn over its top bar, and the window background, follow it. */
  readonly setWindowTheme: (dark: boolean) => Promise<void>
  /** Opens an http(s) URL in the default browser; false when it is refused or fails to open. */
  readonly openExternal: (url: string) => Promise<boolean>
  /** The updater's state now. */
  readonly getUpdateState: () => Promise<UpdateState>
  /** Starts downloading the release on offer (`available`); progress and the outcome arrive through `onUpdateState`. */
  readonly downloadUpdate: () => Promise<void>
  /** Quits, installs the downloaded release (`ready`) and starts it. Unsaved edits are lost. */
  readonly installUpdate: () => Promise<void>
  /** Calls `listener` with every later state, until the returned function is called. */
  readonly onUpdateState: (listener: (state: UpdateState) => void) => () => void
}
