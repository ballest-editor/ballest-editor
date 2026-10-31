import { UpdateState } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Deferred, Effect, Layer, Option, Schema, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { vi } from "vitest"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { ElectronUpdater, ElectronUpdaterError, type UpdateInfo } from "../electron/ElectronUpdater"
import { ElectronWindow } from "../electron/ElectronWindow"
import { UPDATE_STATE_CHANNEL } from "../ipc/channels"
import { DesktopUpdates } from "./DesktopUpdates"

// The fakes below replace every service that calls Electron; only the module imports need stand-ins.
vi.mock("electron", () => ({}))
vi.mock("electron-updater", () => ({}))

const installedBuild = {
  isPackaged: true,
  platform: "win32" as NodeJS.Platform,
  devServerUrl: Option.none(),
  isDevelopment: false,
  appVersion: "0.2.0",
  userData: "/user",
  settingsPath: "/user/desktop-settings.json",
  preloadPath: "/app/preload.cjs",
  rendererDir: "/app/web",
  assetsDir: Option.none(),
  pluginDir: "/resources/plugins/ballest-editor-link"
}

/** An updater whose feed answers from `releases` and whose downloads finish when the test says so. */
const fakeUpdater = () => {
  const fake = {
    feeds: [] as Array<Option.Option<string>>,
    /** What the next checks find, in order: a release, nothing, or a failure. */
    releases: [] as Array<UpdateInfo | null | Error>,
    checks: 0,
    onProgress: (_percent: number) => {},
    download: undefined as Deferred.Deferred<void, ElectronUpdaterError> | undefined,
    installs: 0,
    installFailure: undefined as Error | undefined
  }
  const layer = Layer.succeed(
    ElectronUpdater,
    ElectronUpdater.of({
      configure: ({ feed }) => Effect.sync(() => void fake.feeds.push(Option.map(feed, (url) => url.href))),
      checkForUpdates: Effect.suspend(() => {
        fake.checks++
        const next = fake.releases.shift() ?? null
        return next instanceof Error
          ? Effect.fail(new ElectronUpdaterError({ operation: "check", cause: next }))
          : Effect.succeed(Option.fromNullOr(next))
      }),
      downloadUpdate: (onProgress) =>
        Effect.gen(function*() {
          fake.onProgress = onProgress
          fake.download = yield* Deferred.make<void, ElectronUpdaterError>()
          yield* Deferred.await(fake.download)
        }),
      quitAndInstall: Effect.suspend(() => {
        fake.installs++
        return fake.installFailure === undefined
          ? Effect.void
          : Effect.fail(new ElectronUpdaterError({ operation: "install", cause: fake.installFailure }))
      })
    })
  )
  return { fake, layer }
}

/** Every state main pushed to the page, in order. */
const fakeWindows = () => {
  const sent: Array<UpdateState> = []
  const decode = Schema.decodeUnknownSync(UpdateState)
  const layer = ElectronWindow.layerTest({
    sendAll: (channel, payload) =>
      Effect.sync(() => {
        assert.strictEqual(channel, UPDATE_STATE_CHANNEL)
        sent.push(decode(payload))
      })
  })
  return { sent, layer }
}

const withUpdates = <A, E>(
  options: { readonly env?: Record<string, string>; readonly build?: Partial<typeof installedBuild> },
  body: (env: {
    readonly updates: DesktopUpdates["Service"]
    readonly fake: ReturnType<typeof fakeUpdater>["fake"]
    readonly sent: Array<UpdateState>
  }) => Effect.Effect<A, E, Scope.Scope>
) => {
  const updater = fakeUpdater()
  const windows = fakeWindows()
  return Effect.gen(function*() {
    const updates = yield* DesktopUpdates
    return yield* body({ updates, fake: updater.fake, sent: windows.sent })
  }).pipe(
    Effect.scoped,
    Effect.provide(DesktopUpdates.layer.pipe(
      Layer.provide(Layer.mergeAll(
        updater.layer,
        windows.layer,
        Layer.succeed(DesktopEnvironment, DesktopEnvironment.of({ ...installedBuild, ...options.build })),
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: options.env ?? {} }))
      ))
    ))
  )
}

/** Lets forked work (a download, a progress event) run to its next wait. */
const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { discard: true })

