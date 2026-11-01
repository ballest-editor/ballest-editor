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

/** `pickImport`'s result: null when the user cancelled the dialog. */
export const PickImportResult = Schema.NullOr(OpenedMapFile)

/**
 * A map's file name in a project's `maps/` folder, which is also its name in the game's maps folder
 * (`Map_LevelEditorMain&<name>_<creator>.balledit`). Never a path: main joins it to the folder after checking it.
 */
export const MapFileName = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(255))

/** An instant as ISO 8601 UTC text (`2026-10-31T12:00:00.000Z`). */
export const IsoTime = Schema.String.check(Schema.isMaxLength(64))

/** The SHA-256 of a file's bytes, as lowercase hex. */
export const FileHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))

/** A file the link record points at, the hash of its bytes then, and when that was. */
export const LinkedFile = Schema.Struct({ path: FilePath, hash: FileHash, at: IsoTime })
export type LinkedFile = typeof LinkedFile.Type

/**
 * What a project map is linked to on this machine (`<project>/.ballest/link.json`, docs/PROJECTS.md): where it was
 * imported from, where and what it was last exported as, and the export's hash when the editor last looked at it. Sync
 * detection compares the game file's hash with `export.hash` and `lastSeenHash`, so one change is reported once.
 */
export const MapLink = Schema.Struct({
  /** The file it was imported from; null for a map made in the editor. */
  origin: Schema.NullOr(LinkedFile),
  /** The last export (Export to game). A map imported from the game's maps folder is linked to that file from the start. */
  export: Schema.NullOr(LinkedFile),
  /** The exported file's hash when the editor last read it; null before the first export. */
  lastSeenHash: Schema.NullOr(FileHash)
})
export type MapLink = typeof MapLink.Type

/** The folder the user works in (docs/PROJECTS.md). It is made on disk by the first New map or Import. */
export const ProjectInfo = Schema.Struct({
  path: FilePath,
  /** `ballest-project.json`'s name; the folder's name until that file exists. */
  name: Schema.String,
  /** Whether the folder is a project on disk yet (it has `ballest-project.json`). */
  exists: Schema.Boolean,
  /** `Documents/Ballest Editor/Maps`, the project used until the user picks another. */
  isDefault: Schema.Boolean
})
export type ProjectInfo = typeof ProjectInfo.Type

/** The project in use and the ones used before it, most recent first (the default is always among them). */
export const ProjectState = Schema.Struct({
  current: ProjectInfo,
  recent: Schema.Array(ProjectInfo)
})
export type ProjectState = typeof ProjectState.Type

/** `chooseProject`'s result: null when the user cancelled the dialog. */
export const ChooseProjectResult = Schema.NullOr(ProjectState)

export const ProjectPathPayload = Schema.Struct({ path: FilePath })
export type ProjectPathPayload = typeof ProjectPathPayload.Type

/**
 * A map in the project: its file in `maps/`, when that last changed, the SHA-256 of its bytes (compared with the last
 * export's to tell whether it was edited since), its `levelPublishedFileId` (-1 when it was never published, or the
 * file doesn't decode), and its link record.
 */
export const ProjectMap = Schema.Struct({
  fileName: MapFileName,
  path: FilePath,
  modifiedAt: IsoTime,
  hash: FileHash,
  publishedFileId: Schema.Finite,
  link: Schema.NullOr(MapLink)
})
export type ProjectMap = typeof ProjectMap.Type

export const ProjectMaps = Schema.Array(ProjectMap)
export type ProjectMaps = typeof ProjectMaps.Type

/** A project map that was read, with its text. */
export const ProjectMapFile = Schema.Struct({ ...ProjectMap.fields, text: MapText })
export type ProjectMapFile = typeof ProjectMapFile.Type

export const MapFileNamePayload = Schema.Struct({ fileName: MapFileName })
export type MapFileNamePayload = typeof MapFileNamePayload.Type

/** `createMap` and `saveMap`: the map's file name in the project and its text. */
export const WriteMapPayload = Schema.Struct({ fileName: MapFileName, text: MapText })
export type WriteMapPayload = typeof WriteMapPayload.Type

