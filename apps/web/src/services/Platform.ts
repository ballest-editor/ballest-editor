import type {
  BackupRef,
  CreateProjectPayload,
  DesktopArgs,
  DesktopBridge,
  DesktopInvoke,
  DesktopMethodName,
  ExportChecks,
  ExportMapResult,
  FoundCreator,
  GameLinkMemory,
  GameLinkResult,
  GamePathKind,
  GamePaths,
  ImportMapPayload,
  ImportMapResult,
  InstallPluginResult,
  MapBackupFile,
  MapBackups,
  MutedNotificationKinds,
  NotificationRecords,
  OpenedMapFile,
  PlayResult,
  PlaySessionEnded,
  PluginStatus,
  PrefabBackupRef,
  PrefabBackups,
  PrefabInfo,
  PrefabInfos,
  PrefabRead,
  PrefabRef,
  PrefabSummary,
  PrefabTier,
  ProjectFolder,
  ProjectInfo,
  ProjectMap,
  ProjectMapFile,
  ProjectMaps,
  ProjectState,
  ProjectTarget,
  RenamePrefabPayload,
  UnloadKind,
  UnsavedChoice,
  UpdateState,
  WritePrefabPayload
} from "@ballest/contracts"
import { prefabSummaryOf } from "@ballest/contracts"
import { Context, Effect, Layer, Option, Queue, Schema, Stream } from "effect"
import { discardQuestionOf, type UnsavedAction, unsavedPromptOf } from "../domain/unsaved"

export type {
  FoundCreator,
  GameLinkMemory,
  GameLinkResult,
  GamePathKind,
  GamePaths,
  InstallPluginResult,
  MapBackup,
  NotificationAction,
  NotificationCommand,
  NotificationRecord,
  PlayResult,
  PlaySessionEnded,
  PluginStatus,
  PrefabBackup,
  PrefabInfo,
  PrefabRef,
  PrefabTier,
  ProjectMap,
  ProjectMapFile,
  ProjectState,
  ProjectTarget,
  UnloadKind,
  UnsavedChoice
} from "@ballest/contracts"

/** What this platform can do; the menus hide what it can't. */
export interface PlatformCapabilities {
  /**
   * A project folder on disk (docs/PROJECTS.md): Save writes there, Import copies a file in. A
   * browser has none: one map in memory, Open is the file input and Export is a download.
   */
  readonly projects: boolean
  /** Finding the game's folders, and exporting a map into its UserSavedMaps folder. */
  readonly exportToGame: boolean
  /** Starting the game through Steam. */
  readonly launchGame: boolean
  /** Racing the open map in the game through the plugin manager (docs/DESKTOP.md § Play). */
  readonly play: boolean
  /** Updating itself from GitHub Releases; whether this build actually does is the update state's `disabled`. */
  readonly updates: boolean
}

/**
 * What may be written over when exporting: a published map's draft in the maps folder (`replacePublished`), and an
 * export the game changed since the last export (`overwriteChanged`). Main asks first about each that isn't set.
 */
export interface ExportOptions {
  readonly replacePublished: boolean
  readonly overwriteChanged: boolean
}

/** A map file the user picked to open (browser) or import (desktop). `path` is none in a browser, which never sees one. */
export interface OpenedMap {
  readonly name: string
  readonly path: Option.Option<string>
  readonly text: string
}

export class PlatformError extends Schema.TaggedError<PlatformError>()("PlatformError", {
  message: Schema.String
}) {}

/**
 * The renderer's way out of the page: the project and its maps, links, the game. Two implementations behind one
 * interface, so nothing above `services/` asks which one it runs in: `layerBrowser` (file input, download,
 * `window.open`) and `layerDesktop` (the preload bridge, `window.ballest`).
 */
