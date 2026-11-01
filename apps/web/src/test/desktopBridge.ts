import type {
  BackupPlace,
  DesktopBridge,
  FoundCreator,
  GamePaths,
  MapBackupFile,
  MapLink,
  NotificationRecords,
  OpenedMapFile,
  PluginStatus,
  ProjectInfo,
  ProjectMap,
  UnloadKind,
  UnsavedChoice,
  UnsavedPrompt,
  UpdateState
} from "@ballest/contracts"
import { Option, Schema } from "effect"

/**
 * An in-memory desktop for tests: `files` by path, and what the next dialogs answer (a path, or null for cancel), taken
 * in order. It records what was asked so a test can check it. The project is `TEST_PROJECT` (not on disk until the
 * first map is written), the game is installed and its maps folder is `TEST_MAPS_FOLDER`.
 */
export interface TestDisk {
  readonly files: Map<string, string>
  readonly answers: Array<string | null>
  readonly dialogs: Array<{ readonly kind: "import" | "project" | "folder" }>
  readonly external: Array<string>
  /** The unsaved-changes prompts shown, and what the next ones answer (Cancel once the list runs out). */
  readonly prompts: Array<UnsavedPrompt>
  readonly promptAnswers: Array<UnsavedChoice>
  /** `push` tells the page, as main does, that it held a close or a reload. */
  readonly unload: {
    readonly listeners: Set<(kind: UnloadKind) => void>
    readonly push: (kind: UnloadKind) => void
  }
  /** Link records by project, then by map file name, as main keeps them in `.ballest/link.json`. */
  readonly links: Map<string, Map<string, MapLink>>
  /**
   * What main kept of the files it wrote over, newest first: the project's (Save, Rename, Import replacing a map) and
   * the game's maps folder's (Export). Like main, nothing is kept when the bytes don't change.
   */
  readonly backups: Array<MapBackupFile>
  /** What `notifications.json` holds. */
  notifications: NotificationRecords
  project: { current: string; recent: Array<string> }
  /**
   * `creator`: what `findCreator` answers. `plugin`: the editor-link plugin's status; installing it makes it `current`,
   * counted in `pluginInstalls`.
   */
  game: {
    paths: GamePaths
    running: boolean
    launches: number
    creator: FoundCreator | null
    plugin: PluginStatus
    pluginInstalls: number
  }
  /** The updater: `push` sends a new state to the page, as main does. Downloads and installs are counted. */
  readonly updater: {
    state: UpdateState
    readonly listeners: Set<(state: UpdateState) => void>
    readonly push: (state: UpdateState) => void
    downloads: number
    installs: number
  }
}

export const TEST_MAPS_FOLDER = "/game/UserSavedMaps"
export const TEST_PROJECT = "/home/me/Documents/Ballest Editor/Maps"

/** Where a project map is: `<project>/maps/<file name>`. */
export const projectFile = (fileName: string, project = TEST_PROJECT) => `${project}/maps/${fileName}`

const testGamePaths: GamePaths = {
  install: { status: "found", path: "/game" },
  mapsFolder: { status: "found", path: TEST_MAPS_FOLDER },
  pluginsFolder: { status: "missing", path: "/game/Ballest/Binaries/Win64/plugins" }
}

const makeTestUpdater = (): TestDisk["updater"] => {
  const updater: TestDisk["updater"] = {
    state: {
      status: "idle",
      currentVersion: "0.2.0",
      availableVersion: null,
      releaseNotes: null,
      releaseDate: null,
      releaseUrl: null,
      downloadPercent: null,
      message: null
    },
    listeners: new Set(),
    push: (state) => {
      updater.state = state
      updater.listeners.forEach((listener) => listener(state))
    },
    downloads: 0,
    installs: 0
  }
  return updater
}

const makeTestUnload = (): TestDisk["unload"] => {
  const listeners = new Set<(kind: UnloadKind) => void>()
  return { listeners, push: (kind) => listeners.forEach((listener) => listener(kind)) }
}