/** `renameMap`: the file the map was in, the one it moves to (named after its new name), and its new text. */
export const RenameMapPayload = Schema.Struct({ from: MapFileName, to: MapFileName, text: MapText })
export type RenameMapPayload = typeof RenameMapPayload.Type

/** `importMap`: a file `pickImport` returned, the project file name it goes in under, and the text written there. */
export const ImportMapPayload = Schema.Struct({
  source: FilePath,
  fileName: MapFileName,
  text: MapText,
  /** Replace a project map of the same name (it goes to backups); otherwise main reports the clash. */
  replace: Schema.Boolean
})
export type ImportMapPayload = typeof ImportMapPayload.Type

/** `importMap`'s result: `Imported`, or `Clash` when nothing was written because the project has a map of that name. */
export const ImportMapResult = Schema.TaggedUnion({
  Imported: { map: ProjectMap },
  Clash: { fileName: MapFileName }
})
export type ImportMapResult = typeof ImportMapResult.Type

/** `exportMap`: the project map to copy into the game's maps folder. */
export const ExportMapPayload = Schema.Struct({
  fileName: MapFileName,
  /** Replace a file that is a published map's draft (`levelPublishedFileId` > 0); otherwise main asks first. */
  replacePublished: Schema.Boolean
})
export type ExportMapPayload = typeof ExportMapPayload.Type

/**
 * `exportMap`'s result: `Exported` with the file written and the map's new link record, or `Published` when nothing
 * was written because the file in the maps folder is the draft of a published map and `replacePublished` wasn't set.
 */
export const ExportMapResult = Schema.TaggedUnion({
  Exported: { file: MapFileRef, link: MapLink },
  Published: { file: MapFileRef, publishedFileId: Schema.Finite }
})
export type ExportMapResult = typeof ExportMapResult.Type

/**
 * Where a backup is kept: `project`, the project's `.ballest/backups/` (the project's own copy, before Save, Rename or
 * an Import wrote over it); `export`, `<userData>/backups/` (the game's maps folder's copy, before an Export did).
 */
export const BackupPlace = Schema.Literals(["project", "export"])
export type BackupPlace = typeof BackupPlace.Type

/** A backup's name in its folder, `<time> <file name>`. Never a path: main only reads names it wrote itself. */
export const BackupId = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(512))

export const BackupRef = Schema.Struct({ place: BackupPlace, id: BackupId })
export type BackupRef = typeof BackupRef.Type

/** A previous version of a map file: which file it was, and when it was backed up. */
export const MapBackup = Schema.Struct({
  ...BackupRef.fields,
  /** The file it is a version of: a project map's file name, which is also its name in the game's maps folder. */
  fileName: MapFileName,
  at: IsoTime
})
export type MapBackup = typeof MapBackup.Type

export const MapBackups = Schema.Array(MapBackup)
export type MapBackups = typeof MapBackups.Type

/** A backup that was read, with its text (the old file's bytes). */
export const MapBackupFile = Schema.Struct({ ...MapBackup.fields, text: MapText })
export type MapBackupFile = typeof MapBackupFile.Type

export const WindowThemePayload = Schema.Struct({ dark: Schema.Boolean })
export type WindowThemePayload = typeof WindowThemePayload.Type

/** `confirmUnsaved`: the question and the line under it, worded by the page; main shows them with its three buttons. */
export const UnsavedPrompt = Schema.Struct({
  message: Schema.String.check(Schema.isMaxLength(1024)),
  detail: Schema.String.check(Schema.isMaxLength(1024))
})
export type UnsavedPrompt = typeof UnsavedPrompt.Type

/** The unsaved-changes prompt's answer: Save, Don't save, or Cancel (also Escape and closing the box). */
export const UnsavedChoice = Schema.Literals(["save", "discard", "cancel"])
export type UnsavedChoice = typeof UnsavedChoice.Type

/**
 * Main → renderer: the page held a window close or a reload (its `beforeunload` cancelled it) because the open map
 * has unsaved edits. The page asks, then closes or reloads itself.
 */