export class Platform extends Context.Service<Platform, {
  readonly capabilities: PlatformCapabilities
  /** Asks for a map file anywhere (the desktop's import dialog, the browser's file input); none when cancelled. */
  readonly pickMapFile: Effect.Effect<Option.Option<OpenedMap>, PlatformError>
  /** Downloads `text` as `name` (browser: its Export). */
  readonly download: (file: { readonly name: string; readonly text: string }) => Effect.Effect<void, PlatformError>
  /** The project in use and the recent ones (desktop). */
  readonly projectState: Effect.Effect<ProjectState, PlatformError>
  /** Asks for a folder to open as a project, which nothing uses yet; none when the user cancels. */
  readonly chooseProject: Effect.Effect<Option.Option<ProjectInfo>, PlatformError>
  /** Fails as opening `target` would (open in another window, a name that's taken), changing nothing. */
  readonly checkProject: (target: ProjectTarget) => Effect.Effect<void, PlatformError>
  /** Starts another running copy of the app on `target`; this window stays as it is. */
  readonly openProjectWindow: (target: ProjectTarget) => Effect.Effect<void, PlatformError>
  /** Uses a recent project, or the folder `chooseProject` gave. */
  readonly switchProject: (path: string) => Effect.Effect<ProjectState, PlatformError>
  /** Makes a project of the folder picked, or `<projectsFolder>/<name>`, and uses it. */
  readonly createProject: (project: CreateProjectPayload) => Effect.Effect<ProjectState, PlatformError>
  /** Shows one of the project's folders in the file manager. */
  readonly revealProject: (which: ProjectFolder) => Effect.Effect<void, PlatformError>
  /** Renames the project (its file's name; the folder keeps its name). */
  readonly renameProject: (name: string) => Effect.Effect<ProjectState, PlatformError>
  /** Keeps which map is open in the project (null: one that isn't in it), so the next launch opens it again. */
  readonly rememberOpenMap: (fileName: string | null) => Effect.Effect<void, PlatformError>
  /** The project's maps, most recently changed first; always empty in a browser. */
  readonly listMaps: Effect.Effect<ProjectMaps, PlatformError>
  readonly readMap: (fileName: string) => Effect.Effect<ProjectMapFile, PlatformError>
  /** Writes a new map into the project (making the project first); fails when one of that name exists. */
  readonly createMap: (
    file: { readonly fileName: string; readonly text: string }
  ) => Effect.Effect<ProjectMap, PlatformError>
  /** Writes over a project map. */
  readonly saveMap: (
    file: { readonly fileName: string; readonly text: string }
  ) => Effect.Effect<ProjectMap, PlatformError>
  /** Moves a project map to a new file name with new text; the old file goes to the project's backups. */
  readonly renameMap: (
    file: { readonly from: string; readonly to: string; readonly text: string }
  ) => Effect.Effect<ProjectMap, PlatformError>
  /** Writes a map's sidecar beside it, once the map is written; the old sidecar goes to the project's backups. */
  readonly writeSidecar: (
    file: { readonly fileName: string; readonly text: string }
  ) => Effect.Effect<void, PlatformError>
  /** A tier's prefabs by name (docs/DESKTOP.md § Prefabs). A browser keeps its `user` tier in memory, and has no other. */
  readonly listPrefabs: (tier: PrefabTier) => Effect.Effect<PrefabInfos, PlatformError>
  readonly readPrefab: (ref: PrefabRef) => Effect.Effect<PrefabRead, PlatformError>
  /** Writes a prefab; without `replace`, fails when there is one of that name. What it replaces goes to the backups. */
  readonly writePrefab: (payload: WritePrefabPayload) => Effect.Effect<PrefabInfo, PlatformError>
  /** Moves a prefab to the backups. */
  readonly deletePrefab: (ref: PrefabRef) => Effect.Effect<void, PlatformError>
  /** Moves a prefab to a new name in its tier; fails when the name is taken. */
  readonly renamePrefab: (payload: RenamePrefabPayload) => Effect.Effect<PrefabInfo, PlatformError>
  /** Shows a tier's folder in the file manager. */
  readonly revealPrefabs: (tier: PrefabTier) => Effect.Effect<void, PlatformError>
  /** Copies a picked file into the project. `Clash` (nothing written) when it has a map of that name and not `replace`. */
  readonly importMap: (payload: ImportMapPayload) => Effect.Effect<ImportMapResult, PlatformError>
  /**
   * Copies a project map into the game's maps folder and records the export. Nothing is written when the file there is
   * a published map's draft and not `replacePublished` (`Published`), or the game changed it since the last export and
   * not `overwriteChanged` (`ChangedInGame`).
   */
  readonly exportMap: (fileName: string, options: ExportOptions) => Effect.Effect<ExportMapResult, PlatformError>
  /**
   * Sync detection (desktop): looks at every linked map's export in the game's maps folder, and reports the ones the
   * game changed since the last look (each change once) and the ones gone (their export is dropped). None in a browser.
   */
  readonly checkExports: Effect.Effect<ExportChecks, PlatformError>
  /** Re-import: replaces a project map with its export as the game has it (the project's file goes to backups). */
  readonly reimportMap: (fileName: string) => Effect.Effect<ProjectMapFile, PlatformError>
  /**
   * Asks whether to save the open map's edits before `action`: the desktop's native Save / Don't save / Cancel box. A
   * browser's `confirm` has no Save: OK is Don't save.
   */
  readonly confirmUnsaved: (action: UnsavedAction, map: string) => Effect.Effect<UnsavedChoice, PlatformError>
  /**
   * Each close or reload the page held because of unsaved edits (its `beforeunload`), for the page to ask about (desktop).
   * A browser asks with its own dialog, so its stream ends at once.
   */
  readonly unloadRequests: Stream.Stream<UnloadKind, PlatformError>
  /** Closes the window or reloads the page; the page must have stopped holding the unload first. */
  readonly leave: (kind: UnloadKind) => Effect.Effect<void>
  /**
   * The versions main kept of the files it wrote over (the project's and the exports'), newest first; always empty in
   * a browser.
   */
  readonly listBackups: Effect.Effect<MapBackups, PlatformError>
  readonly readBackup: (ref: BackupRef) => Effect.Effect<MapBackupFile, PlatformError>
  /** The prefabs' backups in both tiers, newest first (desktop). */
  readonly listPrefabBackups: Effect.Effect<PrefabBackups, PlatformError>
  readonly describePrefabBackup: (ref: PrefabBackupRef) => Effect.Effect<PrefabSummary, PlatformError>
  /** Writes a backup back as its prefab; the file it replaces goes to the backups. */
  readonly restorePrefabBackup: (ref: PrefabBackupRef) => Effect.Effect<PrefabInfo, PlatformError>
  readonly openExternal: (url: string) => Effect.Effect<void, PlatformError>
  /** Tells the desktop window the page's resolved theme (its window controls follow it); nothing in a browser. */
  readonly setWindowTheme: (dark: boolean) => Effect.Effect<void, PlatformError>
  /** The game's install, maps and plugins folders and how each was found (desktop). */
  readonly gamePaths: Effect.Effect<GamePaths, PlatformError>
  /** Asks for a folder to use as `which` instead of the one found; none when the user cancels. */
  readonly chooseGamePath: (which: GamePathKind) => Effect.Effect<Option.Option<GamePaths>, PlatformError>
  /** Goes back to the folder found through Steam. */
  readonly resetGamePath: (which: GamePathKind) => Effect.Effect<GamePaths, PlatformError>
  /** Shows the folder in the file manager. */
  readonly revealGamePath: (which: GamePathKind) => Effect.Effect<void, PlatformError>
  /** Starts the game through Steam. */
  readonly launchGame: Effect.Effect<void, PlatformError>
  readonly isGameRunning: Effect.Effect<boolean, PlatformError>
  /**
   * The creator name the game writes into maps (the Steam persona name, else the one most maps in the maps folder
   * name) and where it was found (desktop); none in a browser, or when nothing names one.
   */
  readonly findCreator: Effect.Effect<Option.Option<FoundCreator>, PlatformError>
  /** Whether the `ballest-editor-link` plugin Play needs is installed, and as new as the app's copy (desktop). */
  readonly pluginStatus: Effect.Effect<PluginStatus, PlatformError>
  /** Installs the app's copy of the plugin, or updates an older one; fails without the plugin manager. */
  readonly installPlugin: Effect.Effect<InstallPluginResult, PlatformError>
  /**
   * Play: exports a project map as `exportMap` does, asks the plugin to race it and starts the game if it isn't
   * running (desktop). Without the plugin it still exports and starts the game; the result says so.
   */
  readonly play: (fileName: string, options: ExportOptions) => Effect.Effect<PlayResult, PlatformError>
  /** Each end of a game session a Play started or joined (desktop); a browser's ends at once. */
  readonly playSessionEnds: Stream.Stream<PlaySessionEnded, PlatformError>
  /** The notifications kept from earlier runs, newest first (desktop: `notifications.json`); none in a browser. */
  readonly loadNotifications: Effect.Effect<NotificationRecords, PlatformError>
  /** Keeps `records` for the next run (desktop); a browser keeps them in memory only. */
  readonly saveNotifications: (records: NotificationRecords) => Effect.Effect<void, PlatformError>
  /** "Don't show again" for a notification kind, across restarts (desktop); the kinds muted afterwards. */
  readonly muteNotifications: (kind: string) => Effect.Effect<MutedNotificationKinds, PlatformError>
  /** What the Game link found on the last launch (null on the first) and the muted notification kinds (desktop). */
  readonly gameLinkMemory: Effect.Effect<GameLinkMemory, PlatformError>
  /** Keeps what the Game link found, for the next launch to compare with (desktop). */
  readonly rememberGameLink: (result: GameLinkResult) => Effect.Effect<void, PlatformError>
  /** The updater's state now, then every change to it (desktop); a browser's ends at once. */
  readonly updates: Stream.Stream<UpdateState, PlatformError>
  /** Checks for a newer release now and ends with the check; what it found arrives on `updates`. */
  readonly checkForUpdates: Effect.Effect<void, PlatformError>
  /** Starts downloading the release on offer; the progress arrives on `updates`. */
  readonly downloadUpdate: Effect.Effect<void, PlatformError>
  /** Quits the app, installs the downloaded release and starts it. */
  readonly installUpdate: Effect.Effect<void, PlatformError>
}>()("ballest/services/Platform") {
  static readonly layerBrowser = Layer.sync(Platform, () => makeBrowser())

  static readonly layerDesktop = (bridge: DesktopBridge) => Layer.succeed(Platform, makeDesktop(bridge))

  /** The desktop app's preload defines `window.ballest` before any page script runs, so this is decided at load. */
  static readonly layer = Layer.suspend(() => {
    const bridge = typeof window === "undefined" ? undefined : window.ballest
    return bridge === undefined ? Platform.layerBrowser : Platform.layerDesktop(bridge)
  })
}

