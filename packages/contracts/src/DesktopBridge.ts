import { Schema } from "effect"
import type { InvokeChannels, PushChannels } from "./channels"
import { isMapFileName, isPrefabName, PREFAB_NAME_RULE } from "./names"

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

/**
 * A map's, a sidecar's or a prefab's text, exactly as written to disk: the page encodes and decodes it, main only moves
 * it. The game's own largest maps are a few MB.
 */
export const FileText = Schema.String.check(Schema.isMaxLength(64 * 1024 * 1024))

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
  text: FileText
})
export type OpenedMapFile = typeof OpenedMapFile.Type

/** `pickImport`'s result: null when the user cancelled the dialog. */
export const PickImportResult = Schema.NullOr(OpenedMapFile)

/**
 * A map's file name in a project's `maps/` folder, which is also its name in the game's maps folder
 * (`Map_LevelEditorMain&<name>_<creator>.balledit`). Never a path: decoding a payload refuses anything `isMapFileName`
 * doesn't accept, before a handler sees it, and main checks it again before joining it to a folder.
 */
export const MapFileName = Schema.String.check(
  Schema.isMaxLength(255),
  Schema.makeFilter((name: string) => isMapFileName(name) || "isn't a map file name (a .balledit name, no folders)")
)

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

/**
 * The two places prefabs live (docs/DESKTOP.md § Prefabs): `user` is the game's own prefabs folder, so the in-game editor
 * lists them too, and `project` is `<project>/prefabs/`.
 */
export const PrefabTier = Schema.Literals(["user", "project"])
export type PrefabTier = typeof PrefabTier.Type

/** A prefab's name, which is its file's less `.json`. Never a path: anything `isPrefabName` refuses stops at decoding. */
export const PrefabName = Schema.String.check(
  Schema.makeFilter((name: string) => isPrefabName(name) || `isn't a prefab name (${PREFAB_NAME_RULE})`)
)

/** How many items a prefab's text holds, and the first one's class; null for text that doesn't read as a prefab. */
export const PrefabSummary = Schema.Struct({
  itemCount: Schema.NullOr(Schema.Int),
  firstClass: Schema.NullOr(Schema.String)
})
export type PrefabSummary = typeof PrefabSummary.Type

/** A prefab as a tier lists it. */
export const PrefabInfo = Schema.Struct({
  tier: PrefabTier,
  name: PrefabName,
  /** Where its file is; null in the web review build, which keeps prefabs in memory. */
  path: Schema.NullOr(FilePath),
  modifiedAt: IsoTime,
  hash: FileHash,
  ...PrefabSummary.fields
})
export type PrefabInfo = typeof PrefabInfo.Type

/** Only what a tier's list shows of a file; the page decodes the rest. */
const PrefabSummaryJson = Schema.fromJsonString(Schema.Struct({
  format: Schema.Literal("BallestPrefab"),
  items: Schema.Array(Schema.Struct({ class: Schema.String }))
}))

export const prefabSummaryOf = (text: string): PrefabSummary => {
  const decoded = Schema.decodeOption(PrefabSummaryJson)(text.replace(/^\uFEFF/, ""))
  return decoded._tag === "Some"
    ? { itemCount: decoded.value.items.length, firstClass: decoded.value.items[0]?.class ?? null }
    : { itemCount: null, firstClass: null }
}

export const PrefabInfos = Schema.Array(PrefabInfo)
export type PrefabInfos = typeof PrefabInfos.Type

export const PrefabRead = Schema.Struct({ ...PrefabInfo.fields, text: FileText })
export type PrefabRead = typeof PrefabRead.Type

export const PrefabTierPayload = Schema.Struct({ tier: PrefabTier })
export type PrefabTierPayload = typeof PrefabTierPayload.Type

export const PrefabRef = Schema.Struct({ tier: PrefabTier, name: PrefabName })
export type PrefabRef = typeof PrefabRef.Type

