/**
 * The IPC handlers over every main-process service, in a temp folder with a fake Steam: what the `*.ipc.test.ts` files
 * drive. Electron's own services are fakes here.
 */
import { NodeServices } from "@effect/platform-node"
import { assert } from "@effect/vitest"
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { ElectronDialog, type FileDialogOptions, type MessageBoxOptions } from "../electron/ElectronDialog"
import { ElectronShell, parseExternalUrl } from "../electron/ElectronShell"
import { ElectronWindow } from "../electron/ElectronWindow"
import { makeFakePluginBundle, makeFakeSteam } from "../game/fakeSteam"
import { GameCreator } from "../game/GameCreator"
import { GameHost } from "../game/GameHost"
import { GameLink } from "../game/GameLink"
import { GamePaths } from "../game/GamePaths"
import { GamePlay } from "../game/GamePlay"
import { GameProcess } from "../game/GameProcess"
import { SteamLibrary } from "../game/SteamLibrary"
import { NotificationLog } from "../notifications/NotificationLog"
import { layerProjectsAt } from "../project/layers"
import { Projects } from "../project/Projects"
import { Recovery } from "../project/Recovery"
import { type WindowEntry, WindowRegistry } from "../project/WindowRegistry"
import { DesktopSettings, DesktopSettingsFile } from "../settings/DesktopSettings"
import { SiteAccount, SiteSeal } from "../site/SiteAccount"
import { SiteClient } from "../site/SiteClient"
import { DesktopUpdates } from "../updates/DesktopUpdates"
import { CollectClient } from "../usage/CollectClient"
import { UsageStats } from "../usage/UsageStats"
import { WindowLauncher, WindowLaunchError } from "../window/WindowLauncher"
import { WindowStage } from "../window/WindowStage"
import { DesktopIpc, type DesktopIpcHandleListener, type DesktopIpcMain } from "./DesktopIpc"
import { installDesktopIpcHandlers } from "./DesktopIpcHandlers"

/** `samples/`, the map fixtures. */
export const samplesDir = `${import.meta.dirname}/../../../../samples`

/** Stands in for Electron's `ipcMain`: keeps the registered listeners so a test can invoke them. */
export const fakeIpcMain = () => {
  const handlers = new Map<string, DesktopIpcHandleListener>()
  const ipcMain: DesktopIpcMain = {
    handle: (channel, listener) => void handlers.set(channel, listener),
    removeHandler: (channel) => void handlers.delete(channel)
  }
  const invoke = (channel: string, raw?: unknown) => {
    const handler = handlers.get(channel)
    if (handler === undefined) return Effect.die(new Error(`no handler on ${channel}`))
    return Effect.tryPromise(() => handler({ sender: { id: 1 } }, raw))
  }
  /** `invoke`, with the result decoded as `schema` (the shape the contract promises the page). */
  const invokeAs = <S extends Schema.Top & { readonly DecodingServices: never }>(
    schema: S,
    channel: string,
    raw?: unknown
  ) => invoke(channel, raw).pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)))
  return { handlers, ipcMain, invoke, invokeAs }
}

/** What `desktop-settings.json` in the test's folder holds. */
export const readSettings = (fs: FileSystem.FileSystem, dir: string) =>
  fs.readFileString(`${dir}/desktop-settings.json`).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(DesktopSettingsFile))),
    Effect.orElseSucceed((): DesktopSettingsFile => ({}))
  )

const hasTag = <A extends { readonly _tag: string }, T extends A["_tag"]>(
  value: A,
  tag: T
): value is Extract<A, { readonly _tag: T }> => value._tag === tag

/** Narrows a tagged result, failing the test on any other tag. */
export const expectTag = <A extends { readonly _tag: string }, T extends A["_tag"]>(value: A, tag: T) =>
  hasTag(value, tag) ? value : assert.fail(`expected ${tag}, got ${value._tag}`)

/**
 * Dialogs that answer from a queue (a path, or null for cancel; a message box, the button's index) and record what
 * they were asked.
 */
const fakeDialogs = () => {
  const answers: Array<string | null> = []
  const asked: Array<FileDialogOptions & { readonly kind: "open" | "save" | "folder" }> = []
  const buttons: Array<number> = []
  const messages: Array<MessageBoxOptions> = []
  const answer = (kind: "open" | "save" | "folder") => (options: FileDialogOptions) =>
    Effect.sync(() => {
      asked.push({ ...options, kind })
      return Option.fromNullishOr(answers.shift())
    })
  const layer = Layer.succeed(
    ElectronDialog,
    ElectronDialog.of({
      showErrorBox: () => Effect.void,
      showOpenFile: answer("open"),
      showOpenFolder: answer("folder"),
      showMessageBox: (options) =>
        Effect.sync(() => {
          messages.push(options)
          return buttons.shift() ?? options.cancelId
        }),
      showSaveFile: answer("save")
    })
  )
  return { answers, asked, buttons, messages, layer }
}