export const UnloadKind = Schema.Literals(["close", "reload"])
export type UnloadKind = typeof UnloadKind.Type

export const OpenExternalPayload = Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(8192)) })
export type OpenExternalPayload = typeof OpenExternalPayload.Type

/** The three game folders the desktop app looks up (docs/DESKTOP.md § Game paths). */
export const GamePathKind = Schema.Literals(["install", "mapsFolder", "pluginsFolder"])
export type GamePathKind = typeof GamePathKind.Type

/**
 * How a game folder was found: through Steam (`found`), chosen in settings (`overridden`), or not at all (`missing`).
 * A missing folder still has a `path` when main knows where it would be (the plugins folder of a found install).
 */
export const GamePath = Schema.Struct({
  status: Schema.Literals(["found", "overridden", "missing"]),
  path: Schema.NullOr(FilePath)
})
export type GamePath = typeof GamePath.Type

export const GamePaths = Schema.Struct({
  /** The game's install folder (`…/steamapps/common/Ballest of Them All`). */
  install: GamePath,
  /** `UserSavedMaps`, where the in-game editor lists drafts. Found once the game has run (it may not exist yet). */
  mapsFolder: GamePath,
  /** The plugin manager's `plugins` folder next to the game's exe; missing without the plugin manager. */
  pluginsFolder: GamePath
})
export type GamePaths = typeof GamePaths.Type

export const GamePathPayload = Schema.Struct({ which: GamePathKind })
export type GamePathPayload = typeof GamePathPayload.Type

/** `chooseGamePath`'s result: null when the user cancelled the dialog. */
export const ChooseGamePathResult = Schema.NullOr(GamePaths)

/**
 * What a notification's button does (docs/PROJECTS.md § Shell). Data, not a function, so a notification read back from
 * `notifications.json` after a restart still has live actions; the renderer runs each one.
 */
export const NotificationCommand = Schema.TaggedUnion({
  /** Shows the project's `maps/` folder. */
  RevealProject: {},
  /** Shows one of the game's folders. */
  RevealGamePath: { which: GamePathKind },
  /** A folder dialog for one of the game's folders (Choose folder…). */
  ChooseGamePath: { which: GamePathKind },
  /** Opens one of the project's maps. */
  OpenMap: { fileName: MapFileName },
  /** Opens a web page in the default browser (the plugin manager's install steps). */
  OpenExternal: { url: OpenExternalPayload.fields.url }
})
export type NotificationCommand = typeof NotificationCommand.Type

export const NotificationAction = Schema.Struct({
  label: Schema.String.check(Schema.isMaxLength(64)),
  command: NotificationCommand
})
export type NotificationAction = typeof NotificationAction.Type

/**
 * One notification, as the bell lists it and `notifications.json` keeps it. `kind` names what it is about (`mapSaved`,
 * `error`, ...; a later "don't show again" is per kind). A `persistent` one stays pinned to the top of the list until
 * `resolvedAt` is set, when its cause has gone away; notifying the same persistent kind again updates it in place.
 */
/** What a notification is about (`mapSaved`, `gameNotFound`, ...); "Don't show again" mutes a kind. */
export const NotificationKind = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64))

export const NotificationRecord = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64)),
  kind: NotificationKind,
  level: Schema.Literals(["info", "error"]),
  title: Schema.String.check(Schema.isMaxLength(4096)),
  body: Schema.NullOr(Schema.String.check(Schema.isMaxLength(16384))),
  at: IsoTime,
  read: Schema.Boolean,
  persistent: Schema.Boolean,
  resolvedAt: Schema.NullOr(IsoTime),
  actions: Schema.Array(NotificationAction).check(Schema.isMaxLength(4))
})
export type NotificationRecord = typeof NotificationRecord.Type

/** How many notifications the bell keeps, across restarts on desktop. */
export const NOTIFICATION_LIMIT = 100

export const NotificationRecords = Schema.Array(NotificationRecord).check(Schema.isMaxLength(NOTIFICATION_LIMIT))
export type NotificationRecords = typeof NotificationRecords.Type