describe("DesktopUpdates", () => {
  it.effect("does nothing in an unpackaged build, on a non-AppImage Linux, or when turned off", () =>
    Effect.gen(function*() {
      const cases = [
        { build: { isPackaged: false } },
        { build: { platform: "linux" as const } },
        { env: { BALLEST_DISABLE_AUTO_UPDATE: "1" } },
        // A setting that doesn't parse turns updates off rather than stopping the app.
        { env: { BALLEST_MOCK_UPDATE_SERVER_PORT: "nope" } }
      ]
      for (const options of cases) {
        yield* withUpdates(options, ({ updates, fake }) =>
          Effect.gen(function*() {
            yield* updates.run
            yield* TestClock.adjust("1 hour")
            assert.strictEqual((yield* updates.state).status, "disabled")
            assert.deepStrictEqual([fake.feeds.length, fake.checks], [0, 0])
          }))
      }
    }))

  it.effect("checks 15 s after start and every 4 minutes until a release is on offer", () =>
    withUpdates(
      { build: { platform: "linux" }, env: { APPIMAGE: "/home/me/Ballest-Editor.AppImage" } },
      ({ updates, fake, sent }) =>
        Effect.gen(function*() {
          fake.releases.push(null, new Error("net::ERR_INTERNET_DISCONNECTED\nmore detail"), {
            version: "0.2.1",
            releaseNotes: "<p>Fixes &amp; features</p>"
          })
          yield* updates.run
          assert.deepStrictEqual(fake.feeds, [Option.none()])
          yield* TestClock.adjust("14 seconds")
          assert.strictEqual(fake.checks, 0)
          yield* TestClock.adjust("1 second")
          assert.strictEqual((yield* updates.state).status, "idle")
          yield* TestClock.adjust("4 minutes")
          assert.deepInclude(yield* updates.state, {
            status: "error",
            message: "Couldn't check for the update: net::ERR_INTERNET_DISCONNECTED"
          })
          yield* TestClock.adjust("4 minutes")
          assert.deepStrictEqual(yield* updates.state, {
            status: "available",
            currentVersion: "0.2.0",
            availableVersion: "0.2.1",
            releaseNotes: "Fixes & features",
            downloadPercent: null,
            message: null
          })
          yield* TestClock.adjust("1 hour")
          assert.strictEqual(fake.checks, 3)
          assert.deepStrictEqual(sent.map((state) => state.status), [
            "checking",
            "idle",
            "checking",
            "error",
            "checking",
            "available"
          ])
        })
    ))

  it.effect("downloads when asked, reports progress, and installs the download", () =>
    withUpdates({}, ({ updates, fake, sent }) =>
      Effect.gen(function*() {
        // Nothing to download or install yet.
        yield* updates.download
        yield* updates.install
        assert.deepStrictEqual([fake.download, fake.installs], [undefined, 0])

        fake.releases.push({ version: "0.2.1", releaseNotes: null })
        yield* updates.check
        yield* updates.download
        yield* settle
        assert.deepInclude(yield* updates.state, { status: "downloading", downloadPercent: 0 })
        fake.onProgress(41.2)
        fake.onProgress(41.9)
        fake.onProgress(87.5)
        yield* settle
        assert.deepStrictEqual(sent.slice(-3).map((state) => state.downloadPercent), [0, 41, 87])

        // A second click while downloading doesn't start another.
        const first = fake.download
        yield* updates.download
        assert.strictEqual(fake.download, first)

        yield* Deferred.succeed(fake.download!, undefined)
        yield* settle
        assert.deepInclude(yield* updates.state, { status: "ready", downloadPercent: 100 })
        yield* updates.install
        assert.strictEqual(fake.installs, 1)
      })))

  it.effect("offers the download again after it fails, and the restart after the installer fails", () =>
    withUpdates({}, ({ updates, fake }) =>
      Effect.gen(function*() {
        fake.releases.push({ version: "0.2.1", releaseNotes: null })
        yield* updates.check
        yield* updates.download
        yield* settle
        yield* Deferred.fail(fake.download!, new ElectronUpdaterError({ operation: "download", cause: "ENOSPC" }))
        yield* settle
        assert.deepInclude(yield* updates.state, {
          status: "available",
          message: "Couldn't download the update: ENOSPC"
        })

        yield* updates.download
        yield* settle
        yield* Deferred.succeed(fake.download!, undefined)
        yield* settle
        fake.installFailure = new Error("spawn EACCES")
        yield* updates.install
        assert.deepInclude(yield* updates.state, {
          status: "ready",
          message: "Couldn't install the update: spawn EACCES"
        })
      })))

  it.effect("checks the mock update server with BALLEST_MOCK_UPDATES", () =>
    withUpdates(
      { env: { BALLEST_MOCK_UPDATES: "1", BALLEST_MOCK_UPDATE_SERVER_PORT: "9000" } },
      ({ updates, fake }) =>
        Effect.gen(function*() {
          yield* updates.run
          assert.deepStrictEqual(fake.feeds, [Option.some("http://127.0.0.1:9000/")])
        })
    ))
})