/** What the shell was asked to open: web links, the game, folders. */
export const opened: Array<string> = []
const shellLayer = Layer.succeed(
  ElectronShell,
  ElectronShell.of({
    openExternal: (url) =>
      Effect.sync(() =>
        Option.match(parseExternalUrl(url), {
          onNone: () => false,
          onSome: (href) => opened.push(href) > 0
        })
      ),
    launchGame: Effect.sync(() => opened.push("steam://rungameid/3339810") > 0),
    openFolder: (path) => Effect.sync(() => opened.push(path) > 0)
  })
)

/** Only `setColors` is reached from IPC; it records what each window was given. */
export const recoloured: Array<readonly [number, unknown]> = []
const windowLayer = ElectronWindow.layerTest({
  setColors: (id, colors) => Effect.sync(() => void recoloured.push([id, colors])),
  sendAll: () => Effect.void
})

/** Answers with a fixed state and counts the downloads and installs it was asked for. */
export const updateCalls = { check: 0, download: 0, install: 0 }
const updatesLayer = Layer.succeed(
  DesktopUpdates,
  DesktopUpdates.of({
    state: Effect.succeed({
      status: "available",
      currentVersion: "0.2.0",
      availableVersion: "0.2.1",
      releaseNotes: null,
      releaseDate: null,
      releaseUrl: null,
      downloadPercent: null,
      checkedAt: null,
      message: null
    }),
    run: Effect.die("unused"),
    check: Effect.sync(() => void updateCalls.check++),
    download: Effect.sync(() => void updateCalls.download++),
    install: Effect.sync(() => void updateCalls.install++)
  })
)

/**
 * The collect endpoint, answering from `collectAnswers` (a status and a JSON body) and keeping what it was sent in
 * `collected`. Without an answer queued it makes issue 1.
 */
export const collected: Array<{ readonly url: string; readonly body: unknown }> = []
export const collectAnswers: Array<{ readonly status: number; readonly body?: unknown }> = []
const collectLayer = Layer.succeed(
  CollectClient,
  CollectClient.make(
    Option.some("https://collect.test"),
    { appVersion: "0.3.0", platform: "linux", osVersion: "6.18" },
    (url, init) => {
      collected.push({ url, body: JSON.parse(init.body) })
      const answer = collectAnswers.shift() ?? { status: 200, body: { issueNumber: 1, issueUrl: "https://x/1" } }
      return Promise.resolve(
        answer.body === undefined
          ? new Response(null, { status: answer.status })
          : Response.json(answer.body, { status: answer.status })
      )
    }
  )
)

/**
 * ballestrecords.com, answering each request from `siteAnswers` by its path (a status and a JSON or text body; an
 * `ArrayBuffer` for a thumbnail) and keeping what it was sent in `siteRequests`. A path with no answer queued is a 404.
 */
export const siteRequests: Array<{
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string | FormData | undefined
}> = []
export const siteAnswers = new Map<string, Array<{ readonly status: number; readonly body?: unknown }>>()
const siteLayer = Layer.succeed(
  SiteClient,
  SiteClient.make("https://records.test", (url, init) => {
    siteRequests.push({ method: init.method, url, headers: init.headers, body: init.body })
    const answer = siteAnswers.get(new URL(url).pathname)?.shift() ?? { status: 404, body: { error: "not found" } }
    const { body, status } = answer
    if (body instanceof ArrayBuffer) {
      return Promise.resolve(new Response(body, { status, headers: { "content-type": "image/webp" } }))
    }
    if (typeof body === "string") return Promise.resolve(new Response(body, { status }))
    return Promise.resolve(body === undefined ? new Response(null, { status }) : Response.json(body, { status }))
  })
)

/** Stands in for starting a copy of the app: records each project, and fails while `failing.now` is set. */
const fakeLauncher = () => {
  const started: Array<string> = []
  const failing = { now: false }
  const layer = Layer.succeed(
    WindowLauncher,
    WindowLauncher.of({
      open: (folder) =>
        failing.now
          ? Effect.fail(new WindowLaunchError({ project: folder, cause: new Error("spawn ENOENT") }))
          : Effect.sync(() => void started.push(folder))
    })
  )
  return { started, failing, layer }
}

const TEST_PID = 1000

