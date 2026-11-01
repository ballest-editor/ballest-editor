import type { ReleaseNoteSpan } from "@ballest/contracts"
import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import * as Machine from "./updateMachine"

const text = (value: string, format: Partial<Omit<ReleaseNoteSpan, "text">> = {}): ReleaseNoteSpan => ({
  text: value,
  strong: false,
  emphasis: false,
  code: false,
  href: null,
  ...format
})

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

    const available = Machine.onAvailable(
      Machine.onCheckStart(failed),
      Machine.releaseOf({ version: "0.2.1", releaseNotes: "Fixes", releaseDate: "2026-10-31T12:00:00.000Z" })
    )
    assert.deepInclude(available, {
      status: "available",
      availableVersion: "0.2.1",
      releaseNotes: [{ _tag: "Paragraph", spans: [text("Fixes")] }],
      releaseDate: "2026-10-31T12:00:00.000Z",
      releaseUrl: "https://github.com/ballest-editor/ballest-editor/releases/tag/v0.2.1",
      message: null
    })
    assert.isNull(Machine.releaseOf({ version: "0.2.1", releaseNotes: null, releaseDate: "" }).date)
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

  it("keeps the headings, lists, links and formatting of GitHub's HTML release body", () => {
    // What GitHub's generated release notes look like.
    const html = [
      "<h2>What&#39;s Changed</h2>",
      "<ul>",
      "<li><strong>Undo</strong> &amp; <em>redo</em> by <a class=\"user-mention\" href=\"https://github.com/someone\">@someone</a></li>",
      "<li>Faster <code>&lt;load&gt;</code>",
      "  <ol><li>first</li><li>second</li></ol>",
      "</li>",
      "</ul>",
      "<p><strong>Full Changelog</strong>: <a href=\"https://github.com/o/r/compare/v0.2.0...v0.2.1\">v0.2.0...v0.2.1</a></p>",
      "<h5>Small</h5><pre><code>pnpm   dist\n  --mock\n</code></pre>"
    ].join("\n")
    assert.deepStrictEqual(Machine.releaseNotesOf(html, "0.2.1"), [
      { _tag: "Heading", level: 2, spans: [text("What's Changed")] },
      {
        _tag: "List",
        ordered: false,
        items: [
          {
            spans: [
              text("Undo", { strong: true }),
              text(" & "),
              text("redo", { emphasis: true }),
              text(" by "),
              text("@someone", { href: "https://github.com/someone" })
            ],
            lists: []
          },
          {
            spans: [text("Faster "), text("<load>", { code: true })],
            lists: [{
              _tag: "List",
              ordered: true,
              items: [{ spans: [text("first")], lists: [] }, { spans: [text("second")], lists: [] }]
            }]
          }
        ]
      },
      {
        _tag: "Paragraph",
        spans: [
          text("Full Changelog", { strong: true }),
          text(": "),
          text("v0.2.0...v0.2.1", { href: "https://github.com/o/r/compare/v0.2.0...v0.2.1" })
        ]
      },
      { _tag: "Heading", level: 4, spans: [text("Small")] },
      { _tag: "Code", text: "pnpm   dist\n  --mock" }
    ])
  })

  it("drops script, images, frames and links that aren't http(s)", () => {
    const html = [
      "<p>Before<script>alert(1)</script> after<img src=\"https://tracker.example/p.gif\" onerror=\"alert(2)\"></p>",
      "<iframe src=\"https://evil.example\">framed</iframe><style>p { color: red }</style>",
      "<p onclick=\"alert(3)\"><a href=\"javascript:alert(4)\">click</a> <a href=\"file:///etc/passwd\">file</a></p>",
      "<p><span>Unwrapped</span><br>next line<!-- <script>alert(5)</script> --></p>",
      "<svg><text>drawn</text></svg><script src=\"https://x/y.js\"></script>"
    ].join("")
    assert.deepStrictEqual(Machine.releaseNotesOf(html, "0.2.1"), [
      { _tag: "Paragraph", spans: [text("Before after")] },
      { _tag: "Paragraph", spans: [text("click file")] },
      { _tag: "Paragraph", spans: [text("Unwrapped\nnext line")] }
    ])
    // An unclosed script takes the rest of the body with it.
    assert.deepStrictEqual(Machine.releaseNotesOf("<p>Kept</p><script>alert(1)<p>gone</p>", "0.2.1"), [
      { _tag: "Paragraph", spans: [text("Kept")] }
    ])
  })

  it("reads plain notes, picks the offered release from a changelog and caps the length", () => {
    assert.deepStrictEqual(Machine.releaseNotesOf("A mock release.\nSecond line.\n\nMore & more", "0.2.1"), [
      { _tag: "Paragraph", spans: [text("A mock release.\nSecond line.")] },
      { _tag: "Paragraph", spans: [text("More & more")] }
    ])
    // A full changelog lists every newer release; the offered one's note is shown.
    const changelog = [{ version: "0.2.2", note: "<p>Newest</p>" }, { version: "0.2.1", note: "Older" }]
    assert.deepStrictEqual(Machine.releaseNotesOf(changelog, "0.2.2"), [
      { _tag: "Paragraph", spans: [text("Newest")] }
    ])
    assert.isNull(Machine.releaseNotesOf(changelog, "0.3.0"))
    assert.isNull(Machine.releaseNotesOf(null, "0.2.1"))
    assert.isNull(Machine.releaseNotesOf("<p> </p><img src=x>", "0.2.1"))

    const long = Machine.releaseNotesOf(`<p>${"x".repeat(3000)}</p><ul><li>${"y".repeat(3000)}</li></ul><p>z</p>`, "0")
    assert.strictEqual(long?.length, 2)
    const item = long?.[1]?._tag === "List" ? long[1].items[0]?.spans[0]?.text : undefined
    assert.strictEqual(item?.length, 1000)
    assert.isTrue(item?.endsWith("y…"))
    const plain = Machine.releaseNotesOf("x".repeat(5000), "0")?.[0]
    assert.strictEqual(plain?._tag === "Paragraph" ? plain.spans[0]?.text.length : 0, 4000)
  })
})
