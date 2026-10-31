import type {
  DesktopBridge,
  GamePathKind,
  GamePaths,
  MapFileRef,
  OpenedMapFile,
  RecentMapFiles,
  SaveToGameResult
} from "@ballest/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"

export type { GamePath, GamePathKind, GamePaths } from "@ballest/contracts"

/** What this platform can do beyond opening and saving files; the menus hide what it can't. */
export interface PlatformCapabilities {
  /**
   * Native open and save dialogs: the open map keeps its path, Save overwrites it, recent files are listed. In a
   * browser, opening is the file input and saving is a download.
   */
  readonly filePaths: boolean
  /** Finding the game's folders, and writing straight into its UserSavedMaps folder. */
  readonly saveToGame: boolean
  /** Starting the game through Steam. */
  readonly launchGame: boolean
  /** Racing the open map in the game through the plugin manager (#66). */
  readonly play: boolean
}

/** A map file the user opened. `path` is none in a browser, which never sees one. */
export interface OpenedMap {
  readonly name: string
  readonly path: Option.Option<string>
  readonly text: string
}

/** Where a map was saved: its file name (the user may have changed it in the dialog), and its path on desktop. */
export interface SavedMap {
  readonly name: string
  readonly path: Option.Option<string>
}

export class PlatformError extends Schema.TaggedError<PlatformError>()("PlatformError", {
  message: Schema.String
}) {}

/**
 * The renderer's way out of the page: files, links, and later the game. Two implementations behind one interface, so
 * nothing above `services/` asks which one it runs in: `layerBrowser` (file input, download, `window.open`) and
 * `layerDesktop` (the preload bridge, `window.ballest`).
 */
export class Platform extends Context.Service<Platform, {
  readonly capabilities: PlatformCapabilities
  /** Asks for a map file to open; none when the user cancels. */
  readonly openMap: Effect.Effect<Option.Option<OpenedMap>, PlatformError>
  /** Opens a file from `recentMaps` (desktop). */
  readonly openRecent: (path: string) => Effect.Effect<OpenedMap, PlatformError>
  /**
   * Saves `text` as `name`. With `path` (desktop), overwrites that file without asking; without, asks where (desktop)
   * or downloads it (browser). None when the user cancels.
   */
  readonly saveMap: (
    file: { readonly name: string; readonly text: string },
    options: { readonly path: Option.Option<string>; readonly near: Option.Option<string> }
  ) => Effect.Effect<Option.Option<SavedMap>, PlatformError>
  /** Recently opened or saved files, most recent first; always empty in a browser. */
  readonly recentMaps: Effect.Effect<RecentMapFiles, PlatformError>
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
  /**
   * Writes `text` into the game's maps folder as `name`. `Published` (nothing written) when the file there is a
   * published map's draft and `replacePublished` is false.
   */
  readonly saveToGame: (
    file: { readonly name: string; readonly text: string },
    options: { readonly replacePublished: boolean }
  ) => Effect.Effect<SaveToGameResult, PlatformError>
  /** Starts the game through Steam. */
  readonly launchGame: Effect.Effect<void, PlatformError>
  readonly isGameRunning: Effect.Effect<boolean, PlatformError>
}>()("ballest/services/Platform") {
  static readonly layerBrowser = Layer.sync(Platform, () => makeBrowser())

  static readonly layerDesktop = (bridge: DesktopBridge) => Layer.succeed(Platform, makeDesktop(bridge))

  /** The desktop app's preload defines `window.ballest` before any page script runs, so this is decided at load. */
  static readonly layer = Layer.suspend(() => {
    const bridge = typeof window === "undefined" ? undefined : window.ballest
    return bridge === undefined ? Platform.layerBrowser : Platform.layerDesktop(bridge)
  })

  /** The desktop layer over an in-memory disk, with scripted dialog answers. */
  static readonly layerTest = (disk: TestDisk) => Platform.layerDesktop(testBridge(disk))
}

const browserCapabilities: PlatformCapabilities = {
  filePaths: false,
  saveToGame: false,
  launchGame: false,
  play: false
}

/** Main's `MapFileError` arrives as "Error invoking remote method '<channel>': MapFileError: <message>". */
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

const savedMap = (file: MapFileRef): SavedMap => ({ name: file.name, path: Option.some(file.path) })

