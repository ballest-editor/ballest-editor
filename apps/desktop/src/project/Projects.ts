import {
  CHARACTERS_PER_FILE,
  type CreateProjectPayload,
  type FileLimit,
  isMapFileName,
  isProjectName,
  MAP_EXTENSIONS,
  type OpenMaps,
  PREFAB_NAME_RULE,
  type ProjectFolder,
  type ProjectInfo,
  type ProjectState,
  type ProjectTarget,
  type RecentProject
} from "@ballest/contracts"
import { Context, DateTime, Effect, FileSystem, Option, Path, Ref, Schema } from "effect"
import { GamePaths } from "../game/GamePaths"
import { DesktopSettings, type ProjectSettings } from "../settings/DesktopSettings"
import { isSamePath, isWithin, writeJson } from "./files"
import { type WindowEntry, WindowRegistry } from "./WindowRegistry"
import { decideStart } from "./windowStart"

/** `ballest-project.json`, at the project's root: what is shared with the project (docs/PROJECTS.md). */
const ProjectFile = Schema.Struct({
  formatVersion: Schema.Literal(1),
  name: Schema.String,
  /** The creator new maps get; unset, Settings › General's. */
  defaultCreator: Schema.optionalKey(Schema.String),
  /** Where Export writes: the game's maps folder (a folder of the user's choosing comes later). */
  exportTarget: Schema.Literal("game")
})
type ProjectFile = typeof ProjectFile.Type

const PROJECT_FILE = "ballest-project.json"

const NO_OPEN_MAPS: OpenMaps = { files: [], active: null }

/** What the settings keep of a project's open maps, without anything a hand edit left that isn't a map file name. */
const validOpenMaps = (kept: { readonly files: ReadonlyArray<string>; readonly active: string | null } | undefined) => {
  const files = (kept?.files ?? []).filter(isMapFileName)
  const active = kept?.active ?? null
  return { files, active: active !== null && files.includes(active) ? active : null } satisfies OpenMaps
}
const RECENT_LIMIT = 8

/** The error of every project operation: `Projects`, `MapFiles`, `Prefabs` and `MapExports` alike. */
export class ProjectError extends Schema.TaggedError<ProjectError>()("ProjectError", {
  path: Schema.String,
  reason: Schema.Literals([
    "inGameMaps",
    "fileName",
    "exists",
    "prefabExists",
    "prefabName",
    "noProject",
    "projectExists",
    "projectName",
    "notFound",
    "notPicked",
    "extension",
    "tooLarge",
    "read",
    "write",
    "notExported",
    "exportChanged",
    "openElsewhere",
    "notFolder"
  ]),
  cause: Schema.optional(Schema.Defect()),
  /** `tooLarge`: the characters the file was held to. */
  limit: Schema.optional(Schema.Finite)
}) {
  override get message(): string {
    switch (this.reason) {
      case "inGameMaps":
        return `${this.path} is the game's maps folder or inside it. The game rewrites the maps it finds there, so a project can't live in it: choose another folder, and use Export to game to put a map there.`
      case "fileName":
        return `${this.path} isn't a map file name (a .balledit name, no folders).`
      case "exists":
        return `The project already has a map called ${this.path}.`
      case "prefabExists":
        return `There is already a prefab called ${this.path}.`
      case "prefabName":
        return `${this.path} isn't a prefab name (${PREFAB_NAME_RULE}).`
      case "noProject":
        return "There is no project yet: Save the map to name one, or open a project."
      case "projectExists":
        return `${this.path} already holds a project. Open it instead, or choose another name.`
      case "projectName":
        return `${this.path} can't name a folder: use letters, digits, spaces, - and _.`
      case "notFound":
        return `${this.path} doesn't exist any more.`
      case "notPicked":
        return `${this.path} wasn't picked in a dialog.`
      case "extension":
        return `${this.path} isn't a map file (${MAP_EXTENSIONS.join(", ")}).`
      case "tooLarge":
        return `${this.path} has more characters than the game loads (${
          this.limit ?? CHARACTERS_PER_FILE
        }), so it can't be a map.`
      case "read":
        return `Couldn't read ${this.path}.`
      case "write":
        return `Couldn't write ${this.path}.`
      case "notExported":
        return `${this.path} has no export in the game's maps folder to re-import.`
      case "exportChanged":
        return `${this.path} changed in the game again just now. Try again.`
      case "openElsewhere":
        return `${this.path} is open in another window. A project opens in one window at a time: close it there first, or choose another project.`
      case "notFolder":
        return `${this.path} isn't a folder on this machine, so it can't be opened as a project.`
    }
  }
}