/** Every service the handlers need, over a temp folder; runs `body` with the handlers installed. */
export const withHandlers = <A, E>(
  body: (env: {
    readonly fake: ReturnType<typeof fakeIpcMain>
    readonly dialogs: ReturnType<typeof fakeDialogs>
    readonly dir: string
    /** The first project, `Documents/Ballest Editor/My maps` in the temp folder, once `createProject` made it. */
    readonly project: string
    readonly steam: Effect.Success<ReturnType<typeof makeFakeSteam>>
    readonly launcher: ReturnType<typeof fakeLauncher>
    /** Says, as a running copy would, that another window (a new one each time) has `project` open; null: Untitled Project. */
    readonly otherWindow: (project: string | null) => Effect.Effect<void>
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
  machine: Parameters<typeof makeFakeSteam>[1] = { game: "steam", ran: true },
  /** `current`: `project` is the project in use already (picked on the welcome window, not yet on disk); `none`: the welcome window. */
  start: "current" | "none" = "current"
) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = yield* fs.makeTempDirectoryScoped()
    const project = path.join(dir, "Documents", "Ballest Editor", "My maps")
    if (start === "current") {
      yield* fs.writeFileString(
        path.join(dir, "desktop-settings.json"),
        JSON.stringify({ project: { recent: [project] } } satisfies DesktopSettingsFile)
      )
    }
    const fake = fakeIpcMain()
    const dialogs = fakeDialogs()
    const launcher = fakeLauncher()
    const windowsDir = path.join(dir, "userData", "windows")
    const registry = Layer.effect(WindowRegistry, WindowRegistry.make(windowsDir, TEST_PID, () => true))
    let nextPid = TEST_PID
    const otherWindow = (folder: string | null) => {
      const entry: WindowEntry = { pid: ++nextPid, project: folder, choosing: false }
      return fs.makeDirectory(windowsDir, { recursive: true }).pipe(
        Effect.andThen(fs.writeFileString(path.join(windowsDir, `${entry.pid}.json`), JSON.stringify(entry))),
        Effect.orDie
      )
    }
    const steam = yield* makeFakeSteam(path.join(dir, "machine"), machine)
    const bundle = yield* makeFakePluginBundle(dir, "0.2.0")
    const game = Layer.mergeAll(GameCreator.layer, Layer.effect(GameLink, GameLink.make(bundle))).pipe(
      Layer.provideMerge(Layer.mergeAll(GamePaths.layer, GameProcess.layer)),
      Layer.provide(SteamLibrary.layer),
      Layer.provide(Layer.succeed(GameHost, GameHost.of(steam.host)))
    )
    const recovery = Layer.effect(Recovery, Recovery.make(path.join(dir, "userData", "recovery")))
    const projects = Layer.merge(
      layerProjectsAt(path.dirname(project), "linux", path.join(dir, "userData", "backups")),
      recovery
    ).pipe(
      Layer.provideMerge(game),
      Layer.provideMerge(registry)
    )
    const usage = Layer.effect(
      UsageStats,
      UsageStats.make(path.join(dir, "userData", "usage-queue.json"), { home: dir, user: "" })
    )
    const account = Layer.effect(SiteAccount, SiteAccount.make(path.join(dir, "userData", "site-account.json"))).pipe(
      Layer.provideMerge(siteLayer),
      Layer.provide(Layer.mergeAll(SiteSeal.plain, shellLayer))
    )
    const services = Layer.mergeAll(Layer.effect(GamePlay, GamePlay.make), usage, account).pipe(
      Layer.provideMerge(projects),
      Layer.provide(Layer.mergeAll(shellLayer, windowLayer)),
      Layer.provideMerge(collectLayer),
      Layer.provideMerge(Layer.effect(DesktopSettings, DesktopSettings.make(path.join(dir, "desktop-settings.json")))),
      Layer.merge(Layer.mergeAll(
        dialogs.layer,
        shellLayer,
        windowLayer,
        updatesLayer,
        launcher.layer,
        WindowStage.layer,
        Layer.effect(NotificationLog, NotificationLog.make(path.join(dir, "notifications.json"))),
        DesktopIpc.layer(fake.ipcMain)
      ))
    )
    yield* Effect.scoped(
      Effect.gen(function*() {
        yield* installDesktopIpcHandlers()
        // every launch starts on the welcome window, so the project in use is the one it picked
        if (start === "current") yield* Effect.flatMap(Effect.service(Projects), (service) => service.use(project))
        yield* body({ fake, dialogs, dir, project, steam, launcher, otherWindow })
      })
    ).pipe(Effect.provide(services))
    return fake
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
