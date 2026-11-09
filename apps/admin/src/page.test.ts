import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { handleDashboard } from "./handler"
import { escapeHtml, formatDuration, renderPage } from "./page"
import { type Dashboard, Stats, StatsError } from "./Stats"

const NOW = new Date("2026-11-08T12:00:00Z")

const empty: Dashboard = {
  activeInstalls: [],
  sessions: [],
  sessionLength: { sessions: 0, medianS: null, p90S: null },
  versions: [],
  platforms: [],
  errors: [],
  feedbackWeekly: [],
  feedbackLatest: []
}

const XSS = `<script>alert("x")</script>`

const hostile: Dashboard = {
  ...empty,
  activeInstalls: [{ day: "2026-11-08", installs: 3 }],
  versions: [{ day: "2026-11-08", appVersion: `0.4.0"><img src=x>`, installs: 3 }],
  platforms: [{ platform: XSS, installs: 1 }],
  errors: [{
    source: "renderer",
    message: XSS,
    count: 2,
    installs: 1,
    lastSeen: "2026-11-08 10:00",
    latestVersion: "0.4.0",
    latestStack: `at <anonymous> & 'quoted'`
  }],
  feedbackWeekly: [{
    week: "2026-11-02",
    count: 2,
    issues: [
      { number: 7, url: "https://github.com/ballest-editor/ballest-editor/issues/7", kind: "bug" },
      { number: 8, url: "javascript:alert(1)", kind: "idea" }
    ]
  }],
  feedbackLatest: [{
    issueNumber: 7,
    issueUrl: "https://github.com/ballest-editor/ballest-editor/issues/7",
    kind: "bug",
    discord: XSS,
    creator: `O'Brien & <b>co</b>`,
    appVersion: "0.4.0",
    platform: "win32",
    receivedAt: "2026-11-08 09:00"
  }]
}

const stats = (load: Effect.Effect<Dashboard, StatsError>) => Layer.succeed(Stats, Stats.of({ load }))

describe("renderPage", () => {
  it("escapes everything that came from the database", () => {
    const html = renderPage(hostile, NOW)
    assert.notInclude(html, "<script>")
    assert.notInclude(html, "<img")
    assert.notInclude(html, "<b>co</b>")
    assert.notInclude(html, "javascript:")
    assert.include(html, "&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;")
    assert.include(html, "O&#39;Brien &#38; &#60;b&#62;co&#60;/b&#62;")
    assert.include(html, `<a href="https://github.com/ballest-editor/ballest-editor/issues/7">#7</a>`)
  })

  it("renders an empty database as empty sections, with every day at zero", () => {
    const html = renderPage(empty, NOW)
    for (const text of ["No sessions yet.", "No errors reported.", "No feedback yet.", "No installs yet."]) {
      assert.include(html, text)
    }
    assert.include(html, "2026-10-10: 0 installs")
    assert.include(html, "2026-11-08: 0 installs")
    assert.notInclude(html, "2026-10-09:")
    assert.include(html, "Median session</div><div class=\"value\">–")
  })

  it("draws a bar for each day with installs", () => {
    const html = renderPage(hostile, NOW)
    assert.include(html, "2026-11-08: 3 installs")
    assert.match(html, /<path d="M/)
  })
})

describe("escapeHtml", () => {
  it("escapes the five characters that can start or end markup", () => {
    assert.strictEqual(
      escapeHtml(`<a href="x" title='y'>&</a>`),
      "&#60;a href=&#34;x&#34; title=&#39;y&#39;&#62;&#38;&#60;/a&#62;"
    )
  })
})

describe("formatDuration", () => {
  it.each([[null, "–"], [42.4, "42s"], [754, "12m 34s"], [3720, "1h 2m"]] as const)("%s → %s", (seconds, text) => {
    assert.strictEqual(formatDuration(seconds), text)
  })
})

describe("GET /", () => {
  it.effect("answers the page with no caching and a policy that runs nothing", () =>
    Effect.gen(function*() {
      const response = yield* handleDashboard(new Request("https://admin.example/")).pipe(
        Effect.provide(stats(Effect.succeed(empty)))
      )
      assert.strictEqual(response.status, 200)
      assert.strictEqual(response.headers.get("cache-control"), "no-store")
      assert.include(response.headers.get("content-security-policy") ?? "", "default-src 'none'")
      assert.include(yield* Effect.promise(() => response.text()), "<h1>Ballest Editor stats</h1>")
    }))

  it.effect("answers 500 when the database can't be read", () =>
    Effect.gen(function*() {
      const response = yield* handleDashboard(new Request("https://admin.example/")).pipe(
        Effect.provide(stats(Effect.fail(new StatsError({ cause: "connection refused" }))))
      )
      assert.strictEqual(response.status, 500)
    }))

  it.effect("only takes GET and HEAD", () =>
    Effect.gen(function*() {
      const response = yield* handleDashboard(new Request("https://admin.example/", { method: "POST" })).pipe(
        Effect.provide(stats(Effect.succeed(empty)))
      )
      assert.strictEqual(response.status, 405)
    }))
})
