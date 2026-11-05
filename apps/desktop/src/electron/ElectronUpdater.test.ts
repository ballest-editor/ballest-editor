import { assert, describe, it } from "@effect/vitest"
import { HttpError } from "builder-util-runtime"
import { Effect, Exit, Option } from "effect"
import { AppImageUpdater } from "electron-updater"
import type { DownloadUpdateOptions } from "electron-updater/out/AppUpdater"
import { vi } from "vitest"
import { findRelease } from "./ElectronUpdater"

// `ElectronUpdater.layer` isn't under test, and these updaters are given their own app and HTTP client.
vi.mock("electron", () => ({}))

const releases = "/ballest-editor/ballest-editor/releases"

/** A release on the fake GitHub: its version, and whether its files are up yet. */
interface Tag {
  readonly version: string
  readonly unfinished?: boolean
}

const manifest = (version: string) =>
  [
    `version: ${version}`,
    "files:",
    "  - url: Ballest-Editor-x86_64.AppImage",
    "    sha512: abc",
    "    size: 1",
    "path: Ballest-Editor-x86_64.AppImage",
    "sha512: abc",
    "releaseDate: '2026-11-05T00:00:00.000Z'"
  ].join("\n")

const entry = ({ version }: Tag) =>
  `<entry><link href="https://github.com${releases}/tag/v${version}"/><title>${version}</title>`
  + `<content>Notes for ${version}</content></entry>`

interface FakeHttp {
  readonly request: (options: { readonly path: string }) => Promise<string>
}

/** Answers as github.com does: the atom feed lists every tag, `latest` only a published stable release. */
const fakeGitHub = (options: { readonly feed: ReadonlyArray<Tag>; readonly latest?: string }): FakeHttp => ({
  request: ({ path }) => {
    if (path === `${releases}.atom`) {
      return Promise.resolve(`<feed>${options.feed.map(entry).join("")}</feed>`)
    }
    if (path === `${releases}/latest`) {
      return options.latest === undefined
        ? Promise.reject(new HttpError(406, "Not Acceptable"))
        : Promise.resolve(JSON.stringify({ tag_name: `v${options.latest}` }))
    }
    const tag = options.feed.find(({ version }) => path === `${releases}/download/v${version}/latest-linux.yml`)
    return tag === undefined || tag.unfinished === true
      ? Promise.reject(new HttpError(404, "Not Found"))
      : Promise.resolve(manifest(tag.version))
  }
})

/** The real updater and GitHub provider, on a fake app and a fake GitHub; downloads only record what they'd fetch. */
class TestUpdater extends AppImageUpdater {
  downloaded: Array<string> = []

  protected override doDownloadUpdate({ updateInfoAndProvider: { info, provider } }: DownloadUpdateOptions) {
    this.downloaded.push(...provider.resolveFiles(info).map((file) => file.url.pathname))
    return Promise.resolve({ updateFile: "" })
  }
}

const updaterAt = (version: string, gitHub: FakeHttp) => {
  const updater = new TestUpdater(null, {
    version,
    name: "Ballest Editor",
    isPackaged: true,
    appUpdateConfigPath: "/nowhere/app-update.yml",
    userDataPath: "/nowhere",
    baseCachePath: "/nowhere",
    whenReady: () => Promise.resolve(),
    relaunch: () => {},
    quit: () => {},
    onQuit: () => {}
  })
  updater.logger = null
  updater.autoDownload = false
  updater.forceDevUpdateConfig = true
  Object.assign(updater, { httpExecutor: gitHub, _testOnlyOptions: { platform: "linux" } })
  updater.setFeedURL({ provider: "github", owner: "ballest-editor", repo: "ballest-editor" })
  return updater
}

const offered = (updater: TestUpdater) =>
  findRelease(updater).pipe(Effect.map(Option.map(({ version }) => version)), Effect.map(Option.getOrNull))

/** The check offers `version`, and the download that follows fetches that release. */
const assertOffersAndDownloads = (updater: TestUpdater, version: string) =>
  Effect.gen(function*() {
    assert.strictEqual(yield* offered(updater), version)
    yield* Effect.promise(() => updater.downloadUpdate())
    assert.deepStrictEqual(updater.downloaded, [`${releases}/download/v${version}/Ballest-Editor-x86_64.AppImage`])
  })