/** A `ProjectError` about `file`, from the failure's cause (if any): `Effect.mapError(projectError("read", file))`. */
export const projectError = (reason: ProjectError["reason"], file: string) => (cause?: unknown) =>
  new ProjectError({ path: file, reason, ...(cause === undefined ? {} : { cause }) })

/** The `ProjectError` of a file past `limit`, which it can't be a map with. */
export const tooLargeError = (file: string, { charactersPerFile }: FileLimit) =>
  new ProjectError({ path: file, reason: "tooLarge", limit: charactersPerFile })

/** The `ProjectError` of a file that wouldn't read: it has gone, or something else went wrong. */
export const readError = (file: string) => (cause: { readonly reason: { readonly _tag: string } }) =>
  projectError(cause.reason._tag === "NotFound" ? "notFound" : "read", file)(cause)

/** A project's `maps/` folder. */
export const mapsFolderIn = (path: Path.Path, project: string) => path.join(project, "maps")

/** A project's backups folder, `.ballest/backups/`. */
export const backupsFolderIn = (path: Path.Path, project: string) => path.join(project, ".ballest", "backups")

/** A project's map thumbnails, `.ballest/thumbnails/`. */
export const thumbnailsFolderIn = (path: Path.Path, project: string) => path.join(project, ".ballest", "thumbnails")

/**
 * Which project is in use (docs/PROJECTS.md). A window has one project, and a project one window: it starts where
 * `decideStart` says and keeps its project whatever another running copy does; with none the window is Untitled Project
 * and nothing is on disk until the first Save names a project (`createNew`), or it must choose one
 * (`ProjectState.chooserRequired`). A project exists on disk from `createNew`, or from the first Save or Import into a
 * chosen folder (`ensure`). A project is never the game's maps folder or inside it, nor one another window has open.
 * Its maps are `MapFiles`', their exports `MapExports`'.
 */