/** `writePrefab`: `replace` writes over a prefab of that name (it goes to the backups), and without it that fails. */
export const WritePrefabPayload = Schema.Struct({ ...PrefabRef.fields, text: FileText, replace: Schema.Boolean })
export type WritePrefabPayload = typeof WritePrefabPayload.Type

/** `renamePrefab`: moves it within its tier; fails when `to` is taken. */
export const RenamePrefabPayload = Schema.Struct({ tier: PrefabTier, from: PrefabName, to: PrefabName })
export type RenamePrefabPayload = typeof RenamePrefabPayload.Type

/** The folder the user works in (docs/PROJECTS.md). It is made on disk by New project, or a first write into it. */
export const ProjectInfo = Schema.Struct({
  path: FilePath,
  /** `ballest-project.json`'s name; the folder's name until that file exists. */
  name: Schema.String,
  /** Whether the folder is a project on disk yet (it has `ballest-project.json`). */
  exists: Schema.Boolean
})
export type ProjectInfo = typeof ProjectInfo.Type

/** A project used before: `lastOpened` is when this machine last opened it, null when that wasn't kept. */
export const RecentProject = Schema.Struct({ ...ProjectInfo.fields, lastOpened: Schema.NullOr(IsoTime) })
export type RecentProject = typeof RecentProject.Type

/**
 * The project in use and the ones used before it, most recent first. `current` is null while there is none: the
 * window is then Untitled Project, nothing on disk, and the first Save names one (docs/PROJECTS.md § Shell).
 */
export const ProjectState = Schema.Struct({
  current: Schema.NullOr(ProjectInfo),
  recent: Schema.Array(RecentProject),
  /** The map last open in the current project (its file name), for the next launch to open again; null when none was. */
  lastOpenMap: Schema.NullOr(MapFileName),
  /** Where New project makes its folders: `Documents/Ballest Editor`. */
  projectsFolder: FilePath,
  /**
   * This window must pick a project before anything else (docs/DESKTOP.md § Other windows): `current` is null, but the
   * window isn't Untitled Project, and it can't become one.
   */
  chooserRequired: Schema.Boolean,
  /** The folders in `recent` that another running window has open. */
  openElsewhere: Schema.Array(FilePath),
  /** Why the `--project` this window was started with was refused; null when it wasn't. */
  startRefused: Schema.NullOr(Schema.String)
})
export type ProjectState = typeof ProjectState.Type

/** `chooseProject`'s result: the folder picked, which nothing uses yet; null when the user cancelled the dialog. */
export const ChooseProjectResult = Schema.NullOr(ProjectInfo)

/**
 * A new project: its name, and the folder it is made in: `folder`, one picked in a dialog (`chooseProject`), or
 * `<projectsFolder>/<name>` when not given.
 */
export const CreateProjectPayload = Schema.Struct({ name: Schema.String, folder: Schema.optionalKey(FilePath) })
export type CreateProjectPayload = typeof CreateProjectPayload.Type

/** A project about to be opened: a folder main already knows (recent, or picked in a dialog), or a new one. */
export const ProjectTarget = Schema.TaggedUnion({
  Existing: { path: FilePath },
  New: CreateProjectPayload.fields
})
export type ProjectTarget = typeof ProjectTarget.Type

export const ProjectPathPayload = Schema.Struct({ path: FilePath })
export type ProjectPathPayload = typeof ProjectPathPayload.Type

/** Project settings › General: the project's name in `ballest-project.json` (the folder keeps its name). */
export const RenameProjectPayload = Schema.Struct({ name: Schema.String })
export type RenameProjectPayload = typeof RenameProjectPayload.Type

/** The project's folders the file manager can be asked to show: the project itself, its `maps/`, its backups. */
export const ProjectFolder = Schema.Literals(["project", "maps", "backups"])
export type ProjectFolder = typeof ProjectFolder.Type
export const RevealProjectPayload = Schema.Struct({ which: ProjectFolder })
export type RevealProjectPayload = typeof RevealProjectPayload.Type

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