export const makeTestDisk = (files: Record<string, string> = {}): TestDisk => ({
  files: new Map(Object.entries(files)),
  answers: [],
  dialogs: [],
  external: [],
  prompts: [],
  promptAnswers: [],
  unload: makeTestUnload(),
  links: new Map(),
  backups: [],
  notifications: [],
  project: { current: TEST_PROJECT, recent: [] },
  game: {
    paths: testGamePaths,
    running: false,
    launches: 0,
    creator: null,
    plugin: {
      status: "missing",
      bundledVersion: "0.2.0",
      installedVersion: null,
      folder: "/game/Ballest/Binaries/Win64/plugins/ballest-editor-link"
    },
    pluginInstalls: 0
  },
  updater: makeTestUpdater()
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

/** Stands in for SHA-256: 64 hex digits that differ when the text does. */
export const testHash = (text: string): string => {
  let h = 0x811c9dc5
  for (const char of text) h = Math.imul(h ^ char.codePointAt(0)!, 0x01000193) >>> 0
  return h.toString(16).padStart(8, "0").repeat(8)
}

const TIME = "2026-10-31T12:00:00.000Z"
const emptyLink: MapLink = { origin: null, export: null, lastSeenHash: null }
const nameOf = (path: string) => path.split(/[\\/]/).pop() ?? path
const fail = (message: string) =>
  Promise.reject(new Error(`Error invoking remote method 'x': ProjectError: ${message}`))

/** The preload bridge over a `TestDisk`, answering the way main does. */
export const testBridge = (disk: TestDisk): DesktopBridge => {
  const linksOf = (project: string) => {
    const existing = disk.links.get(project)
    if (existing !== undefined) return existing
    const created = new Map<string, MapLink>()
    disk.links.set(project, created)
    return created
  }
  const info = (path: string): ProjectInfo => ({
    path,
    name: nameOf(path),
    exists: [...disk.files.keys()].some((file) => file.startsWith(`${path}/maps/`)),
    isDefault: path === TEST_PROJECT
  })
  const state = () => {
    const others = disk.project.recent.filter((p) => p !== disk.project.current)
    const recent = others.includes(TEST_PROJECT) || disk.project.current === TEST_PROJECT
      ? others
      : [...others, TEST_PROJECT]
    return { current: info(disk.project.current), recent: recent.map(info) }
  }
  const select = (path: string) => {
    if (path.startsWith(TEST_MAPS_FOLDER)) return fail(`${path} is the game's maps folder or inside it.`)
    disk.project = { current: path, recent: [path, ...disk.project.recent.filter((p) => p !== path)] }
    return Promise.resolve(state())
  }
  const mapOf = (fileName: string): ProjectMap => {
    const text = disk.files.get(projectFile(fileName, disk.project.current)) ?? ""
    return {
      fileName,
      path: projectFile(fileName, disk.project.current),
      modifiedAt: TIME,
      hash: testHash(text),
      publishedFileId: publishedIdOf(text),
      link: linksOf(disk.project.current).get(fileName) ?? null
    }
  }
  const has = (fileName: string) => disk.files.has(projectFile(fileName, disk.project.current))
  /** Keeps the file at `path` before something else is written there, as main's `Backups` does. */
  const backUp = (place: BackupPlace, path: string, next: string | null) => {
    const old = disk.files.get(path)
    if (old === undefined || old === next) return
    const fileName = nameOf(path)
    disk.backups.unshift({ place, id: `${disk.backups.length} ${fileName}`, fileName, at: TIME, text: old })
  }
  const write = (fileName: string, text: string) => {
    const path = projectFile(fileName, disk.project.current)
    backUp("project", path, text)
    disk.files.set(path, text)
    return Promise.resolve(mapOf(fileName))
  }
  const ask = (kind: TestDisk["dialogs"][number]["kind"]) => {
    disk.dialogs.push({ kind })
    return disk.answers.shift() ?? null
  }
  const exists = (fileName: string) => fail(`The project already has a map called ${fileName}.`)

  return {
    versions: { electron: "test", chrome: "test", node: "test" },
    ping: (message) => Promise.resolve({ message }),
    projectState: () => Promise.resolve(state()),
    chooseProject: () => {
      const path = ask("project")
      return path === null ? Promise.resolve(null) : select(path)
    },
    switchProject: select,
    revealProject: () => {
      const { current } = disk.project
      if (!info(current).exists) return Promise.resolve(false)
      disk.external.push(`${current}/maps`)
      return Promise.resolve(true)
    },
    listMaps: () => {
      const prefix = `${disk.project.current}/maps/`
      return Promise.resolve(
        [...disk.files.keys()].filter((file) => file.startsWith(prefix)).map((file) => mapOf(nameOf(file)))
      )
    },
    readMap: (fileName) => {
      const text = disk.files.get(projectFile(fileName, disk.project.current))
      return text === undefined
        ? fail(`${projectFile(fileName, disk.project.current)} doesn't exist any more.`)
        : Promise.resolve({ ...mapOf(fileName), text })
    },
    createMap: ({ fileName, text }) => has(fileName) ? exists(fileName) : write(fileName, text),
    saveMap: ({ fileName, text }) => write(fileName, text),
    renameMap: ({ from, to, text }) => {
      if (from === to) return write(to, text)
      if (has(to)) return exists(to)
      backUp("project", projectFile(from, disk.project.current), null)
      disk.files.delete(projectFile(from, disk.project.current))
      const links = linksOf(disk.project.current)
      const moved = links.get(from)
      links.delete(from)
      if (moved !== undefined) links.set(to, moved)
      return write(to, text)
    },
    pickImport: () => {
      const path = ask("import")
      if (path === null) return Promise.resolve(null)
      const text = disk.files.get(path)
      if (text === undefined) return fail(`${path} doesn't exist any more.`)
      return Promise.resolve({ path, name: nameOf(path), text } satisfies OpenedMapFile)
    },
    importMap: async ({ source, fileName, text, replace }) => {
      if (has(fileName) && !replace) return { _tag: "Clash", fileName } as const
      const original = disk.files.get(source) ?? ""
      await write(fileName, text)
      const origin = { path: source, hash: testHash(original), at: TIME }
      const fromGame = source === `${TEST_MAPS_FOLDER}/${fileName}`
      const links = linksOf(disk.project.current)
      links.set(fileName, {
        ...(links.get(fileName) ?? emptyLink),
        origin,
        ...(fromGame && { export: origin, lastSeenHash: origin.hash })
      })
      return { _tag: "Imported", map: mapOf(fileName) } as const
    },
    exportMap: ({ fileName, replacePublished }) => {
      const folder = disk.game.paths.mapsFolder.path
      if (folder === null) return Promise.reject(new Error("GamePathError: Couldn't find the game's maps folder."))
      const text = disk.files.get(projectFile(fileName, disk.project.current))
      if (text === undefined) return fail(`${projectFile(fileName, disk.project.current)} doesn't exist any more.`)
      const path = `${folder}/${fileName}`
      const existing = disk.files.get(path)
      const publishedFileId = existing === undefined ? -1 : publishedIdOf(existing)
      if (!replacePublished && publishedFileId > 0) {
        return Promise.resolve({ _tag: "Published", file: { path, name: fileName }, publishedFileId } as const)
      }
      backUp("export", path, text)
      disk.files.set(path, text)
      const exported = { path, hash: testHash(text), at: TIME }
      const links = linksOf(disk.project.current)
      const link = { ...(links.get(fileName) ?? emptyLink), export: exported, lastSeenHash: exported.hash }
      links.set(fileName, link)
      return Promise.resolve({ _tag: "Exported", file: { path, name: fileName }, link } as const)
    },
    listBackups: () => Promise.resolve(disk.backups.map(({ text: _, ...backup }) => backup)),
    readBackup: ({ place, id }) => {
      const backup = disk.backups.find((b) => b.place === place && b.id === id)
      return backup === undefined ? fail(`${id} doesn't exist any more.`) : Promise.resolve(backup)
    },
    setWindowTheme: () => Promise.resolve(),
    confirmUnsaved: (prompt) => {
      disk.prompts.push(prompt)
      return Promise.resolve(disk.promptAnswers.shift() ?? "cancel")
    },
    onUnloadRequest: (listener) => {
      disk.unload.listeners.add(listener)
      return () => void disk.unload.listeners.delete(listener)
    },
    openExternal: (url) => {
      disk.external.push(url)
      return Promise.resolve(true)
    },
    gamePaths: () => Promise.resolve(disk.game.paths),
    chooseGamePath: (which) => {
      const path = ask("folder")
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
    launchGame: () => {
      disk.game.launches++
      return Promise.resolve(true)
    },
    isGameRunning: () => Promise.resolve(disk.game.running),
    findCreator: () => Promise.resolve(disk.game.creator),
    pluginStatus: () => Promise.resolve(disk.game.plugin),
    installPlugin: () => {
      const { plugin } = disk.game
      if (plugin.status === "noGame" || plugin.status === "noPluginManager") {
        return Promise.reject(new Error("GameLinkError: The Ballest plugin manager isn't installed."))
      }
      disk.game.pluginInstalls++
      disk.game.plugin = { ...plugin, status: "current", installedVersion: plugin.bundledVersion }
      return Promise.resolve({ plugin: disk.game.plugin, restartGame: disk.game.running })
    },
    loadNotifications: () => Promise.resolve(disk.notifications),
    saveNotifications: (records) => {
      disk.notifications = records
      return Promise.resolve()
    },
    getUpdateState: () => Promise.resolve(disk.updater.state),
    downloadUpdate: () => {
      disk.updater.downloads++
      return Promise.resolve()
    },
    installUpdate: () => {
      disk.updater.installs++
      return Promise.resolve()
    },
    onUpdateState: (listener) => {
      disk.updater.listeners.add(listener)
      return () => void disk.updater.listeners.delete(listener)
    }
  }
}
