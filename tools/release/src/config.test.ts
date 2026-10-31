import { assert, describe, it } from "@effect/vitest"
import { builderConfig, githubFeed, installerName, mockFeed, releaseFiles, stagePackageJson } from "./config.ts"

const options = { version: "0.2.0-rc.1", electronVersion: "45.1.0", output: "/repo/release", feed: githubFeed }

describe("stagePackageJson", () => {
  it("points main at the bundle and carries the config", () => {
    const manifest = stagePackageJson({ ...options, platform: "linux" })
    assert.strictEqual(manifest.version, "0.2.0-rc.1")
    assert.strictEqual(manifest.main, "dist-electron/main.cjs")
    assert.deepStrictEqual(manifest.build, builderConfig({ ...options, platform: "linux" }))
  })
})

describe("builderConfig", () => {
  it("ships the assets and the editor-link plugin beside app.asar, not in it", () => {
    const config = builderConfig({ ...options, platform: "win" })
    assert.deepStrictEqual(config.extraResources, [{ from: "assets", to: "assets" }, {
      from: "plugins",
      to: "plugins"
    }])
    assert.notInclude(config.files, "assets/**")
    assert.include(config.files, "!**/*.map")
  })

  it("feeds updates from this repository's releases, or from the mock server with --mock-updates", () => {
    assert.deepStrictEqual(builderConfig({ ...options, platform: "win" }).publish, [
      { provider: "github", owner: "ballest-editor", repo: "ballest-editor" }
    ])
    const mock = builderConfig({ ...options, platform: "linux", feed: mockFeed(4848) })
    assert.deepStrictEqual(mock.publish, [{ provider: "generic", url: "http://127.0.0.1:4848/" }])
    assert.isString(mock.releaseInfo?.releaseNotes)
  })

  it("configures only the platform being built", () => {
    const win = builderConfig({ ...options, platform: "win" })
    const linux = builderConfig({ ...options, platform: "linux" })
    assert.isDefined(win.nsis)
    assert.isUndefined(win.linux)
    assert.isDefined(linux.linux)
    assert.isUndefined(linux.win)
  })
})

describe("releaseFiles", () => {
  it("matches what electron-builder names the artifacts", () => {
    assert.deepStrictEqual(releaseFiles("win", "1.0.0"), [
      "Ballest-Editor-1.0.0-x64.exe",
      "Ballest-Editor-1.0.0-x64.exe.blockmap",
      "latest.yml"
    ])
    assert.deepStrictEqual(releaseFiles("linux", "1.0.0"), ["Ballest-Editor-1.0.0-x86_64.AppImage", "latest-linux.yml"])
    assert.strictEqual(installerName("linux", "1.0.0"), releaseFiles("linux", "1.0.0")[0])
  })
})