/** A project map that was read, with its text and its sidecar's: null when it has none, or that can't be read. */
export const ProjectMapFile = Schema.Struct({ ...ProjectMap.fields, text: FileText, sidecar: Schema.NullOr(FileText) })
export type ProjectMapFile = typeof ProjectMapFile.Type

export const MapFileNamePayload = Schema.Struct({ fileName: MapFileName })
export type MapFileNamePayload = typeof MapFileNamePayload.Type

/** `rememberOpenMap`: the map now open in the project, or null for a map that isn't in it. */
export const OpenMapPayload = Schema.Struct({ fileName: Schema.NullOr(MapFileName) })
export type OpenMapPayload = typeof OpenMapPayload.Type

/** `createMap` and `saveMap`: the map's file name in the project and its text. */
export const WriteMapPayload = Schema.Struct({ fileName: MapFileName, text: FileText })
export type WriteMapPayload = typeof WriteMapPayload.Type

/** `writeSidecar`: the map the sidecar belongs to, and the sidecar's text. */
export const WriteSidecarPayload = Schema.Struct({ fileName: MapFileName, text: FileText })
export type WriteSidecarPayload = typeof WriteSidecarPayload.Type

/** `renameMap`: the file the map was in, the one it moves to (named after its new name), and its new text. */
export const RenameMapPayload = Schema.Struct({ from: MapFileName, to: MapFileName, text: FileText })
export type RenameMapPayload = typeof RenameMapPayload.Type

/** `importMap`: a file `pickImport` returned, the project file name it goes in under, and the text written there. */
export const ImportMapPayload = Schema.Struct({
  source: FilePath,
  fileName: MapFileName,
  text: FileText,
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
  replacePublished: Schema.Boolean,
  /** Write over an export the game changed since the last export (it goes to backups); otherwise main asks first. */
  overwriteChanged: Schema.Boolean
})
export type ExportMapPayload = typeof ExportMapPayload.Type

/** The cases of `ExportRefusal`, spread into `ExportMapResult` and `PlayResult` so both answer the same shapes. */
const exportRefusals = {
  Published: { file: MapFileRef, publishedFileId: Schema.Finite },
  ChangedInGame: { file: MapFileRef }
}

/**
 * Why an export (Export to game, or Play's) wrote nothing, so the page can ask: the file in the maps folder is the draft
 * of a published map and `replacePublished` wasn't set (`Published`), or the game changed it since the last export (the
 * in-game editor saved it) and `overwriteChanged` wasn't set (`ChangedInGame`).
 */
export const ExportRefusal = Schema.TaggedUnion(exportRefusals)
export type ExportRefusal = typeof ExportRefusal.Type

/** `exportMap`'s result: `Exported` with the file written and the map's new link record, or an `ExportRefusal`. */
export const ExportMapResult = Schema.TaggedUnion({
  Exported: { file: MapFileRef, link: MapLink },
  ...exportRefusals
})
export type ExportMapResult = typeof ExportMapResult.Type

/**
 * `checkExports`' result (docs/PROJECTS.md § Sync): the maps whose export the game changed since the editor last
 * looked (each change is reported once: the link's `lastSeenHash` keeps what was seen), and the maps whose export is
 * gone from the maps folder (their link's export was dropped, so they show Not exported).
 */
export const ExportChecks = Schema.Struct({
  changed: Schema.Array(MapFileName),
  missing: Schema.Array(MapFileName)
})
export type ExportChecks = typeof ExportChecks.Type

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

/**
 * A backup that was read: its text (the old file's bytes), their hash, and the sidecar kept when it was, else the map's
 * sidecar as it is now (null: the map has none).
 */
export const MapBackupFile = Schema.Struct({
  ...MapBackup.fields,
  text: FileText,
  hash: FileHash,
  sidecar: Schema.NullOr(FileText)
})
export type MapBackupFile = typeof MapBackupFile.Type

/** A backup of a prefab, by its tier: the project's are in its `.ballest/backups/`, the game's in `<userData>/backups/`. */
export const PrefabBackupRef = Schema.Struct({ tier: PrefabTier, id: BackupId })
export type PrefabBackupRef = typeof PrefabBackupRef.Type

