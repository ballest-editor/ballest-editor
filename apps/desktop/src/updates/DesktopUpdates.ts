import { UpdateState } from "@ballest/contracts"
import { Config, Context, Effect, Layer, Option, Ref, Schema, type Scope, Semaphore } from "effect"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { ElectronUpdater } from "../electron/ElectronUpdater"
import { ElectronWindow } from "../electron/ElectronWindow"
import { UPDATE_STATE_CHANNEL } from "../ipc/channels"
import * as Machine from "./updateMachine"

const STARTUP_DELAY = "15 seconds"
const POLL_INTERVAL = "4 minutes"

/** Where tools/release's mock update server (`pnpm release:mock-server`) listens unless told otherwise. */
export const MOCK_UPDATE_SERVER_PORT = 4848

/** Read from the environment once, when the service is built. An empty variable counts as unset. */
const UpdateConfig = Config.all({
  disabledByEnv: Config.Boolean("BALLEST_DISABLE_AUTO_UPDATE").pipe(Config.withDefault(false)),
  /** Use the mock update server instead of the packaged feed (GitHub Releases). */
  mock: Config.Boolean("BALLEST_MOCK_UPDATES").pipe(Config.withDefault(false)),
  mockPort: Config.Port("BALLEST_MOCK_UPDATE_SERVER_PORT").pipe(Config.withDefault(MOCK_UPDATE_SERVER_PORT)),
  appImage: Config.String("APPIMAGE").pipe(Config.option)
})

const encodeState = Schema.encodeEffect(UpdateState)

/**
 * The in-app updater (docs/DESKTOP.md § Packaging and release): checks GitHub Releases, downloads when the user asks
 * and installs on their restart. Every state change is pushed to the page on `UPDATE_STATE_CHANNEL`.
 */
export class DesktopUpdates extends Context.Service<DesktopUpdates, {
  readonly state: Effect.Effect<UpdateState>
  /** Checks 15 s from now and every 4 minutes after, until the scope closes. Nothing when disabled. */
  readonly run: Effect.Effect<void, never, Scope.Scope>
  /** Checks the feed now, unless a release is already on offer or one is being checked. */
  readonly check: Effect.Effect<void>
  /** Starts downloading the release on offer and returns. Nothing unless `available`. */
  readonly download: Effect.Effect<void>
  /** Installs the downloaded release and quits. Nothing unless `ready`. */
  readonly install: Effect.Effect<void>
}>()("ballest/desktop/updates/DesktopUpdates") {
  static readonly layer = Layer.effect(
    DesktopUpdates,
    Effect.gen(function*() {
      const environment = yield* DesktopEnvironment
      const updater = yield* ElectronUpdater
      const windows = yield* ElectronWindow
      // Downloads outlive the IPC call that started them; they stop with the app.
      const scope = yield* Effect.scope
      const config = yield* UpdateConfig.pipe(
        Effect.catch((error) =>
          Effect.logWarning("Updates are off: invalid update settings", error.message).pipe(
            Effect.as({ disabledByEnv: true, mock: false, mockPort: MOCK_UPDATE_SERVER_PORT, appImage: Option.none() })
          )
        )
      )
      const disabled = Machine.disabledReason({ ...environment, ...config })

      const ref = yield* Ref.make(Machine.initialState(environment.appVersion, disabled))
      // One change at a time, each sent before the next is made, so the page never ends on a stale state.
      const lock = yield* Semaphore.make(1)
      const apply = (f: (state: UpdateState) => UpdateState) =>
        Ref.updateAndGet(ref, f).pipe(
          Effect.flatMap(encodeState),
          Effect.flatMap((encoded) => windows.sendAll(UPDATE_STATE_CHANNEL, encoded)),
          Effect.orDie
        )
      const update = (f: (state: UpdateState) => UpdateState) => lock.withPermits(1)(apply(f))
      /** Applies `f` and returns true when `when` holds for the current state; otherwise leaves it. */
      const transition = (when: (state: UpdateState) => boolean, f: (state: UpdateState) => UpdateState) =>
        lock.withPermits(1)(
          Ref.get(ref).pipe(
            Effect.flatMap((state) => when(state) ? apply(f).pipe(Effect.as(true)) : Effect.succeed(false))
          )
        )

      const check = Effect.gen(function*() {
        if (!(yield* transition(Machine.canCheck, Machine.onCheckStart))) return
        const found = yield* updater.checkForUpdates.pipe(
          Effect.tapError((error) => update((state) => Machine.onCheckFailed(state, error.message))),
          Effect.option,
          Effect.map(Option.flatten)
        )
        const state = yield* Ref.get(ref)
        if (state.status !== "checking") return
        yield* Option.match(found, {
          onNone: () => update(Machine.onUpToDate),
          onSome: (info) =>
            update((current) =>
              Machine.onAvailable(current, info.version, Machine.releaseNotesText(info.releaseNotes, info.version))
            ).pipe(Effect.tap(() => Effect.logInfo(`Update ${info.version} available`)))
        })
      }).pipe(Effect.withSpan("DesktopUpdates.check"))

      // The callback comes from electron-updater's emitter, outside any fiber.
      const runFork = Effect.runForkWith(yield* Effect.context())
      let lastPercent = -1
      const onProgress = (percent: number) => {
        const whole = Math.floor(percent)
        if (whole === lastPercent) return
        lastPercent = whole
        runFork(update((state) => state.status === "downloading" ? Machine.onDownloadProgress(state, whole) : state))
      }

      const download = Effect.gen(function*() {
        if (!(yield* transition((state) => state.status === "available", Machine.onDownloadStart))) return
        lastPercent = -1
        yield* updater.downloadUpdate(onProgress).pipe(
          Effect.matchEffect({
            onSuccess: () => update(Machine.onDownloaded),
            onFailure: (error) =>
              Effect.logWarning(error.message).pipe(
                Effect.andThen(update((state) => Machine.onDownloadFailed(state, error.message)))
              )
          }),
          Effect.forkIn(scope)
        )
      }).pipe(Effect.withSpan("DesktopUpdates.download"))

      const install = Effect.gen(function*() {
        if ((yield* Ref.get(ref)).status !== "ready") return
        yield* updater.quitAndInstall.pipe(
          Effect.catch((error) =>
            Effect.logWarning(error.message).pipe(
              Effect.andThen(update((state) => Machine.onInstallFailed(state, error.message)))
            )
          )
        )
      }).pipe(Effect.withSpan("DesktopUpdates.install"))

      const run = Effect.gen(function*() {
        if (Option.isSome(disabled)) {
          yield* Effect.logInfo(disabled.value)
          return
        }
        const feed = config.mock ? Option.some(new URL(`http://127.0.0.1:${config.mockPort}/`)) : Option.none()
        yield* updater.configure({ feed })
        if (Option.isSome(feed)) yield* Effect.logInfo(`Checking for updates on ${feed.value.href}`)
        yield* Effect.sleep(STARTUP_DELAY).pipe(
          Effect.andThen(check),
          Effect.andThen(Effect.sleep(POLL_INTERVAL).pipe(Effect.andThen(check), Effect.forever)),
          Effect.forkScoped
        )
      })

      return DesktopUpdates.of({ state: Ref.get(ref), run, check, download, install })
    })
  )
}