const browserCapabilities: PlatformCapabilities = {
  projects: false,
  exportToGame: false,
  launchGame: false,
  play: false,
  updates: false
}

/** Main's errors arrive as "Error invoking remote method '<channel>': ProjectError: <message>". */
const bridgeErrorMessage = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message.replace(/^Error invoking remote method '[^']*': /, "").replace(/^\w*Error: /, "")
}

const bridgeCall = <A>(call: () => Promise<A>) =>
  Effect.tryPromise({ try: call, catch: (cause) => new PlatformError({ message: bridgeErrorMessage(cause) }) })

/** Calls bridge method `name` with its payload (none when it takes none); a rejection fails with main's message. */
const invoker = (bridge: DesktopInvoke) => <K extends DesktopMethodName>(name: K, ...args: DesktopArgs<K>) =>
  bridgeCall(() => bridge[name](...args))

const openedMap = (file: OpenedMapFile): OpenedMap => ({
  name: file.name,
  path: Option.some(file.path),
  text: file.text
})

/** A bridge call answering whether it worked; false becomes `message`. */
const bridgeCheck = (call: Effect.Effect<boolean, PlatformError>, message: string) =>
  call.pipe(Effect.filterOrFail((ok) => ok, () => new PlatformError({ message })), Effect.asVoid)