/** A previous version of a prefab, which may be one that has since been deleted or renamed. */
export const PrefabBackup = Schema.Struct({ ...PrefabBackupRef.fields, name: PrefabName, at: IsoTime })
export type PrefabBackup = typeof PrefabBackup.Type

export const PrefabBackups = Schema.Array(PrefabBackup)
export type PrefabBackups = typeof PrefabBackups.Type

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
  /** Replaces a project map with its export as the game changed it (Re-import). */
  ReimportMap: { fileName: MapFileName },
  /** Replaces the edited instances of a prefab in the open maps with its definition. */
  UpdatePrefabInstances: PrefabRef.fields,
  /** Makes the edited instances of a prefab in the open maps plain groups. */
  DetachPrefabInstances: PrefabRef.fields,
  /** Nothing besides marking the notification read (Ignore). */
  Dismiss: {},
  /** Opens a web page in the default browser (the plugin manager's install steps). */
  OpenExternal: { url: OpenExternalPayload.fields.url },
  /** Installs (or updates) the `ballest-editor-link` plugin Play needs. */
  InstallPlugin: {}
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
 * `play`: the project map to export and race, whether to replace a published map's draft in the maps folder, and
 * whether to write over an export the game changed since the last export (as `exportMap`).
 */
export const PlayPayload = Schema.Struct({ ...ExportMapPayload.fields })
export type PlayPayload = typeof PlayPayload.Type

/**
 * Whether Play had to start the game: it was `running`, Play `launched` it through Steam, or Steam couldn't be asked
 * (`failed`).
 */
export const PlayLaunch = Schema.Literals(["running", "launched", "failed"])
export type PlayLaunch = typeof PlayLaunch.Type

/**
 * `play`'s result (docs/DESKTOP.md § Play):
 * - `Played`: exported (`file`, the map's new `link`), then `sent` the race to the plugin through its `play.json` when
 *   the plugin is installed (`plugin` says how it stands otherwise), and started the game unless it was running.
 * - `Published`, `ChangedInGame`: nothing written, an `ExportRefusal` as Export reports it.
 * - `PublishedMap`: nothing written: the project map itself is a published map's (`levelPublishedFileId` above -1),
 *   which the plugin manager won't race. A copy saved as a new draft can be.
 */
export const PlayResult = Schema.TaggedUnion({
  Played: { file: MapFileRef, link: MapLink, plugin: PluginStatus, sent: Schema.Boolean, launch: PlayLaunch },
  ...exportRefusals,
  PublishedMap: { fileName: MapFileName, publishedFileId: Schema.Finite }
})
export type PlayResult = typeof PlayResult.Type

/**
 * Main → renderer: the game session a Play ran in has ended (the game's process exited). `fileName` is the map the
 * last Play of that session raced. The page checks the exports then (`checkExports`).
 */
export const PlaySessionEnded = Schema.Struct({ fileName: MapFileName, endedAt: IsoTime })
export type PlaySessionEnded = typeof PlaySessionEnded.Type

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

/** This repository on GitHub. */
export const REPOSITORY_URL = "https://github.com/ballest-editor/ballest-editor"

/** This repository's GitHub Releases: the feed the packaged app checks, and Help › Release notes. */
export const RELEASES_URL = `${REPOSITORY_URL}/releases`