export class Projects extends Context.Service<Projects, {
  readonly state: Effect.Effect<ProjectState>
  /**
   * Uses `folder` as the project from now on; refused when it is the game's maps folder or inside it, or another window
   * has it open.
   */
  readonly use: (folder: string) => Effect.Effect<ProjectState, ProjectError>
  /** Takes a folder the user picked in a dialog, for `switchTo` and `prepareWindow`, refused as `use` refuses it. */
  readonly pick: (folder: string) => Effect.Effect<ProjectInfo, ProjectError>
  /** Uses a recent project or a picked folder; any other folder is refused. */
  readonly switchTo: (folder: string) => Effect.Effect<ProjectState, ProjectError>
  /** Refuses `target` as opening it would, changing nothing. */
  readonly check: (target: ProjectTarget) => Effect.Effect<void, ProjectError>
  /** `target`'s folder for a new window to start on, made on disk when it is a new project. This window doesn't use it. */
  readonly prepareWindow: (target: ProjectTarget) => Effect.Effect<string, ProjectError>
  /** A recent or picked folder, when it exists; any other folder is refused. */
  readonly knownFolder: (folder: string) => Effect.Effect<Option.Option<string>, ProjectError>
  /** Keeps the map tabs open in the current project (`ProjectState.openMaps`); nothing without a project. */
  readonly rememberOpenMaps: (openMaps: OpenMaps) => Effect.Effect<void, ProjectError>
  /**
   * The projects in the projects folder (`Documents/Ballest Editor`), by name: each folder in it that holds a
   * `ballest-project.json`. Listed, a folder can be opened as a recent one can.
   */
  readonly listFolder: Effect.Effect<ReadonlyArray<RecentProject>>
  /** Takes `folder` off the recent projects; nothing on disk changes. */
  readonly forget: (folder: string) => Effect.Effect<ProjectState, ProjectError>
  /**
   * Makes a project called `name` and uses it: in `folder`, one `pick` took, or `<projectsFolder>/<name>` without one.
   * Fails when the folder holds a project already.
   */
  readonly createNew: (project: CreateProjectPayload) => Effect.Effect<ProjectState, ProjectError>
  /** Renames the current project in its `ballest-project.json` (made first if it isn't on disk yet). */
  readonly setName: (name: string) => Effect.Effect<ProjectState, ProjectError>
  /** One of the current project's folders, when it exists: the project, its `maps/`, its backups. */
  readonly folderOf: (which: ProjectFolder) => Effect.Effect<Option.Option<string>>
  /** The project in use, or none while the window is Untitled Project. */
  readonly current: Effect.Effect<Option.Option<string>>
  /** The project in use; fails (`noProject`) without one. */
  readonly inUse: Effect.Effect<string, ProjectError>
  /** The project in use, made on disk if it isn't yet; fails without one. Anything that writes into a project. */
  readonly ensure: Effect.Effect<string, ProjectError>
}>()("ballest/desktop/project/Projects") {
  /**
   * `platform` decides how paths compare (Windows: case-insensitively). `launchProject` is the `--project` this window
   * was started with: it goes straight there, unless the folder is refused or open in another window.
   */
  static readonly make = Effect.fn("Projects.make")(function*(
    projectsFolder: string,
    platform: NodeJS.Platform,
    launchProject: Option.Option<string> = Option.none()
  ) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const settings = yield* DesktopSettings
    const game = yield* GamePaths
    const windows = yield* WindowRegistry

    const same = (a: string, b: string) => isSamePath(path, a, b, platform)
    const isOpenIn = (open: ReadonlyArray<WindowEntry>, folder: string) =>
      open.some((window) => window.project !== null && same(window.project, folder))

    const remembered = settings.get.pipe(Effect.map((s): ProjectSettings => s.project ?? {}))

    /** Refuses the game's maps folder and anything inside it (wherever it is now, found or not). */
    const outsideGame = Effect.fnUntraced(function*(folder: string) {
      const maps = (yield* game.get).mapsFolder.path
      if (maps !== null && isWithin(path, maps, folder, platform)) return yield* projectError("inGameMaps", folder)()
    })

    /** Refuses a folder another window has open. */
    const free = Effect.fnUntraced(function*(folder: string) {
      if (isOpenIn(yield* windows.others, folder)) return yield* projectError("openElsewhere", folder)()
    })

    /** `project` with `recent` as its recent projects, and `lastOpened` times for those alone. */
    const withRecent = (
      project: ProjectSettings | undefined,
      recent: ReadonlyArray<string>,
      lastOpened: Readonly<Record<string, string>> = project?.lastOpened ?? {}
    ): ProjectSettings => ({
      ...project,
      recent,
      lastOpened: Object.fromEntries(Object.entries(lastOpened).filter(([folder]) => recent.includes(folder)))
    })

    const remember = Effect.fnUntraced(function*(folder: string) {
      const now = DateTime.formatIso(yield* DateTime.now)
      return yield* settings.update((s) => {
        const others = (s.project?.recent ?? []).filter((p) => !same(p, folder))
        const recent = [folder, ...others].slice(0, RECENT_LIMIT)
        return { ...s, project: withRecent(s.project, recent, { ...s.project?.lastOpened, [folder]: now }) }
      })
    })

    /** The `--project` folder, absolute and there; anything else on the command line is refused here. */
    const launchFolder = Effect.fnUntraced(function*(raw: string) {
      if (!path.isAbsolute(raw)) return yield* projectError("notFolder", raw)()
      const folder = path.resolve(raw)
      const found = yield* fs.stat(folder).pipe(Effect.mapError(projectError("notFolder", raw)))
      if (found.type !== "Directory") return yield* projectError("notFolder", raw)()
      yield* outsideGame(folder)
      return folder
    })

    const launch = yield* Option.match(launchProject, {
      onNone: () => Effect.succeed({ requested: null, refused: null }),
      onSome: (raw) =>
        launchFolder(raw).pipe(
          Effect.map((requested) => ({ requested, refused: null })),
          Effect.catch((error) => Effect.succeed({ requested: null, refused: error.message }))
        )
    })

    const startWith = (others: ReadonlyArray<WindowEntry>) => decideStart({ requested: launch.requested, others, same })
    const looked = startWith(yield* windows.others)
    yield* windows.announce({ project: looked.project, choosing: looked.chooser })
    // A copy starting at this very moment may have looked before this one announced, and this one before it. Each sees
    // the other by now, so the lower pid keeps what they both took and the other shows the chooser.
    const settled = startWith((yield* windows.others).filter((window) => window.pid < windows.pid))
    const start = looked.chooser ? looked : settled
    if (start.chooser && !looked.chooser) yield* windows.announce({ project: null, choosing: true })
    if (start.project !== null && start.project === launch.requested) {
      yield* remember(start.project).pipe(
        Effect.catchTag("DesktopSettingsWriteError", (error) => Effect.logWarning(error.message, error.cause))
      )
    }

    // This window's project, for as long as it runs: only this window's own choices move it. Settings are shared with
    // any other running copy, so they can't be what says.
    const inWindow = yield* Ref.make(Option.fromNullOr(start.project))
    const chooserRequired = yield* Ref.make(start.chooser)
    // Folders the user picked in a dialog this run: with the recent ones, all a page may name by path.
    const picked = yield* Ref.make<ReadonlyArray<string>>([])
    const current: Effect.Effect<Option.Option<string>> = Ref.get(inWindow)
    const inUse: Effect.Effect<string, ProjectError> = current.pipe(
      Effect.flatMap(Effect.fromOption),
      Effect.mapError(projectError("noProject", projectsFolder))
    )

    const info = (folder: string) =>
      fs.readFileString(path.join(folder, PROJECT_FILE)).pipe(
        Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(ProjectFile))),
        Effect.map((file) => ({ name: file.name, exists: true })),
        Effect.orElseSucceed(() => ({ name: path.basename(folder), exists: false })),
        Effect.map((found): ProjectInfo => ({ path: folder, ...found }))
      )

    const state = Effect.gen(function*() {
      const { recent = [], lastOpened = {}, openMaps = {} } = yield* remembered
      const folder = Option.getOrUndefined(yield* current)
      const others = folder === undefined ? recent : recent.filter((p) => !same(p, folder))
      const open = yield* windows.others
      return {
        current: folder === undefined ? null : yield* info(folder),
        openMaps: folder === undefined ? NO_OPEN_MAPS : validOpenMaps(openMaps[folder]),
        recent: yield* Effect.forEach(
          others,
          (p) => Effect.map(info(p), (found) => ({ ...found, lastOpened: lastOpened[p] ?? null }))
        ),
        projectsFolder,
        chooserRequired: yield* Ref.get(chooserRequired),
        openElsewhere: others.filter((p) => isOpenIn(open, p)),
        startRefused: launch.refused
      } satisfies ProjectState
    })

    const rememberOpenMaps = Effect.fn("Projects.rememberOpenMaps")(function*(openMaps: OpenMaps) {
      const bad = [...openMaps.files, ...openMaps.active === null ? [] : [openMaps.active]].find((name) =>
        !isMapFileName(name) || !openMaps.files.includes(name)
      )
      if (bad !== undefined) return yield* projectError("fileName", bad)()
      const project = Option.getOrNull(yield* current)
      if (project === null) return
      yield* settings.update((s) => ({
        ...s,
        project: { ...s.project, openMaps: { ...s.project?.openMaps, [project]: openMaps } }
      })).pipe(Effect.mapError(projectError("write", project)))
    })

    const use = Effect.fn("Projects.use")(function*(raw: string) {
      const folder = path.resolve(raw)
      yield* outsideGame(folder)
      yield* free(folder)
      yield* remember(folder).pipe(Effect.mapError(projectError("write", raw)))
      yield* Ref.set(inWindow, Option.some(folder))
      yield* Ref.set(chooserRequired, false)
      yield* windows.announce({ project: folder, choosing: false })
      return yield* state
    })

    const pick = Effect.fn("Projects.pick")(function*(raw: string) {
      const folder = path.resolve(raw)
      yield* outsideGame(folder)
      yield* free(folder)
      yield* Ref.update(picked, (folders) => [...folders, folder])
      return yield* info(folder)
    })

    /** Refuses a folder that is neither a recent project nor one picked in a dialog: the page can't name any other. */
    const known = Effect.fnUntraced(function*(raw: string) {
      const { recent = [] } = yield* remembered
      if (![...recent, ...yield* Ref.get(picked)].some((p) => same(p, raw))) {
        return yield* projectError("notPicked", raw)()
      }
    })

    const switchTo = Effect.fn("Projects.switchTo")(function*(raw: string) {
      yield* known(raw)
      return yield* use(raw)
    })

    const knownFolder = Effect.fn("Projects.knownFolder")(function*(raw: string) {
      yield* known(raw)
      const found = yield* fs.exists(raw).pipe(Effect.orElseSucceed(() => false))
      return found ? Option.some(raw) : Option.none()
    })

    const listFolder = Effect.gen(function*() {
      const entries = yield* fs.readDirectory(projectsFolder).pipe(Effect.orElseSucceed((): Array<string> => []))
      const { lastOpened = {} } = yield* remembered
      const found = yield* Effect.forEach(entries, (entry) => {
        const folder = path.join(projectsFolder, entry)
        return fs.exists(path.join(folder, PROJECT_FILE)).pipe(
          Effect.orElseSucceed(() => false),
          Effect.flatMap((isProject) => isProject ? Effect.map(info(folder), (p) => [p]) : Effect.succeed([]))
        )
      })
      const projects = found.flat().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      // a folder main listed is one the page may name, as a picked one is
      yield* Ref.update(picked, (folders) => [...folders, ...projects.map((p) => p.path)])
      return projects.map((p): RecentProject => ({
        ...p,
        lastOpened: Object.entries(lastOpened).find(([folder]) => same(folder, p.path))?.[1] ?? null
      }))
    })

    const forget = Effect.fn("Projects.forget")(function*(raw: string) {
      yield* settings.update((s) => ({
        ...s,
        project: withRecent(s.project, (s.project?.recent ?? []).filter((p) => !same(p, raw)))
      })).pipe(Effect.mapError(projectError("write", raw)))
      return yield* state
    })

    /**
     * Makes `project` on disk if it isn't yet: `maps/`, `.ballest/`, `ballest-project.json` (called `name`, by default
     * after its folder) and `.gitignore`.
     */
    const ensureAt = Effect.fnUntraced(function*(project: string, name: string = path.basename(project)) {
      yield* outsideGame(project)
      const writeIfMissing = (file: string, write: Effect.Effect<void, unknown>) =>
        fs.exists(file).pipe(Effect.flatMap((exists) => exists ? Effect.void : write))
      yield* Effect.gen(function*() {
        yield* fs.makeDirectory(mapsFolderIn(path, project), { recursive: true })
        yield* fs.makeDirectory(path.join(project, ".ballest"), { recursive: true })
        const file: ProjectFile = { formatVersion: 1, name, exportTarget: "game" }
        yield* writeIfMissing(path.join(project, PROJECT_FILE), writeJson(fs, path.join(project, PROJECT_FILE), file))
        yield* writeIfMissing(
          path.join(project, ".gitignore"),
          fs.writeFileString(path.join(project, ".gitignore"), ".ballest/\n")
        )
      }).pipe(Effect.mapError(projectError("write", project)))
      return project
    })

    const ensure = inUse.pipe(Effect.flatMap((project) => ensureAt(project)))

    const setName = Effect.fn("Projects.setName")(function*(name: string) {
      const trimmed = name.trim()
      if (trimmed === "" || trimmed.length > 64) return yield* projectError("projectName", name)()
      const project = yield* ensure
      const file = path.join(project, PROJECT_FILE)
      const current_ = yield* fs.readFileString(file).pipe(
        Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(ProjectFile))),
        Effect.mapError(projectError("read", file))
      )
      yield* writeJson(fs, file, { ...current_, name: trimmed }).pipe(Effect.mapError(projectError("write", file)))
      return yield* state
    })

    const folderOf = (which: ProjectFolder) =>
      current.pipe(
        Effect.flatMap(Option.match({
          onNone: () => Effect.succeed(Option.none<string>()),
          onSome: (project) => {
            const dir = which === "project"
              ? project
              : which === "maps"
              ? mapsFolderIn(path, project)
              : backupsFolderIn(path, project)
            return fs.exists(dir).pipe(
              Effect.map((found) => found ? Option.some(dir) : Option.none()),
              Effect.orElseSucceed(Option.none)
            )
          }
        }))
      )

    /** The folder New project would make, refused when it can't; nothing is written. */
    const newFolder = Effect.fnUntraced(function*({ folder: chosen, name }: CreateProjectPayload) {
      const trimmed = name.trim()
      if (!isProjectName(trimmed)) return yield* projectError("projectName", name)()
      if (chosen !== undefined) yield* known(chosen)
      const folder = chosen === undefined ? path.join(projectsFolder, trimmed) : path.resolve(chosen)
      const taken = yield* fs.exists(path.join(folder, PROJECT_FILE)).pipe(Effect.orElseSucceed(() => false))
      if (taken) return yield* projectError("projectExists", folder)()
      yield* outsideGame(folder)
      yield* free(folder)
      return folder
    })

    const createNew = Effect.fn("Projects.createNew")(function*(project: CreateProjectPayload) {
      const folder = yield* newFolder(project)
      yield* ensureAt(folder, project.name.trim())
      return yield* use(folder)
    })

    /** `target`'s folder, refused as opening it would be. */
    const folderOfTarget = Effect.fnUntraced(function*(target: ProjectTarget) {
      if (target._tag === "New") return yield* newFolder(target)
      yield* known(target.path)
      yield* outsideGame(target.path)
      yield* free(target.path)
      return target.path
    })

    const check = Effect.fn("Projects.check")(function*(target: ProjectTarget) {
      yield* folderOfTarget(target)
    })

    const prepareWindow = Effect.fn("Projects.prepareWindow")(function*(target: ProjectTarget) {
      const folder = yield* folderOfTarget(target)
      return target._tag === "New" ? yield* ensureAt(folder, target.name.trim()) : folder
    })

    return Projects.of({
      state,
      use,
      pick,
      switchTo,
      check,
      prepareWindow,
      knownFolder,
      forget,
      listFolder,
      rememberOpenMaps,
      createNew,
      setName,
      folderOf,
      current,
      inUse,
      ensure
    })
  })
}