describe("findRelease", () => {
  it.effect("offers a release candidate the final release, and downloads that one", () =>
    Effect.gen(function*() {
      const updater = updaterAt(
        "0.2.0-rc.2",
        fakeGitHub({ feed: [{ version: "0.2.0" }, { version: "0.2.0-rc.3" }], latest: "0.2.0" })
      )
      yield* assertOffersAndDownloads(updater, "0.2.0")
    }))

  it.effect("prefers a stable release to a newer release candidate", () =>
    Effect.gen(function*() {
      const updater = updaterAt(
        "0.2.0-rc.2",
        fakeGitHub({ feed: [{ version: "0.3.0-rc.1" }, { version: "0.2.0" }], latest: "0.2.0" })
      )
      yield* assertOffersAndDownloads(updater, "0.2.0")
    }))

  it.effect("offers a newer release candidate when there's no stable release, and downloads that one", () =>
    Effect.gen(function*() {
      const updater = updaterAt("0.2.0-rc.1", fakeGitHub({ feed: [{ version: "0.2.0-rc.2" }] }))
      yield* assertOffersAndDownloads(updater, "0.2.0-rc.2")
    }))

  it.effect("never downgrades to an older stable release, and still finds a newer release candidate", () =>
    Effect.gen(function*() {
      const updater = updaterAt(
        "0.3.0-rc.1",
        fakeGitHub({ feed: [{ version: "0.3.0-rc.2" }, { version: "0.2.0" }], latest: "0.2.0" })
      )
      yield* assertOffersAndDownloads(updater, "0.3.0-rc.2")
    }))

  it.effect("offers nothing when an older stable release is all there is", () =>
    Effect.gen(function*() {
      const updater = updaterAt(
        "0.3.0-rc.1",
        fakeGitHub({ feed: [{ version: "0.3.0-rc.1" }, { version: "0.2.0" }], latest: "0.2.0" })
      )
      assert.isNull(yield* offered(updater))
    }))

  it.effect("offers nothing to the newest release candidate", () =>
    Effect.gen(function*() {
      const updater = updaterAt("0.2.0-rc.2", fakeGitHub({ feed: [{ version: "0.2.0-rc.2" }] }))
      assert.isNull(yield* offered(updater))
    }))

  it.effect("leaves prerelease lookups on for a release candidate that found nothing stable", () =>
    Effect.gen(function*() {
      const updater = updaterAt("0.2.0-rc.2", fakeGitHub({ feed: [{ version: "0.2.0-rc.2" }] }))
      yield* offered(updater)
      assert.isTrue(updater.allowPrerelease)
    }))

  it.effect("keeps a stable install on stable releases", () =>
    Effect.gen(function*() {
      const gitHub = fakeGitHub({ feed: [{ version: "0.3.0-rc.1" }, { version: "0.2.1" }], latest: "0.2.1" })
      assert.strictEqual(yield* offered(updaterAt("0.2.0", gitHub)), "0.2.1")
      assert.isNull(yield* offered(updaterAt("0.2.1", gitHub)))
    }))

  it.effect("reports a stable install's failed lookup", () =>
    Effect.gen(function*() {
      const updater = updaterAt("0.2.0", fakeGitHub({ feed: [{ version: "0.3.0-rc.1" }] }))
      assert.isTrue(Exit.isFailure(yield* Effect.exit(offered(updater))))
    }))

  it.effect("reports a failed release candidate lookup", () =>
    Effect.gen(function*() {
      const offline: FakeHttp = { request: () => Promise.reject(new Error("offline")) }
      assert.isTrue(Exit.isFailure(yield* Effect.exit(offered(updaterAt("0.2.0-rc.2", offline)))))
    }))

  it.effect("reads the mock feed, which has no stable or prerelease lookups of its own", () =>
    Effect.gen(function*() {
      const mock: FakeHttp = { request: () => Promise.resolve(manifest("0.2.0-rc.3")) }
      const updater = updaterAt("0.2.0-rc.2", mock)
      updater.setFeedURL({ provider: "generic", url: "http://127.0.0.1:4848/" })
      assert.strictEqual(yield* offered(updater), "0.2.0-rc.3")
    }))

  it.effect("treats a tag whose release has no files yet as nothing new", () =>
    Effect.gen(function*() {
      const updater = updaterAt(
        "0.2.0-rc.2",
        fakeGitHub({ feed: [{ version: "0.2.0-rc.3", unfinished: true }, { version: "0.2.0-rc.2" }] })
      )
      assert.isNull(yield* offered(updater))
    }))

  it.effect("finds the final release while a newer tag has no files yet", () =>
    Effect.gen(function*() {
      const updater = updaterAt(
        "0.2.0-rc.2",
        fakeGitHub({ feed: [{ version: "0.3.0-rc.1", unfinished: true }, { version: "0.2.0" }], latest: "0.2.0" })
      )
      assert.strictEqual(yield* offered(updater), "0.2.0")
    }))
})
