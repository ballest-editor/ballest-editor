import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import * as Machine from "./updateMachine"

const installed: Machine.UpdateEnvironment = {
  isPackaged: true,
  isDevelopment: false,
  platform: "win32",
  appImage: Option.none(),
  disabledByEnv: false
}

describe("updateMachine", () => {
  it("updates only an installed build, not turned off, and on Linux only the AppImage", () => {
    assert.isTrue(Option.isNone(Machine.disabledReason(installed)))
    assert.isTrue(
      Option.isNone(Machine.disabledReason({ ...installed, platform: "linux", appImage: Option.some("/a.AppImage") }))
    )
    const reasons = [
      { ...installed, isPackaged: false },
      { ...installed, isDevelopment: true },
      { ...installed, disabledByEnv: true },
      { ...installed, platform: "linux" as const }
    ].map((env) => Option.getOrNull(Machine.disabledReason(env)))
    assert.deepStrictEqual(reasons, [
      "Updates only run in an installed build.",
      "Updates only run in an installed build.",
      "Updates are turned off by BALLEST_DISABLE_AUTO_UPDATE.",
      "On Linux, only the AppImage updates itself."
    ])
  })

  it("goes from idle through available and downloading to ready, and back after a failure", () => {
    const idle = Machine.initialState("0.2.0", Option.none())
    assert.strictEqual(idle.status, "idle")
    assert.strictEqual(Machine.initialState("0.2.0", Option.some("off")).status, "disabled")
    assert.isFalse(Machine.canCheck(Machine.initialState("0.2.0", Option.some("off"))))

    const failed = Machine.onCheckFailed(Machine.onCheckStart(idle), "offline")
    assert.deepInclude(failed, { status: "error", message: "offline" })
    assert.isTrue(Machine.canCheck(failed))

    const available = Machine.onAvailable(Machine.onCheckStart(failed), "0.2.1", "Fixes")
    assert.deepInclude(available, {
      status: "available",
      availableVersion: "0.2.1",
      releaseNotes: "Fixes",
      message: null
    })
    assert.isFalse(Machine.canCheck(available))

    const downloading = Machine.onDownloadProgress(Machine.onDownloadStart(available), 140)
    assert.deepInclude(downloading, { status: "downloading", downloadPercent: 100 })
    assert.deepInclude(Machine.onDownloadFailed(downloading, "disk full"), {
      status: "available",
      downloadPercent: null,
      message: "disk full"
    })

    const ready = Machine.onDownloaded(downloading)
    assert.deepInclude(Machine.onInstallFailed(ready, "no installer"), { status: "ready", message: "no installer" })
  })

  it("turns GitHub's HTML release body into text", () => {
    const html = [
      "<h2>What&#39;s Changed</h2>",
      "<ul><li>Undo &amp; redo by <a href=\"https://x\">@someone</a></li><li>Faster &lt;load&gt;</li></ul>",
      "<p><script>alert(1)</script>Full&nbsp;changelog</p>"
    ].join("\n")
    assert.strictEqual(
      Machine.releaseNotesText(html, "0.2.1"),
      "What's Changed\n\n- Undo & redo by @someone\n- Faster <load>\n\nalert(1)Full changelog"
    )
    // A full changelog lists every newer release; the offered one's note is shown.
    const changelog = [{ version: "0.2.2", note: "<p>Newest</p>" }, { version: "0.2.1", note: "Older" }]
    assert.strictEqual(Machine.releaseNotesText(changelog, "0.2.2"), "Newest")
    assert.isNull(Machine.releaseNotesText(changelog, "0.3.0"))
    assert.isNull(Machine.releaseNotesText(null, "0.2.1"))
    assert.isNull(Machine.releaseNotesText("<p> </p>", "0.2.1"))
    assert.strictEqual(Machine.releaseNotesText("x".repeat(5000), "0.2.1")?.length, 4000)
  })
})
