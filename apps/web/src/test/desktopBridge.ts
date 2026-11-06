import type {
  BackupPlace,
  DesktopBridge,
  FoundCreator,
  GameLinkResult,
  GamePaths,
  GameWriteProgress,
  MapBackupFile,
  MapLink,
  NotificationRecords,
  OpenedMapFile,
  PlaySessionEnded,
  PluginStatus,
  PrefabBackup,
  PrefabBackupRef,
  PrefabInfo,
  PrefabTier,
  ProjectInfo,
  ProjectMap,
  ProjectTarget,
  UnloadKind,
  UnsavedChoice,
  UnsavedPrompt,
  UpdateState
} from "@ballest/contracts"
import {
  isMapFileName,
  prefabFileNameOf,
  prefabNameOfFile,
  prefabSummaryOf,
  sidecarFileNameOf
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
  /** `push` tells the page, as main does, that the game session a Play started has ended. */
  readonly playSessions: {
    readonly listeners: Set<(ended: PlaySessionEnded) => void>
    readonly push: (ended: PlaySessionEnded) => void
  }
  /** `push` reports, as main does, how far an Export or a Play has got. */
  readonly gameWriteProgress: {
    readonly listeners: Set<(progress: GameWriteProgress) => void>
    readonly push: (progress: GameWriteProgress) => void
  }
  /** Link records by project, then by map file name, as main keeps them in `.ballest/link.json`. */
  readonly links: Map<string, Map<string, MapLink>>
  /**
   * What main kept of the files it wrote over, newest first: the project's (Save, Rename, Import replacing a map) and
   * the game's maps folder's (Export). Like main, nothing is kept when the bytes don't change.
   */
  readonly backups: Array<MapBackupFile>
  /** What main kept of the prefabs it wrote over, renamed or deleted, oldest first. */
  readonly prefabBackups: Array<PrefabBackup & { readonly text: string }>
  /** How many times the page asked main to check the exports (`checkExports`). */
  exportChecks: number
  /** What `notifications.json` holds. */
  notifications: NotificationRecords
  /**
   * What `desktop-settings.json` holds for the Game link: the last launch's result (null before the first) and the
   * muted notification kinds.
   */
  gameLink: { last: GameLinkResult | null; muted: Array<string> }
  /**
   * The project in use, the recent ones, and the map last open in each (as `desktop-settings.json` keeps them).
   * `chooserRequired`: this window must pick a project, as main decides at start; `openElsewhere`: the folders other
   * windows have open. `windows`: the projects `openProjectWindow` started a window on, and what it fails with next.
   */
  project: {
    current: string | null
    recent: Array<string>
    lastOpenMap: Record<string, string>
    chooserRequired: boolean
    openElsewhere: Array<string>
    windows: Array<string>
    windowFailure: string | null
  }
  /** Names set through `renameProject`, by project folder (what its `ballest-project.json` would say). */
  projectNames: Map<string, string>
  /**
   * `creator`: what `findCreator` answers. `plugin`: the editor-link plugin's status; installing it makes it `current`,
   * counted in `pluginInstalls`. `races`: the maps Play asked the plugin to race (its `play.json`s), in order.
   */
  game: {
    paths: GamePaths
    running: boolean
    launches: number
    creator: FoundCreator | null
    plugin: PluginStatus
    pluginInstalls: number
    races: Array<string>
  }
  /** The updater: `push` sends a new state to the page, as main does. Downloads and installs are counted. */
  readonly updater: {
    state: UpdateState
    readonly listeners: Set<(state: UpdateState) => void>
    readonly push: (state: UpdateState) => void
    checks: number
    downloads: number
    installs: number
  }
}

export const TEST_MAPS_FOLDER = "/game/UserSavedMaps"
export const TEST_PREFABS_FOLDER = "/game/SaveGames/Prefabs"
export const TEST_PROJECTS_FOLDER = "/home/me/Documents/Ballest Editor"
export const TEST_PROJECT = `${TEST_PROJECTS_FOLDER}/My maps`

/** Where a project map is: `<project>/maps/<file name>`. */
export const projectFile = (fileName: string, project = TEST_PROJECT) => `${project}/maps/${fileName}`

/** Where a project map's sidecar is. */
export const sidecarFile = (fileName: string, project = TEST_PROJECT) =>
  projectFile(sidecarFileNameOf(fileName), project)