/** The notification kinds the user asked not to be shown again ("Don't show again"), kept in `desktop-settings.json`. */
export const MutedNotificationKinds = Schema.Array(NotificationKind).check(Schema.isMaxLength(64))
export type MutedNotificationKinds = typeof MutedNotificationKinds.Type

export const NotificationKindPayload = Schema.Struct({ kind: NotificationKind })
export type NotificationKindPayload = typeof NotificationKindPayload.Type

/**
 * What the Game link checklist (docs/PROJECTS.md § Shell) found: whether the game's install and the plugin manager
 * are there. Kept in `desktop-settings.json` from one launch to the next, so the editor notifies only when one changes.
 */
export const GameLinkResult = Schema.Struct({
  game: Schema.Boolean,
  pluginManager: Schema.Boolean
})
export type GameLinkResult = typeof GameLinkResult.Type

/** What the last launch found (null before the first check), and the notification kinds muted. */
export const GameLinkMemory = Schema.Struct({
  last: Schema.NullOr(GameLinkResult),
  muted: MutedNotificationKinds
})
export type GameLinkMemory = typeof GameLinkMemory.Type

/**
 * Where the creator name the game writes into maps was found: the persona name of the account Steam last logged in
 * with (`steam`), or, without Steam's login file, the creator most of the maps in the game's maps folder name
 * (`mapsFolder`).
 */
export const CreatorSource = Schema.Literals(["steam", "mapsFolder"])
export type CreatorSource = typeof CreatorSource.Type

/** The creator name found on this machine. Not checked against the editor's name rule: the renderer says what's wrong. */
export const FoundCreator = Schema.Struct({
  name: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256)),
  source: CreatorSource
})
export type FoundCreator = typeof FoundCreator.Type

/** `findCreator`'s result: null when neither Steam nor the maps folder names one. */
export const FindCreatorResult = Schema.NullOr(FoundCreator)

/**
 * The `ballest-editor-link` plugin Play needs (docs/DESKTOP.md § Play), compared with the copy the app ships:
 * - `noGame`: the game's install wasn't found, so neither can the plugin manager be.
 * - `noPluginManager`: no `version.dll` next to the game's exe, or no plugins folder. Install is refused.
 * - `missing`: not in the plugins folder, or some of its files aren't.
 * - `outdated`: installed, but older than the app's copy.
 * - `current`: installed, as new as the app's copy or newer.
 */
export const PluginState = Schema.Literals(["noGame", "noPluginManager", "missing", "outdated", "current"])
export type PluginState = typeof PluginState.Type

export const PluginStatus = Schema.Struct({
  status: PluginState,
  /** The version (`info.toml`'s `[meta] version`) the app installs. */
  bundledVersion: Schema.String,
  /** The installed copy's version; null when it has no `info.toml`. */
  installedVersion: Schema.NullOr(Schema.String),
  /** `<plugins>/ballest-editor-link`, where it is or would go; null without the plugins folder's path. */
  folder: Schema.NullOr(FilePath)
})
export type PluginStatus = typeof PluginStatus.Type

/** `installPlugin`'s result: the plugin's status afterwards, and whether the game must restart to load it. */
export const InstallPluginResult = Schema.Struct({
  plugin: PluginStatus,
  /** The game was running: the plugin manager only picks up a folder copied in by hand when the game starts. */
  restartGame: Schema.Boolean
})
export type InstallPluginResult = typeof InstallPluginResult.Type

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

/**
 * A run of text in release notes with its formatting. `href` makes it a link, always http(s); the page opens it in
 * the browser, never in the window.
 */
export const ReleaseNoteSpan = Schema.Struct({
  text: Schema.String,
  strong: Schema.Boolean,
  emphasis: Schema.Boolean,
  code: Schema.Boolean,
  href: Schema.NullOr(Schema.String)
})
export type ReleaseNoteSpan = typeof ReleaseNoteSpan.Type

/** A bulleted (`ordered: false`) or numbered list; an item's own lists follow its text. */
export interface ReleaseNoteList {
  readonly _tag: "List"
  readonly ordered: boolean
  readonly items: ReadonlyArray<ReleaseNoteItem>
}
export interface ReleaseNoteItem {
  readonly spans: ReadonlyArray<ReleaseNoteSpan>
  readonly lists: ReadonlyArray<ReleaseNoteList>
}