/** The licence, as Help › About links it. */
export const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`

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

/** What a bridge method takes and gives: its payload's schema and its result's, neither needing services. */
interface DesktopMethodSchemas {
  readonly payload: Schema.ConstraintCodec<unknown>
  readonly result: Schema.ConstraintCodec<unknown>
}

const noPayload = Schema.Undefined

/**
 * Every method on `window.ballest`, by name: what the page sends and what main answers, as `ipcRenderer.invoke` on
 * `InvokeChannels[name]`. Main decodes every payload and encodes every result with these schemas; a payload that fails
 * to decode rejects the page's promise. Adding an entry here and its channel to `InvokeChannels` is the whole contract
 * side: `DesktopBridge` and the preload follow, and main fails typecheck until it has a handler.
 *
 * Main reads and writes map files only in the current project's `maps/` folder (named by file name, never by path) and
 * in the game's maps folder (Export to game, Play), and reads only the files the user picked in its Import dialog. The
 * files it writes over are kept in its own backups folders, which the page reaches by backup name only. In the game's
 * install it writes only inside `<plugins>/ballest-editor-link/` (Install plugin, Play's `play.json`).
 */
export const DesktopMethods = {
  /** Echoes `message` back from the main process. */
  ping: { payload: PingPayload, result: PingResult },
  /** The project in use and the recent ones. */
  projectState: { payload: noPayload, result: ProjectState },
  /**
   * A folder dialog: the folder picked, ready for `switchProject` or `openProjectWindow`; null when cancelled. Nothing
   * uses it yet. The game's maps folder and a project open in another window are refused.
   */
  chooseProject: { payload: noPayload, result: ChooseProjectResult },
  /** Refuses what `switchProject`, `createProject` or `openProjectWindow` would, changing nothing: asked before asking the user. */
  checkProject: { payload: ProjectTarget, result: Schema.Void },
  /** Starts another running copy of the app on the project (a new one is made first); this window stays as it is. */
  openProjectWindow: { payload: ProjectTarget, result: Schema.Void },
  /** Uses a recent project, or the folder `chooseProject` picked; refused while another window has it open. */
  switchProject: { payload: ProjectPathPayload, result: ProjectState },
  /** Makes a project of `folder`, or `<projectsFolder>/<name>`, and uses it; refused when the folder already holds one. */
  createProject: { payload: CreateProjectPayload, result: ProjectState },
  /** Shows one of the project's folders in the file manager; false when it doesn't exist or fails to open. */
  revealProject: { payload: RevealProjectPayload, result: Schema.Boolean },
  /** Shows a recent project's folder in the file manager; false when it isn't there. Any other folder is refused. */
  revealRecentProject: { payload: ProjectPathPayload, result: Schema.Boolean },
  /** Takes a project off the recent ones. Nothing on disk changes. */
  forgetRecentProject: { payload: ProjectPathPayload, result: ProjectState },
  /** Renames the project in `ballest-project.json`; the folder keeps its name. */
  renameProject: { payload: RenameProjectPayload, result: ProjectState },
  /** Keeps which map is open in the project, so the next launch opens it again (`ProjectState.lastOpenMap`). */
  rememberOpenMap: { payload: OpenMapPayload, result: Schema.Void },
  /** The project's maps, most recently changed first; empty when the project isn't on disk yet. */
  listMaps: { payload: noPayload, result: ProjectMaps },
  /** Reads a project map. */
  readMap: { payload: MapFileNamePayload, result: ProjectMapFile },
  /** Writes a new map into the project, making the project first if needed; fails when one of that name exists. */
  createMap: { payload: WriteMapPayload, result: ProjectMap },
  /**
   * Writes over a project map (Save), or writes it if it has gone. The text is written as is: same bytes, no BOM.
   * Atomic, like every write. The file it replaces goes to the project's backups first; the same text writes nothing.
   */
  saveMap: { payload: WriteMapPayload, result: ProjectMap },
  /**
   * Writes the map under its new file name and moves the old file to the project's backups; its link and its sidecar
   * move with it.
   */
  renameMap: { payload: RenameMapPayload, result: ProjectMap },
  writeSidecar: { payload: WriteSidecarPayload, result: Schema.Void },
  listPrefabs: { payload: PrefabTierPayload, result: PrefabInfos },
  readPrefab: { payload: PrefabRef, result: PrefabRead },
  writePrefab: { payload: WritePrefabPayload, result: PrefabInfo },
  deletePrefab: { payload: PrefabRef, result: Schema.Void },
  renamePrefab: { payload: RenamePrefabPayload, result: PrefabInfo },
  revealPrefabs: { payload: PrefabTierPayload, result: Schema.Boolean },
  listPrefabBackups: { payload: noPayload, result: PrefabBackups },
  describePrefabBackup: { payload: PrefabBackupRef, result: PrefabSummary },
  restorePrefabBackup: { payload: PrefabBackupRef, result: PrefabInfo },
  /** The native open dialog for a map file anywhere; null when cancelled. The file may then be imported. */
  pickImport: { payload: noPayload, result: PickImportResult },
  /** Copies a picked file into the project and records where it came from (a map it replaces goes to backups). */
  importMap: { payload: ImportMapPayload, result: ImportMapResult },
  /**
   * Copies a project map byte for byte into the game's maps folder and records the export in its link. The file it
   * replaces there goes to `<userData>/backups/` first. Fails, writing nothing, on a file past the game's character
   * limit (`fileTextProblems`).
   */
  exportMap: { payload: ExportMapPayload, result: ExportMapResult },
  /**
   * Sync detection: hashes every linked map's export in the game's maps folder and compares it with the last export
   * and the last seen hash, keeping what it saw in the link. A changed export is reported once; a missing one has its
   * export dropped from the link. Nothing is checked while the maps folder isn't there.
   */
  checkExports: { payload: noPayload, result: ExportChecks },
  /**
   * Re-import: replaces a project map with its export in the game's maps folder, byte for byte (the project's file goes
   * to the project's backups first), and records the export as in sync. Fails for a map that has no export.
   */
  reimportMap: { payload: MapFileNamePayload, result: ProjectMapFile },
  /** The current project's backups and the exports' (docs/PROJECTS.md § The files), newest first. */
  listBackups: { payload: noPayload, result: MapBackups },
  /** Reads a backup `listBackups` named. */
  readBackup: { payload: BackupRef, result: MapBackupFile },
  /** The page's resolved theme: the window controls drawn over its top bar, and the window background, follow it. */
  setWindowTheme: { payload: WindowThemePayload, result: Schema.Void },
  /** The native Save / Don't save / Cancel box, modal to the window. */
  confirmUnsaved: { payload: UnsavedPrompt, result: UnsavedChoice },
  /** Opens an http(s) URL in the default browser; false when it is refused or fails to open. */
  openExternal: { payload: OpenExternalPayload, result: Schema.Boolean },
  /** Where the game, its maps folder and the plugins folder are, and how each was found. */
  gamePaths: { payload: noPayload, result: GamePaths },
  /** A folder dialog, then `which` uses the chosen folder instead of the one found; null when cancelled. */
  chooseGamePath: { payload: GamePathPayload, result: ChooseGamePathResult },
  /** Goes back to the folder found through Steam. */
  resetGamePath: { payload: GamePathPayload, result: GamePaths },
  /** Shows the folder in the file manager; false when it doesn't exist or fails to open. */
  revealGamePath: { payload: GamePathPayload, result: Schema.Boolean },
  /** Starts the game through Steam (`steam://rungameid/3339810`); false when Steam couldn't be asked. */
  launchGame: { payload: noPayload, result: Schema.Boolean },
  /** Whether the game (`Ballest-Win64-Shipping.exe`) is running. */
  isGameRunning: { payload: noPayload, result: Schema.Boolean },
  /** The creator name the game would write (the Steam persona name), and where it was found; null when none was. */
  findCreator: { payload: noPayload, result: FindCreatorResult },
  /** Whether the `ballest-editor-link` plugin is installed, and as new as the app's copy. */
  pluginStatus: { payload: noPayload, result: PluginStatus },
  /**
   * Copies the app's `ballest-editor-link` into the plugins folder, over an older copy (its `play.json` is kept).
   * Rejects when the plugin manager isn't installed. Only ever writes inside `<plugins>/ballest-editor-link`.
   */
  installPlugin: { payload: noPayload, result: InstallPluginResult },
  /**
   * Play: exports a project map like `exportMap` (backups, link record, the published-draft question), writes
   * `<plugins>/ballest-editor-link/play.json` for the plugin to race it, and starts the game if it isn't running.
   * Without the plugin it still exports and starts the game; `play.json` is only written into an installed plugin.
   */
  play: { payload: PlayPayload, result: PlayResult },
  /** The notifications kept in `<userData>/notifications.json`, newest first; empty when there are none yet. */
  loadNotifications: { payload: noPayload, result: NotificationRecords },
  /** Replaces the kept notifications (at most `NOTIFICATION_LIMIT`). */
  saveNotifications: { payload: Schema.Struct({ records: NotificationRecords }), result: Schema.Void },
  /** "Don't show again": mutes a notification kind from now on, across restarts; the kinds muted afterwards. */
  muteNotifications: { payload: NotificationKindPayload, result: MutedNotificationKinds },
  /** What the Game link found last time (null on the first launch), and the muted notification kinds. */
  gameLinkMemory: { payload: noPayload, result: GameLinkMemory },
  /** Keeps what the Game link found, for the next launch to compare with. */
  rememberGameLink: { payload: GameLinkResult, result: Schema.Void },
  /** The updater's state now. */
  getUpdateState: { payload: noPayload, result: UpdateState },
  /** Checks the feed now and returns when the check is done; the outcome arrives through `onUpdateState`. */
  checkForUpdates: { payload: noPayload, result: Schema.Void },
  /** Starts downloading the release on offer (`available`); progress and the outcome arrive through `onUpdateState`. */
  downloadUpdate: { payload: noPayload, result: Schema.Void },
  /** Quits, installs the downloaded release (`ready`) and starts it. Unsaved edits are lost. */
  installUpdate: { payload: noPayload, result: Schema.Void }
} as const satisfies { readonly [K in keyof typeof InvokeChannels]: DesktopMethodSchemas }