/**
 * Listens before asking for the current state. A state pushed while the request is out is at least as new as its
 * answer, so the answer is then dropped.
 */
const updateStates = (bridge: DesktopBridge) =>
  Stream.callback<UpdateState, PlatformError>((queue) =>
    Effect.gen(function*() {
      const seen = { pushed: false }
      const unsubscribe = bridge.onUpdateState((state) => {
        seen.pushed = true
        Queue.offerUnsafe(queue, state)
      })
      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe))
      const current = yield* invoker(bridge)("getUpdateState")
      if (!seen.pushed) Queue.offerUnsafe(queue, current)
    })
  )

/** What main pushes through one of the bridge's `on…` subscriptions, while the stream runs. */
const pushed = <A>(subscribe: (listener: (value: A) => void) => () => void) =>
  Stream.callback<A, PlatformError>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => subscribe((value) => Queue.offerUnsafe(queue, value))),
      (unsubscribe) => Effect.sync(unsubscribe)
    )
  )

const leave = (kind: UnloadKind) => Effect.sync(() => kind === "close" ? window.close() : window.location.reload())

const makeDesktop = (bridge: DesktopBridge): Platform["Service"] => {
  const call = invoker(bridge)
  return Platform.of({
    capabilities: {
      ...browserCapabilities,
      projects: true,
      exportToGame: true,
      launchGame: true,
      play: true,
      updates: true
    },
    pickMapFile: call("pickImport").pipe(Effect.map((file) => Option.map(Option.fromNullOr(file), openedMap))),
    download: () => Effect.fail(new PlatformError({ message: "The desktop app saves into the project." })),
    projectState: call("projectState"),
    chooseProject: call("chooseProject").pipe(Effect.map(Option.fromNullOr)),
    checkProject: (target) => call("checkProject", target),
    openProjectWindow: (target) => call("openProjectWindow", target),
    switchProject: (path) => call("switchProject", { path }),
    createProject: (project) => call("createProject", project),
    revealProject: (which) =>
      bridgeCheck(call("revealProject", { which }), "The project doesn't have that folder yet."),
    renameProject: (name) => call("renameProject", { name }),
    rememberOpenMap: (fileName) => call("rememberOpenMap", { fileName }),
    listMaps: call("listMaps"),
    readMap: (fileName) => call("readMap", { fileName }),
    createMap: (file) => call("createMap", file),
    saveMap: (file) => call("saveMap", file),
    renameMap: (file) => call("renameMap", file),
    writeSidecar: (file) => call("writeSidecar", file),
    listPrefabs: (tier) => call("listPrefabs", { tier }),
    readPrefab: (ref) => call("readPrefab", ref),
    writePrefab: (payload) => call("writePrefab", payload),
    deletePrefab: (ref) => call("deletePrefab", ref),
    renamePrefab: (payload) => call("renamePrefab", payload),
    revealPrefabs: (tier) => bridgeCheck(call("revealPrefabs", { tier }), "That folder isn't there yet."),
    importMap: (payload) => call("importMap", payload),
    exportMap: (fileName, options) => call("exportMap", { fileName, ...options }),
    checkExports: call("checkExports"),
    reimportMap: (fileName) => call("reimportMap", { fileName }),
    listBackups: call("listBackups"),
    readBackup: ({ place, id }) => call("readBackup", { place, id }),
    listPrefabBackups: call("listPrefabBackups"),
    describePrefabBackup: ({ id, tier }) => call("describePrefabBackup", { id, tier }),
    restorePrefabBackup: ({ id, tier }) => call("restorePrefabBackup", { id, tier }),
    setWindowTheme: (dark) => call("setWindowTheme", { dark }),
    confirmUnsaved: (action, map) => call("confirmUnsaved", unsavedPromptOf(action, map)),
    unloadRequests: pushed((listener) => bridge.onUnloadRequest(listener)),
    leave,
    openExternal: (url) => bridgeCheck(call("openExternal", { url }), `Couldn't open ${url}.`),
    gamePaths: call("gamePaths"),
    chooseGamePath: (which) => call("chooseGamePath", { which }).pipe(Effect.map(Option.fromNullOr)),
    resetGamePath: (which) => call("resetGamePath", { which }),
    revealGamePath: (which) => bridgeCheck(call("revealGamePath", { which }), "Couldn't show that folder."),
    launchGame: bridgeCheck(call("launchGame"), "Couldn't ask Steam to start the game. Is Steam installed?"),
    isGameRunning: call("isGameRunning"),
    findCreator: call("findCreator").pipe(Effect.map(Option.fromNullOr)),
    pluginStatus: call("pluginStatus"),
    installPlugin: call("installPlugin"),
    play: (fileName, options) => call("play", { fileName, ...options }),
    playSessionEnds: pushed((listener) => bridge.onPlaySessionEnded(listener)),
    loadNotifications: call("loadNotifications"),
    saveNotifications: (records) => call("saveNotifications", { records }),
    muteNotifications: (kind) => call("muteNotifications", { kind }),
    gameLinkMemory: call("gameLinkMemory"),
    rememberGameLink: (result) => call("rememberGameLink", result),
    updates: updateStates(bridge),
    checkForUpdates: call("checkForUpdates"),
    downloadUpdate: call("downloadUpdate"),
    installUpdate: call("installUpdate")
  })
}