const ReleaseNoteItem = Schema.Struct({
  spans: Schema.Array(ReleaseNoteSpan),
  lists: Schema.Array(Schema.suspend((): Schema.Codec<ReleaseNoteList> => ReleaseNoteList))
})

export const ReleaseNoteList: Schema.Codec<ReleaseNoteList> = Schema.TaggedStruct("List", {
  ordered: Schema.Boolean,
  items: Schema.Array(ReleaseNoteItem)
})

/**
 * One block of a release's notes: what main keeps of GitHub's HTML release body (docs/DESKTOP.md § Packaging and
 * release). Plain data, so nothing in the notes can run script or load anything.
 */
export const ReleaseNoteBlock = Schema.Union([
  Schema.TaggedStruct("Heading", { level: Schema.Literals([1, 2, 3, 4]), spans: Schema.Array(ReleaseNoteSpan) }),
  Schema.TaggedStruct("Paragraph", { spans: Schema.Array(ReleaseNoteSpan) }),
  ReleaseNoteList,
  Schema.TaggedStruct("Code", { text: Schema.String })
])
export type ReleaseNoteBlock = typeof ReleaseNoteBlock.Type

export const UpdateState = Schema.Struct({
  status: UpdateStatus,
  /** The running app's version. */
  currentVersion: Schema.String,
  /** The newer release on offer, from `available` on. */
  availableVersion: Schema.NullOr(Schema.String),
  /** That release's notes (its GitHub release body); null when it has none. */
  releaseNotes: Schema.NullOr(Schema.Array(ReleaseNoteBlock)),
  /** When that release was published (ISO 8601), if the feed says. */
  releaseDate: Schema.NullOr(Schema.String),
  /** That release's page on GitHub. */
  releaseUrl: Schema.NullOr(Schema.String),
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
 * Main reads and writes map files only in the current project's `maps/` folder (named by file name, never by path) and
 * in the game's maps folder (Export to game), and reads only the files the user picked in its Import dialog. The files
 * it writes over are kept in its own backups folders, which the page reaches by backup name only.
 */
export interface DesktopBridge {
  readonly versions: DesktopVersions
  /** Echoes `message` back from the main process. */
  readonly ping: (message: string) => Promise<PingResult>
  /** The project in use and the recent ones. */
  readonly projectState: () => Promise<ProjectState>
  /** A folder dialog, then uses the chosen folder as the project; null when cancelled. The game's maps folder is refused. */
  readonly chooseProject: () => Promise<ProjectState | null>
  /** Goes back to a recent project (or the default one). */
  readonly switchProject: (path: string) => Promise<ProjectState>
  /** Shows the project's `maps/` folder in the file manager; false when it doesn't exist or fails to open. */
  readonly revealProject: () => Promise<boolean>
  /** The project's maps, most recently changed first; empty when the project isn't on disk yet. */
  readonly listMaps: () => Promise<ProjectMaps>
  /** Reads a project map. */
  readonly readMap: (fileName: string) => Promise<ProjectMapFile>
  /** Writes a new map into the project, making the project first if needed; fails when one of that name exists. */
  readonly createMap: (payload: WriteMapPayload) => Promise<ProjectMap>
  /**
   * Writes over a project map (Save), or writes it if it has gone. The text is written as is: same bytes, no BOM.
   * Atomic, like every write. The file it replaces goes to the project's backups first; the same text writes nothing.
   */
  readonly saveMap: (payload: WriteMapPayload) => Promise<ProjectMap>
  /** Writes the map under its new file name and moves the old file to the project's backups; its link moves with it. */
  readonly renameMap: (payload: RenameMapPayload) => Promise<ProjectMap>
  /** The native open dialog for a map file anywhere; null when cancelled. The file may then be imported. */
  readonly pickImport: () => Promise<OpenedMapFile | null>
  /** Copies a picked file into the project and records where it came from (a map it replaces goes to backups). */
  readonly importMap: (payload: ImportMapPayload) => Promise<ImportMapResult>
  /**
   * Copies a project map byte for byte into the game's maps folder and records the export in its link. The file it
   * replaces there goes to `<userData>/backups/` first.
   */
  readonly exportMap: (payload: ExportMapPayload) => Promise<ExportMapResult>
  /** The current project's backups and the exports' (docs/PROJECTS.md § The files), newest first. */
  readonly listBackups: () => Promise<MapBackups>
  /** Reads a backup `listBackups` named. */
  readonly readBackup: (ref: BackupRef) => Promise<MapBackupFile>
  /** The page's resolved theme: the window controls drawn over its top bar, and the window background, follow it. */
  readonly setWindowTheme: (dark: boolean) => Promise<void>
  /** The native Save / Don't save / Cancel box, modal to the window. */
  readonly confirmUnsaved: (prompt: UnsavedPrompt) => Promise<UnsavedChoice>
  /** Calls `listener` each time the page held a close or a reload with unsaved edits, until the returned function is called. */
  readonly onUnloadRequest: (listener: (kind: UnloadKind) => void) => () => void
  /** Opens an http(s) URL in the default browser; false when it is refused or fails to open. */
  readonly openExternal: (url: string) => Promise<boolean>
  /** Where the game, its maps folder and the plugins folder are, and how each was found. */
  readonly gamePaths: () => Promise<GamePaths>
  /** A folder dialog, then `which` uses the chosen folder instead of the one found; null when cancelled. */
  readonly chooseGamePath: (which: GamePathKind) => Promise<GamePaths | null>
  /** Goes back to the folder found through Steam. */
  readonly resetGamePath: (which: GamePathKind) => Promise<GamePaths>
  /** Shows the folder in the file manager; false when it doesn't exist or fails to open. */
  readonly revealGamePath: (which: GamePathKind) => Promise<boolean>
  /** Starts the game through Steam (`steam://rungameid/3339810`); false when Steam couldn't be asked. */
  readonly launchGame: () => Promise<boolean>
  /** Whether the game (`Ballest-Win64-Shipping.exe`) is running. */
  readonly isGameRunning: () => Promise<boolean>
  /** The creator name the game would write (the Steam persona name), and where it was found; null when none was. */
  readonly findCreator: () => Promise<FoundCreator | null>
  /** Whether the `ballest-editor-link` plugin is installed, and as new as the app's copy. */
  readonly pluginStatus: () => Promise<PluginStatus>
  /**
   * Copies the app's `ballest-editor-link` into the plugins folder, over an older copy (its `play.json` is kept).
   * Rejects when the plugin manager isn't installed. Only ever writes inside `<plugins>/ballest-editor-link`.
   */
  readonly installPlugin: () => Promise<InstallPluginResult>
  /** The notifications kept in `<userData>/notifications.json`, newest first; empty when there are none yet. */
  readonly loadNotifications: () => Promise<NotificationRecords>
  /** Replaces the kept notifications (at most `NOTIFICATION_LIMIT`). */
  readonly saveNotifications: (records: NotificationRecords) => Promise<void>
  /** "Don't show again": mutes a notification kind from now on, across restarts; the kinds muted afterwards. */
  readonly muteNotifications: (kind: string) => Promise<MutedNotificationKinds>
  /** What the Game link found last time (null on the first launch), and the muted notification kinds. */
  readonly gameLinkMemory: () => Promise<GameLinkMemory>
  /** Keeps what the Game link found, for the next launch to compare with. */
  readonly rememberGameLink: (result: GameLinkResult) => Promise<void>
  /** The updater's state now. */
  readonly getUpdateState: () => Promise<UpdateState>
  /** Starts downloading the release on offer (`available`); progress and the outcome arrive through `onUpdateState`. */
  readonly downloadUpdate: () => Promise<void>
  /** Quits, installs the downloaded release (`ready`) and starts it. Unsaved edits are lost. */
  readonly installUpdate: () => Promise<void>
  /** Calls `listener` with every later state, until the returned function is called. */
  readonly onUpdateState: (listener: (state: UpdateState) => void) => () => void
}
