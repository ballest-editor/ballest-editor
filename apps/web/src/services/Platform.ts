import type {
  DesktopBridge,
  ExportMapResult,
  FoundCreator,
  GamePathKind,
  GamePaths,
  ImportMapPayload,
  ImportMapResult,
  InstallPluginResult,
  OpenedMapFile,
  PluginStatus,
  ProjectMap,
  ProjectMapFile,
  ProjectMaps,
  ProjectState,
  UnloadKind,
  UnsavedChoice,
  UpdateState
} from "@ballest/contracts"
import { Context, Effect, Layer, Option, Queue, Schema, Stream } from "effect"
import { discardQuestionOf, type UnsavedAction, unsavedPromptOf } from "../domain/unsaved"

export type {
  FoundCreator,
  GamePath,
  GamePathKind,
  GamePaths,
  InstallPluginResult,
  PluginStatus,
  ProjectMap,
  ProjectMapFile,
  ProjectState,
  UnloadKind,
  UnsavedChoice
} from "@ballest/contracts"

/** What this platform can do; the menus hide what it can't. */
export interface PlatformCapabilities {
  /**
   * A project folder on disk (docs/PROJECTS.md): New map saves into it, Save writes there, Import copies a file in. A
   * browser has none: one map in memory, Open is the file input and Export is a download.
   */
  readonly projects: boolean
  /** Finding the game's folders, and exporting a map into its UserSavedMaps folder. */
  readonly exportToGame: boolean
  /** Starting the game through Steam. */
  readonly launchGame: boolean
  /** Racing the open map in the game through the plugin manager (#66). */
  readonly play: boolean
  /** Updating itself from GitHub Releases; whether this build actually does is the update state's `disabled`. */
  readonly updates: boolean
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
  /** Asks for a folder to use as the project; none when the user cancels. */
  readonly chooseProject: Effect.Effect<Option.Option<ProjectState>, PlatformError>
  /** Goes back to a recent project, or the default. */
  readonly switchProject: (path: string) => Effect.Effect<ProjectState, PlatformError>
  /** Shows the project's maps folder in the file manager. */
  readonly revealProject: Effect.Effect<void, PlatformError>
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
  /** Copies a picked file into the project. `Clash` (nothing written) when it has a map of that name and not `replace`. */
  readonly importMap: (payload: ImportMapPayload) => Effect.Effect<ImportMapResult, PlatformError>
  /**
   * Copies a project map into the game's maps folder and records the export. `Published` (nothing written) when the
   * file there is a published map's draft and `replacePublished` is false.
   */
  readonly exportMap: (
    fileName: string,
    options: { readonly replacePublished: boolean }
  ) => Effect.Effect<ExportMapResult, PlatformError>
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
  /** The updater's state now, then every change to it (desktop); a browser's ends at once. */
  readonly updates: Stream.Stream<UpdateState, PlatformError>
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

const openedMap = (file: OpenedMapFile): OpenedMap => ({
  name: file.name,
  path: Option.some(file.path),
  text: file.text
})

/** A bridge call answering whether it worked; false becomes `message`. */
const bridgeCheck = (call: () => Promise<boolean>, message: string) =>
  bridgeCall(call).pipe(Effect.filterOrFail((ok) => ok, () => new PlatformError({ message })), Effect.asVoid)

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
      const current = yield* bridgeCall(() => bridge.getUpdateState())
      if (!seen.pushed) Queue.offerUnsafe(queue, current)
    })
  )

const unloadRequests = (bridge: DesktopBridge) =>
  Stream.callback<UnloadKind, PlatformError>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => bridge.onUnloadRequest((kind) => Queue.offerUnsafe(queue, kind))),
      (unsubscribe) => Effect.sync(unsubscribe)
    )
  )

const leave = (kind: UnloadKind) => Effect.sync(() => kind === "close" ? window.close() : window.location.reload())

const makeDesktop = (bridge: DesktopBridge): Platform["Service"] =>
  Platform.of({
    capabilities: { ...browserCapabilities, projects: true, exportToGame: true, launchGame: true, updates: true },
    pickMapFile: bridgeCall(() => bridge.pickImport()).pipe(
      Effect.map((file) => Option.map(Option.fromNullOr(file), openedMap))
    ),
    download: () => Effect.fail(new PlatformError({ message: "The desktop app saves into the project." })),
    projectState: bridgeCall(() => bridge.projectState()),
    chooseProject: bridgeCall(() => bridge.chooseProject()).pipe(Effect.map(Option.fromNullOr)),
    switchProject: (path) => bridgeCall(() => bridge.switchProject(path)),
    revealProject: bridgeCheck(() => bridge.revealProject(), "The project has no maps folder yet."),
    listMaps: bridgeCall(() => bridge.listMaps()),
    readMap: (fileName) => bridgeCall(() => bridge.readMap(fileName)),
    createMap: (file) => bridgeCall(() => bridge.createMap(file)),
    saveMap: (file) => bridgeCall(() => bridge.saveMap(file)),
    renameMap: (file) => bridgeCall(() => bridge.renameMap(file)),
    importMap: (payload) => bridgeCall(() => bridge.importMap(payload)),
    exportMap: (fileName, { replacePublished }) => bridgeCall(() => bridge.exportMap({ fileName, replacePublished })),
    setWindowTheme: (dark) => bridgeCall(() => bridge.setWindowTheme(dark)),
    confirmUnsaved: (action, map) => bridgeCall(() => bridge.confirmUnsaved(unsavedPromptOf(action, map))),
    unloadRequests: unloadRequests(bridge),
    leave,
    openExternal: (url) => bridgeCheck(() => bridge.openExternal(url), `Couldn't open ${url}.`),
    gamePaths: bridgeCall(() => bridge.gamePaths()),
    chooseGamePath: (which) => bridgeCall(() => bridge.chooseGamePath(which)).pipe(Effect.map(Option.fromNullOr)),
    resetGamePath: (which) => bridgeCall(() => bridge.resetGamePath(which)),
    revealGamePath: (which) => bridgeCheck(() => bridge.revealGamePath(which), "Couldn't show that folder."),
    launchGame: bridgeCheck(
      () => bridge.launchGame(),
      "Couldn't ask Steam to start the game. Is Steam installed?"
    ),
    isGameRunning: bridgeCall(() => bridge.isGameRunning()),
    findCreator: bridgeCall(() => bridge.findCreator()).pipe(Effect.map(Option.fromNullOr)),
    pluginStatus: bridgeCall(() => bridge.pluginStatus()),
    installPlugin: bridgeCall(() => bridge.installPlugin()),
    updates: updateStates(bridge),
    downloadUpdate: bridgeCall(() => bridge.downloadUpdate()),
    installUpdate: bridgeCall(() => bridge.installUpdate())
  })

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

const makeBrowser = (): Platform["Service"] =>
  Platform.of({
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
    switchProject: () => noProject,
    revealProject: noProject,
    listMaps: Effect.succeed([]),
    readMap: () => noProject,
    createMap: () => noProject,
    saveMap: () => noProject,
    renameMap: () => noProject,
    importMap: () => noProject,
    exportMap: () => desktopOnly,
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
    updates: Stream.empty,
    downloadUpdate: Effect.void,
    installUpdate: Effect.void
  })