/** A one-shot `<input type=file>`: resolves with the picked file, or none when the picker is dismissed. */
const pickFile = (accept: string) =>
  Effect.callback<Option.Option<File>>((resume) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = accept
    input.hidden = true
    const done = (file: Option.Option<File>) => {
      input.remove()
      resume(Effect.succeed(file))
    }
    input.addEventListener("change", () => done(Option.fromNullishOr(input.files?.[0])), { once: true })
    input.addEventListener("cancel", () => done(Option.none()), { once: true })
    // Some browsers only open the picker for an input that is in the document.
    document.body.append(input)
    input.click()
    return Effect.sync(() => input.remove())
  })

const download = (name: string, text: string) =>
  Effect.sync(() => {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }))
    const a = document.createElement("a")
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1_000)
  })

const desktopOnly = Effect.fail(new PlatformError({ message: "Only the desktop app can reach the game." }))

const noProject = Effect.fail(new PlatformError({ message: "Only the desktop app keeps maps in a project." }))

/** The SHA-256 of `text` as lowercase hex, as main hashes a file. */
const hashOf = (text: string) =>
  Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    catch: () => new PlatformError({ message: "This browser can't hash a prefab." })
  }).pipe(Effect.map((digest) => [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")))

/**
 * A browser's prefabs: one tier, kept until the page closes (docs/DESKTOP.md § Prefabs). It answers to `user`, so an
 * instance's link has the same shape, and a `project` tier is empty and takes nothing.
 */
const makeMemoryPrefabs = () => {
  const files = new Map<string, PrefabRead>()
  const noneOf = (name: string) => new PlatformError({ message: `${name} doesn't exist any more.` })
  const taken = (name: string) => new PlatformError({ message: `There is already a prefab called ${name}.` })
  const inMemory = (tier: PrefabTier) =>
    tier === "user" ? Effect.void : Effect.fail(new PlatformError({ message: "Only the desktop app has projects." }))
  const infoOf = ({ text: _, ...info }: PrefabRead): PrefabInfo => info
  const write = (name: string, text: string) =>
    hashOf(text).pipe(
      Effect.map((hash) => {
        const file = {
          tier: "user",
          name,
          path: null,
          modifiedAt: new Date().toISOString(),
          hash,
          ...prefabSummaryOf(text),
          text
        } satisfies PrefabRead
        files.set(name, file)
        return infoOf(file)
      })
    )
  const read = ({ name, tier }: PrefabRef) =>
    inMemory(tier).pipe(
      Effect.andThen(Effect.suspend(() => {
        const file = files.get(name)
        return file === undefined ? Effect.fail(noneOf(name)) : Effect.succeed(file)
      }))
    )
  return {
    listPrefabs: (tier: PrefabTier) =>
      Effect.sync(() =>
        tier === "user" ? [...files.values()].map(infoOf).sort((a, b) => a.name.localeCompare(b.name)) : []
      ),
    readPrefab: read,
    writePrefab: ({ name, replace, text, tier }: WritePrefabPayload) =>
      inMemory(tier).pipe(
        Effect.andThen(Effect.suspend(() => !replace && files.has(name) ? Effect.fail(taken(name)) : write(name, text)))
      ),
    deletePrefab: ({ name, tier }: PrefabRef) =>
      inMemory(tier).pipe(Effect.andThen(Effect.sync(() => void files.delete(name)))),
    renamePrefab: ({ from, tier, to }: RenamePrefabPayload) =>
      read({ name: from, tier }).pipe(
        Effect.flatMap(({ text }) => files.has(to) ? Effect.fail(taken(to)) : write(to, text)),
        Effect.tap(() => Effect.sync(() => void files.delete(from)))
      ),
    revealPrefabs: () => Effect.fail(new PlatformError({ message: "Prefabs here are in memory: they have no folder." }))
  }
}

const makeBrowser = (): Platform["Service"] => {
  // a browser has no game to link; "Don't show again" lasts until the page closes
  const muted = new Set<string>()
  return Platform.of({
    ...makeMemoryPrefabs(),
    capabilities: browserCapabilities,
    pickMapFile: pickFile(".balledit,.ballmap,.json").pipe(
      Effect.flatMap(Option.match({
        onNone: () => Effect.succeedNone,
        onSome: (file) =>
          Effect.tryPromise({
            try: () => file.text(),
            catch: () => new PlatformError({ message: `Couldn't read ${file.name}.` })
          }).pipe(Effect.map((text) => Option.some({ name: file.name, path: Option.none(), text })))
      }))
    ),
    download: ({ name, text }) => download(name, text),
    projectState: noProject,
    chooseProject: noProject,
    checkProject: () => noProject,
    openProjectWindow: () => noProject,
    switchProject: () => noProject,
    createProject: () => noProject,
    revealProject: () => noProject,
    renameProject: () => noProject,
    rememberOpenMap: () => Effect.void,
    listMaps: Effect.succeed([]),
    readMap: () => noProject,
    createMap: () => noProject,
    saveMap: () => noProject,
    renameMap: () => noProject,
    writeSidecar: () => noProject,
    importMap: () => noProject,
    exportMap: () => desktopOnly,
    checkExports: Effect.succeed({ changed: [], missing: [] }),
    reimportMap: () => desktopOnly,
    listBackups: Effect.succeed([]),
    readBackup: () => noProject,
    listPrefabBackups: Effect.succeed([]),
    describePrefabBackup: () => desktopOnly,
    restorePrefabBackup: () => desktopOnly,
    setWindowTheme: () => Effect.void,
    confirmUnsaved: (action, map) =>
      Effect.sync(() => window.confirm(discardQuestionOf(action, map)) ? "discard" : "cancel"),
    unloadRequests: Stream.empty,
    leave,
    openExternal: (url) => Effect.sync(() => void window.open(url, "_blank", "noopener,noreferrer")),
    gamePaths: desktopOnly,
    chooseGamePath: () => desktopOnly,
    resetGamePath: () => desktopOnly,
    revealGamePath: () => desktopOnly,
    launchGame: desktopOnly,
    isGameRunning: Effect.succeed(false),
    findCreator: Effect.succeedNone,
    pluginStatus: desktopOnly,
    installPlugin: desktopOnly,
    play: () => desktopOnly,
    playSessionEnds: Stream.empty,
    loadNotifications: Effect.succeed([]),
    saveNotifications: () => Effect.void,
    muteNotifications: (kind) => Effect.sync(() => [...muted.add(kind)]),
    gameLinkMemory: Effect.sync(() => ({ last: null, muted: [...muted] })),
    rememberGameLink: () => Effect.void,
    updates: Stream.empty,
    checkForUpdates: Effect.void,
    downloadUpdate: Effect.void,
    installUpdate: Effect.void
  })
}