/** What main pushes to the page (`webContents.send` on `PushChannels[name]`), by the bridge member that listens. */
const DesktopPushes = {
  /** Calls `listener` each time the page held a close or a reload with unsaved edits, until the returned function is called. */
  onUnloadRequest: UnloadKind,
  /** Calls `listener` each time the game session a Play started or joined ends, until the returned function is called. */
  onPlaySessionEnded: PlaySessionEnded,
  /** Calls `listener` with every later update state, until the returned function is called. */
  onUpdateState: UpdateState
} as const satisfies {
  readonly [K in keyof typeof PushChannels]: Schema.ConstraintCodec<unknown>
}

export type DesktopMethodName = keyof typeof DesktopMethods

/** What the page passes to a bridge method: its payload as encoded, or nothing for a method that takes none. */
export type DesktopArgs<K extends DesktopMethodName> = [(typeof DesktopMethods)[K]["payload"]["Encoded"]] extends
  [undefined] ? []
  : [payload: (typeof DesktopMethods)[K]["payload"]["Encoded"]]

/** What a bridge method's promise resolves with: its result as main encoded it. */
export type DesktopResult<K extends DesktopMethodName> = (typeof DesktopMethods)[K]["result"]["Encoded"]

/** The bridge's methods, one per `DesktopMethods` entry. */
export type DesktopInvoke = {
  readonly [K in keyof typeof DesktopMethods]: (...args: DesktopArgs<K>) => Promise<DesktopResult<K>>
}

/** The bridge's subscriptions, one per `DesktopPushes` entry: each returns the function that unsubscribes. */
export type DesktopSubscriptions = {
  readonly [K in keyof typeof DesktopPushes]: (
    listener: (value: (typeof DesktopPushes)[K]["Encoded"]) => void
  ) => () => void
}

/**
 * What the desktop preload exposes to the renderer as `window.ballest`: the runtime versions, then one member per entry
 * in `DesktopMethods` and `DesktopPushes`. The renderer only sees this interface, so everything crossing it is plain
 * data (structured-clone safe).
 */
export interface DesktopBridge extends DesktopInvoke, DesktopSubscriptions {
  readonly versions: DesktopVersions
}