/** Where a project prefab is: `<project>/prefabs/<name>.json`. */
export const projectPrefabFile = (name: string, project = TEST_PROJECT) =>
  `${project}/prefabs/${prefabFileNameOf(name)}`

/** Where a user prefab is: the game's own prefabs folder. */
export const userPrefabFile = (name: string) => `${TEST_PREFABS_FOLDER}/${prefabFileNameOf(name)}`

/** What an install folder must hold for `chooseGamePath` to take it, as main checks. */
export const GAME_EXE = "Ballest/Binaries/Win64/Ballest-Win64-Shipping.exe"

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
      checkedAt: null,
      message: null
    },
    listeners: new Set(),
    push: (state) => {
      updater.state = state
      updater.listeners.forEach((listener) => listener(state))
    },
    checks: 0,
    downloads: 0,
    installs: 0
  }
  return updater
}

/** Listeners to something main pushes, and a `push` that tells them all. */
const makeTestPush = <A>() => {
  const listeners = new Set<(value: A) => void>()
  return { listeners, push: (value: A) => listeners.forEach((listener) => listener(value)) }
}

export const makeTestDisk = (files: Record<string, string> = {}): TestDisk => ({
  files: new Map(Object.entries(files)),
  answers: [],
  dialogs: [],
  external: [],
  prompts: [],
  promptAnswers: [],
  unload: makeTestPush<UnloadKind>(),
  playSessions: makeTestPush<PlaySessionEnded>(),
  gameWriteProgress: makeTestPush<GameWriteProgress>(),
  links: new Map(),
  backups: [],
  prefabBackups: [],
  exportChecks: 0,
  notifications: [],
  gameLink: { last: null, muted: [] },
  project: {
    current: TEST_PROJECT,
    recent: [],
    lastOpenMap: {},
    chooserRequired: false,
    openElsewhere: [],
    windows: [],
    windowFailure: null
  },
  projectNames: new Map(),
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
    pluginInstalls: 0,
    races: []
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

/** The preload bridge over a `TestDisk`, answering the way main does. `DesktopBridge` makes it list every method. */
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
    name: disk.projectNames.get(path) ?? nameOf(path),
    exists: [...disk.files.keys()].some((file) => file.startsWith(`${path}/maps/`))
  })
  /** The project in use; "" while there is none (Untitled Project), so no file is ever under it. */
  const current = () => disk.project.current ?? ""
  const NO_PROJECT = "There is no project yet: Save the map to name one, or open a project."
  const state = () => ({
    current: disk.project.current === null ? null : info(disk.project.current),
    recent: disk.project.recent.filter((p) => p !== disk.project.current).map((p) => ({
      ...info(p),
      lastOpened: TIME
    })),
    lastOpenMap: disk.project.lastOpenMap[current()] ?? null,
    projectsFolder: TEST_PROJECTS_FOLDER,
    chooserRequired: disk.project.chooserRequired,
    openElsewhere: disk.project.recent.filter((p) => disk.project.openElsewhere.includes(p)),
    startRefused: null
  })
  /** Why `path` can't be opened, as main says; null when it can. */
  const refusalOf = (path: string) =>
    path.startsWith(TEST_MAPS_FOLDER)
      ? `${path} is the game's maps folder or inside it.`
      : disk.project.openElsewhere.includes(path)
      ? `${path} is open in another window.`
      : null
  const select = (path: string) => {
    const refusal = refusalOf(path)
    if (refusal !== null) return fail(refusal)
    disk.project = {
      ...disk.project,
      current: path,
      recent: [path, ...disk.project.recent.filter((p) => p !== path)],
      chooserRequired: false
    }
    return Promise.resolve(state())
  }
  const newProjectPath = (name: string) => `${TEST_PROJECTS_FOLDER}/${name.trim()}`
  /** Refuses `target` as main does; the folder it means otherwise. */
  const folderOf = (target: ProjectTarget) => {
    const path = target._tag === "New" ? target.folder ?? newProjectPath(target.name) : target.path
    const refusal = target._tag === "New" && info(path).exists ? `${path} already holds a project.` : refusalOf(path)
    return refusal === null ? Promise.resolve(path) : fail(refusal)
  }
  const mapOf = (fileName: string): ProjectMap => {
    const text = disk.files.get(projectFile(fileName, current())) ?? ""
    return {
      fileName,
      path: projectFile(fileName, current()),
      modifiedAt: TIME,
      hash: testHash(text),
      publishedFileId: publishedIdOf(text),
      link: linksOf(current()).get(fileName) ?? null
    }
  }
  const has = (fileName: string) => disk.files.has(projectFile(fileName, current()))
  /** Keeps the file at `path` before something else is written there, as main's `Backups` does. */
  const backUp = (place: BackupPlace, path: string, next: string | null) => {
    const old = disk.files.get(path)
    if (old === undefined || old === next) return
    const fileName = nameOf(path)
    disk.backups.unshift({
      place,
      id: `${disk.backups.length} ${fileName}`,
      fileName,
      at: TIME,
      text: old,
      hash: testHash(old),
      sidecar: disk.files.get(sidecarFile(fileName, current())) ?? null
    })
  }
  const write = (fileName: string, text: string) => {
    const path = projectFile(fileName, current())
    backUp("project", path, text)
    disk.files.set(path, text)
    return Promise.resolve(mapOf(fileName))
  }
  const sidecarOf = (fileName: string) => disk.files.get(sidecarFile(fileName, current())) ?? null
  const ask = (kind: TestDisk["dialogs"][number]["kind"]) => {
    disk.dialogs.push({ kind })
    return disk.answers.shift() ?? null
  }
  const exists = (fileName: string) => fail(`The project already has a map called ${fileName}.`)
  const prefabFolder = (tier: PrefabTier) =>
    tier === "user" ? TEST_PREFABS_FOLDER : disk.project.current === null ? null : `${disk.project.current}/prefabs`
  const prefabPath = (tier: PrefabTier, name: string) => {
    const folder = prefabFolder(tier)
    return folder === null ? null : `${folder}/${prefabFileNameOf(name)}`
  }
  const prefabInfo = (tier: PrefabTier, name: string, path: string, text: string): PrefabInfo => ({
    tier,
    name,
    path,
    modifiedAt: TIME,
    hash: testHash(text),
    ...prefabSummaryOf(text)
  })
  const prefabText = (tier: PrefabTier, name: string) => {
    const path = prefabPath(tier, name)
    const text = path === null ? undefined : disk.files.get(path)
    return path === null || text === undefined ? undefined : { path, text }
  }
  /** What is written over goes to the backups, like main. */
  const keepPrefab = (tier: PrefabTier, name: string, path: string) => {
    const text = disk.files.get(path)
    const id = `${disk.prefabBackups.length} ${prefabFileNameOf(name)}`
    if (text !== undefined) disk.prefabBackups.unshift({ tier, id, name, at: TIME, text })
  }
  const prefabBackupOf = ({ id, tier }: PrefabBackupRef) =>
    disk.prefabBackups.find((backup) => backup.id === id && backup.tier === tier)

  const bridge: DesktopBridge = {
    versions: { electron: "test", chrome: "test", node: "test" },
    ping: ({ message }) => Promise.resolve({ message }),
    projectState: () => Promise.resolve(state()),
    chooseProject: () => {
      const path = ask("project")
      if (path === null) return Promise.resolve(null)
      const refusal = refusalOf(path)
      return refusal === null ? Promise.resolve(info(path)) : fail(refusal)
    },
    checkProject: async (target) => {
      await folderOf(target)
    },
    openProjectWindow: async (target) => {
      const path = await folderOf(target)
      if (disk.project.windowFailure !== null) return fail(disk.project.windowFailure)
      disk.project.windows.push(path)
    },
    switchProject: ({ path }) => select(path),
    createProject: async (project) => select(await folderOf({ _tag: "New", ...project })),
    revealProject: ({ which }) => {
      const project = disk.project.current
      if (project === null || !info(project).exists) return Promise.resolve(false)
      disk.external.push(
        which === "project" ? project : which === "maps" ? `${project}/maps` : `${project}/.ballest/backups`
      )
      return Promise.resolve(true)
    },
    revealRecentProject: ({ path }) => {
      if (!disk.project.recent.includes(path)) return fail(`${path} isn't a folder this window knows.`)
      disk.external.push(path)
      return Promise.resolve(true)
    },
    forgetRecentProject: ({ path }) => {
      disk.project.recent = disk.project.recent.filter((p) => p !== path)
      return Promise.resolve(state())
    },
    renameProject: ({ name }) => {
      const project = disk.project.current
      if (project === null) return fail(NO_PROJECT)
      disk.projectNames.set(project, name.trim())
      return Promise.resolve(state())
    },
    rememberOpenMap: ({ fileName }) => {
      const project = disk.project.current
      if (project === null) return Promise.resolve()
      const { [project]: _previous, ...others } = disk.project.lastOpenMap
      disk.project.lastOpenMap = fileName === null ? others : { ...others, [project]: fileName }
      return Promise.resolve()
    },
    listMaps: () => {
      const prefix = `${current()}/maps/`
      return Promise.resolve(
        [...disk.files.keys()]
          .filter((file) => file.startsWith(prefix) && isMapFileName(nameOf(file)))
          .map((file) => mapOf(nameOf(file)))
      )
    },
    readMap: ({ fileName }) => {
      if (disk.project.current === null) return fail(NO_PROJECT)
      const text = disk.files.get(projectFile(fileName, current()))
      return text === undefined
        ? fail(`${projectFile(fileName, current())} doesn't exist any more.`)
        : Promise.resolve({ ...mapOf(fileName), text, sidecar: sidecarOf(fileName) })
    },
    createMap: ({ fileName, text }) => {
      if (has(fileName)) return exists(fileName)
      disk.files.delete(sidecarFile(fileName, current()))
      return write(fileName, text)
    },
    saveMap: ({ fileName, text }) => write(fileName, text),
    renameMap: ({ from, to, text }) => {
      if (disk.project.current === null) return fail(NO_PROJECT)
      if (from === to) return write(to, text)
      if (has(to)) return exists(to)
      backUp("project", projectFile(from, current()), null)
      disk.files.delete(projectFile(from, current()))
      const links = linksOf(current())
      const moved = links.get(from)
      links.delete(from)
      if (moved !== undefined) links.set(to, moved)
      const sidecar = sidecarOf(from)
      disk.files.delete(sidecarFile(from, current()))
      if (sidecar !== null) disk.files.set(sidecarFile(to, current()), sidecar)
      return write(to, text)
    },
    writeSidecar: ({ fileName, text }) => {
      disk.files.set(sidecarFile(fileName, current()), text)
      return Promise.resolve()
    },
    listPrefabs: ({ tier }) => {
      const folder = prefabFolder(tier)
      const entries = [...disk.files].flatMap(([path, text]) => {
        const name = folder !== null && path.startsWith(`${folder}/`)
          ? prefabNameOfFile(path.slice(folder.length + 1))
          : undefined
        return name === undefined ? [] : [prefabInfo(tier, name, path, text)]
      })
      return Promise.resolve(entries.sort((a, b) => a.name.localeCompare(b.name)))
    },
    readPrefab: ({ name, tier }) => {
      const file = prefabText(tier, name)
      return file === undefined
        ? fail(`${name} doesn't exist any more.`)
        : Promise.resolve({ ...prefabInfo(tier, name, file.path, file.text), text: file.text })
    },
    writePrefab: ({ name, replace, text, tier }) => {
      const path = prefabPath(tier, name)
      if (path === null) return fail(NO_PROJECT)
      if (!replace && disk.files.has(path)) return fail(`There is already a prefab called ${name}.`)
      if (disk.files.get(path) !== text) keepPrefab(tier, name, path)
      disk.files.set(path, text)
      return Promise.resolve(prefabInfo(tier, name, path, text))
    },
    deletePrefab: ({ name, tier }) => {
      const path = prefabPath(tier, name)
      if (path !== null) {
        keepPrefab(tier, name, path)
        disk.files.delete(path)
      }
      return Promise.resolve()
    },
    renamePrefab: ({ from, tier, to }) => {
      const file = prefabText(tier, from)
      const next = prefabPath(tier, to)
      if (file === undefined || next === null) return fail(`${from} doesn't exist any more.`)
      if (disk.files.has(next)) return fail(`There is already a prefab called ${to}.`)
      keepPrefab(tier, from, file.path)
      disk.files.delete(file.path)
      disk.files.set(next, file.text)
      return Promise.resolve(prefabInfo(tier, to, next, file.text))
    },
    revealPrefabs: ({ tier }) => {
      const folder = prefabFolder(tier)
      if (folder === null) return Promise.resolve(false)
      disk.external.push(folder)
      return Promise.resolve(true)
    },
    pickImport: () => {
      const path = ask("import")
      if (path === null) return Promise.resolve(null)
      const text = disk.files.get(path)
      if (text === undefined) return fail(`${path} doesn't exist any more.`)
      return Promise.resolve({ path, name: nameOf(path), text } satisfies OpenedMapFile)
    },
    importMap: async ({ source, fileName, text, replace }) => {
      if (disk.project.current === null) return fail(NO_PROJECT)
      if (source === projectFile(fileName, current())) return { _tag: "Imported", map: mapOf(fileName) } as const
      if (has(fileName) && !replace) return { _tag: "Clash", fileName } as const
      const original = disk.files.get(source) ?? ""
      await write(fileName, text)
      disk.files.delete(sidecarFile(fileName, current()))
      const origin = { path: source, hash: testHash(original), at: TIME }
      const fromGame = source === `${TEST_MAPS_FOLDER}/${fileName}`
      const links = linksOf(current())
      links.set(fileName, {
        ...(links.get(fileName) ?? emptyLink),
        origin,
        ...(fromGame && { export: origin, lastSeenHash: origin.hash })
      })
      return { _tag: "Imported", map: mapOf(fileName) } as const
    },
    exportMap: ({ fileName, replacePublished, overwriteChanged }) => {
      const folder = disk.game.paths.mapsFolder.path
      if (folder === null) return Promise.reject(new Error("GamePathError: Couldn't find the game's maps folder."))
      const text = disk.files.get(projectFile(fileName, current()))
      if (text === undefined) return fail(`${projectFile(fileName, current())} doesn't exist any more.`)
      const path = `${folder}/${fileName}`
      const existing = disk.files.get(path)
      const publishedFileId = existing === undefined ? -1 : publishedIdOf(existing)
      if (!replacePublished && publishedFileId > 0) {
        return Promise.resolve({ _tag: "Published", file: { path, name: fileName }, publishedFileId } as const)
      }
      const links = linksOf(current())
      const last = links.get(fileName)
      const seen = existing === undefined ? null : testHash(existing)
      if (
        !overwriteChanged && last?.export?.path === path && seen !== null && seen !== last.export.hash &&
        seen !== testHash(text)
      ) {
        links.set(fileName, { ...last, lastSeenHash: seen })
        return Promise.resolve({ _tag: "ChangedInGame", file: { path, name: fileName } } as const)
      }
      backUp("export", path, text)
      disk.files.set(path, text)
      const exported = { path, hash: testHash(text), at: TIME }
      const link = { ...(links.get(fileName) ?? emptyLink), export: exported, lastSeenHash: exported.hash }
      links.set(fileName, link)
      return Promise.resolve({ _tag: "Exported", file: { path, name: fileName }, link } as const)
    },
    checkExports: () => {
      disk.exportChecks++
      const changed: Array<string> = []
      const missing: Array<string> = []
      const folder = disk.game.paths.mapsFolder.path
      const links = linksOf(current())
      for (const [fileName, link] of links) {
        if (folder === null || link.export?.path !== `${folder}/${fileName}`) continue
        const text = disk.files.get(link.export.path)
        if (text === undefined) {
          links.set(fileName, { ...link, export: null, lastSeenHash: null })
          missing.push(fileName)
        } else if (testHash(text) !== link.lastSeenHash) {
          links.set(fileName, { ...link, lastSeenHash: testHash(text) })
          if (testHash(text) !== link.export.hash) changed.push(fileName)
        }
      }
      return Promise.resolve({ changed, missing })
    },
    reimportMap: async ({ fileName }) => {
      if (disk.project.current === null) return fail(NO_PROJECT)
      const link = linksOf(current()).get(fileName) ?? emptyLink
      const text = link.export === null ? undefined : disk.files.get(link.export.path)
      if (link.export === null || text === undefined) return fail(`${fileName} has no export to re-import.`)
      await write(fileName, text)
      const seen = { ...link.export, hash: testHash(text) }
      linksOf(current()).set(fileName, { ...link, export: seen, lastSeenHash: seen.hash })
      return { ...mapOf(fileName), text, sidecar: sidecarOf(fileName) }
    },
    listBackups: () =>
      Promise.resolve(disk.backups.map(({ hash: _hash, sidecar: _sidecar, text: _, ...backup }) => backup)),
    readBackup: ({ place, id }) => {
      const backup = disk.backups.find((b) => b.place === place && b.id === id)
      return backup === undefined ? fail(`${id} doesn't exist any more.`) : Promise.resolve(backup)
    },
    listPrefabBackups: () => Promise.resolve(disk.prefabBackups.map(({ text: _, ...backup }) => backup)),
    describePrefabBackup: (ref) => {
      const backup = prefabBackupOf(ref)
      return backup === undefined
        ? fail(`${ref.id} doesn't exist any more.`)
        : Promise.resolve(prefabSummaryOf(backup.text))
    },
    restorePrefabBackup: (ref) => {
      const backup = prefabBackupOf(ref)
      const path = backup === undefined ? null : prefabPath(ref.tier, backup.name)
      if (backup === undefined || path === null) return fail(`${ref.id} doesn't exist any more.`)
      if (disk.files.get(path) !== backup.text) keepPrefab(ref.tier, backup.name, path)
      disk.files.set(path, backup.text)
      return Promise.resolve(prefabInfo(ref.tier, backup.name, path, backup.text))
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
    openExternal: ({ url }) => {
      disk.external.push(url)
      return Promise.resolve(true)
    },
    gamePaths: () => Promise.resolve(disk.game.paths),
    chooseGamePath: ({ which }) => {
      const path = ask("folder")
      if (path === null) return Promise.resolve(null)
      if (which === "install" && !disk.files.has(`${path}/${GAME_EXE}`)) {
        return Promise.reject(
          new Error(`Error invoking remote method 'x': GamePathError: ${path} isn't Ballest of Them All's folder.`)
        )
      }
      disk.game.paths = { ...disk.game.paths, [which]: { status: "overridden", path } }
      return Promise.resolve(disk.game.paths)
    },
    resetGamePath: ({ which }) => {
      disk.game.paths = { ...disk.game.paths, [which]: testGamePaths[which] }
      return Promise.resolve(disk.game.paths)
    },
    revealGamePath: ({ which }) => {
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
    play: async ({ fileName, replacePublished, overwriteChanged }) => {
      const publishedFileId = publishedIdOf(disk.files.get(projectFile(fileName, current())) ?? "")
      if (publishedFileId >= 0) return { _tag: "PublishedMap", fileName, publishedFileId } as const
      const exported = await bridge.exportMap({ fileName, replacePublished, overwriteChanged })
      if (exported._tag !== "Exported") return exported
      const { plugin } = disk.game
      const sent = plugin.status === "current" || plugin.status === "outdated"
      if (sent) disk.game.races.push(fileName)
      const launch = disk.game.running ? "running" : "launched"
      if (launch === "launched") disk.game.launches++
      return { _tag: "Played", file: exported.file, link: exported.link, plugin, sent, launch } as const
    },
    onPlaySessionEnded: (listener) => {
      disk.playSessions.listeners.add(listener)
      return () => void disk.playSessions.listeners.delete(listener)
    },
    onGameWriteProgress: (listener) => {
      disk.gameWriteProgress.listeners.add(listener)
      return () => void disk.gameWriteProgress.listeners.delete(listener)
    },
    loadNotifications: () => Promise.resolve(disk.notifications),
    saveNotifications: ({ records }) => {
      disk.notifications = records
      return Promise.resolve()
    },
    muteNotifications: ({ kind }) => {
      if (!disk.gameLink.muted.includes(kind)) disk.gameLink.muted.push(kind)
      return Promise.resolve([...disk.gameLink.muted])
    },
    gameLinkMemory: () => Promise.resolve({ last: disk.gameLink.last, muted: [...disk.gameLink.muted] }),
    rememberGameLink: (result) => {
      disk.gameLink.last = result
      return Promise.resolve()
    },
    getUpdateState: () => Promise.resolve(disk.updater.state),
    checkForUpdates: () => {
      disk.updater.checks++
      return Promise.resolve()
    },
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
  return bridge
}