const makeDesktop = (bridge: DesktopBridge): Platform["Service"] =>
  Platform.of({
    capabilities: { ...browserCapabilities, filePaths: true, saveToGame: true, launchGame: true },
    openMap: bridgeCall(() => bridge.openMap()).pipe(
      Effect.map((file) => Option.map(Option.fromNullOr(file), openedMap))
    ),
    openRecent: (path) => bridgeCall(() => bridge.readMap(path)).pipe(Effect.map(openedMap)),
    saveMap: ({ name, text }, { path, near }) =>
      Option.match(path, {
        onSome: (target) => bridgeCall(() => bridge.writeMap(target, text)).pipe(Effect.map(savedMap), Effect.asSome),
        onNone: () =>
          bridgeCall(() =>
            bridge.saveMap({ name, text, ...Option.match(near, { onNone: () => ({}), onSome: (p) => ({ near: p }) }) })
          )
            .pipe(Effect.map((file) => Option.map(Option.fromNullOr(file), savedMap)))
      }),
    recentMaps: bridgeCall(() => bridge.recentMaps()),
    setWindowTheme: (dark) => bridgeCall(() => bridge.setWindowTheme(dark)),
    openExternal: (url) =>
      bridgeCall(() => bridge.openExternal(url)).pipe(
        Effect.filterOrFail((opened) => opened, () => new PlatformError({ message: `Couldn't open ${url}.` })),
        Effect.asVoid
      ),
    gamePaths: bridgeCall(() => bridge.gamePaths()),
    chooseGamePath: (which) => bridgeCall(() => bridge.chooseGamePath(which)).pipe(Effect.map(Option.fromNullOr)),
    resetGamePath: (which) => bridgeCall(() => bridge.resetGamePath(which)),
    revealGamePath: (which) =>
      bridgeCall(() => bridge.revealGamePath(which)).pipe(
        Effect.filterOrFail((shown) => shown, () => new PlatformError({ message: "Couldn't show that folder." })),
        Effect.asVoid
      ),
    saveToGame: ({ name, text }, { replacePublished }) =>
      bridgeCall(() => bridge.saveToGame({ name, text, replacePublished })),
    launchGame: bridgeCall(() => bridge.launchGame()).pipe(
      Effect.filterOrFail(
        (launched) => launched,
        () => new PlatformError({ message: "Couldn't ask Steam to start the game. Is Steam installed?" })
      ),
      Effect.asVoid
    ),
    isGameRunning: bridgeCall(() => bridge.isGameRunning())
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

const makeBrowser = (): Platform["Service"] =>
  Platform.of({
    capabilities: browserCapabilities,
    openMap: pickFile(".balledit,.ballmap,.json").pipe(
      Effect.flatMap(Option.match({
        onNone: () => Effect.succeedNone,
        onSome: (file) =>
          Effect.tryPromise({
            try: () => file.text(),
            catch: () => new PlatformError({ message: `Couldn't read ${file.name}.` })
          }).pipe(Effect.map((text) => Option.some({ name: file.name, path: Option.none(), text })))
      }))
    ),
    openRecent: () => Effect.fail(new PlatformError({ message: "The browser has no recent files." })),
    saveMap: ({ name, text }) => download(name, text).pipe(Effect.as(Option.some({ name, path: Option.none() }))),
    recentMaps: Effect.succeed([]),
    setWindowTheme: () => Effect.void,
    openExternal: (url) => Effect.sync(() => void window.open(url, "_blank", "noopener,noreferrer")),
    gamePaths: desktopOnly,
    chooseGamePath: () => desktopOnly,
    resetGamePath: () => desktopOnly,
    revealGamePath: () => desktopOnly,
    saveToGame: () => desktopOnly,
    launchGame: desktopOnly,
    isGameRunning: Effect.succeed(false)
  })

/**
 * An in-memory disk for `Platform.layerTest`: `files` by path, and what the next dialogs answer (a path, or null for
 * cancel), taken in order. The disk records what was asked so a test can check it. The game is installed, its maps
 * folder is `/game/UserSavedMaps`, and choosing a folder takes the next answer too.
 */
export interface TestDisk {
  readonly files: Map<string, string>
  readonly answers: Array<string | null>
  readonly dialogs: Array<
    { readonly kind: "open" | "save" | "folder"; readonly name?: string; readonly near?: string }
  >
  readonly recent: Array<string>
  readonly external: Array<string>
  game: { paths: GamePaths; running: boolean; launches: number }
}

export const TEST_MAPS_FOLDER = "/game/UserSavedMaps"

const testGamePaths: GamePaths = {
  install: { status: "found", path: "/game" },
  mapsFolder: { status: "found", path: TEST_MAPS_FOLDER },
  pluginsFolder: { status: "missing", path: "/game/Ballest/Binaries/Win64/plugins" }
}

export const makeTestDisk = (files: Record<string, string> = {}): TestDisk => ({
  files: new Map(Object.entries(files)),
  answers: [],
  dialogs: [],
  recent: [],
  external: [],
  game: { paths: testGamePaths, running: false, launches: 0 }
})

const PublishedId = Schema.fromJsonString(Schema.Struct({
  worldSettings: Schema.Struct({ levelData: Schema.Struct({ levelPublishedFileId: Schema.Finite }) })
}))

/** `levelPublishedFileId` of a map's text, as main reads it before replacing a file in the maps folder. */
const publishedIdOf = (text: string): number =>
  Option.match(Schema.decodeOption(PublishedId)(text), {
    onNone: () => -1,
    onSome: (file) => file.worldSettings.levelData.levelPublishedFileId
  })

const testBridge = (disk: TestDisk): DesktopBridge => {
  const nameOf = (path: string) => path.split(/[\\/]/).pop() ?? path
  const touch = (path: string) => {
    disk.recent.splice(0, disk.recent.length, path, ...disk.recent.filter((p) => p !== path))
  }
  const read = (path: string): Promise<OpenedMapFile> => {
    const text = disk.files.get(path)
    if (text === undefined) return Promise.reject(new Error(`MapFileError: ${path} doesn't exist any more.`))
    touch(path)
    return Promise.resolve({ path, name: nameOf(path), text })
  }
  const write = (path: string, text: string): Promise<MapFileRef> => {
    disk.files.set(path, text)
    touch(path)
    return Promise.resolve({ path, name: nameOf(path) })
  }
  return {
    versions: { electron: "test", chrome: "test", node: "test" },
    ping: (message) => Promise.resolve({ message }),
    openMap: () => {
      disk.dialogs.push({ kind: "open" })
      const path = disk.answers.shift() ?? null
      return path === null ? Promise.resolve(null) : read(path)
    },
    saveMap: ({ name, text, near }) => {
      disk.dialogs.push({ kind: "save", name, ...(near === undefined ? {} : { near }) })
      const path = disk.answers.shift() ?? null
      return path === null ? Promise.resolve(null) : write(path, text)
    },
    readMap: read,
    writeMap: write,
    recentMaps: () => Promise.resolve(disk.recent.map((path) => ({ path, name: nameOf(path) }))),
    setWindowTheme: () => Promise.resolve(),
    openExternal: (url) => {
      disk.external.push(url)
      return Promise.resolve(true)
    },
    gamePaths: () => Promise.resolve(disk.game.paths),
    chooseGamePath: (which) => {
      disk.dialogs.push({ kind: "folder" })
      const path = disk.answers.shift() ?? null
      if (path === null) return Promise.resolve(null)
      disk.game.paths = { ...disk.game.paths, [which]: { status: "overridden", path } }
      return Promise.resolve(disk.game.paths)
    },
    resetGamePath: (which) => {
      disk.game.paths = { ...disk.game.paths, [which]: testGamePaths[which] }
      return Promise.resolve(disk.game.paths)
    },
    revealGamePath: (which) => {
      const { status, path } = disk.game.paths[which]
      if (status !== "missing" && path !== null) disk.external.push(path)
      return Promise.resolve(status !== "missing")
    },
    saveToGame: ({ name, text, replacePublished }) => {
      const folder = disk.game.paths.mapsFolder.path
      if (folder === null) return Promise.reject(new Error("GamePathError: Couldn't find the game's maps folder."))
      const path = `${folder}/${name}`
      const existing = disk.files.get(path)
      const publishedFileId = existing === undefined ? -1 : publishedIdOf(existing)
      if (!replacePublished && publishedFileId > 0) {
        return Promise.resolve({ _tag: "Published", file: { path, name }, publishedFileId } as const)
      }
      return write(path, text).then((file) => ({ _tag: "Saved", file }) as const)
    },
    launchGame: () => {
      disk.game.launches++
      return Promise.resolve(true)
    },
    isGameRunning: () => Promise.resolve(disk.game.running)
  }
}
