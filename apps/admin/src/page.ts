import { type Dashboard, DAYS } from "./Stats"

/** Text from the database as HTML text or an attribute value: every character that could start markup, escaped. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

const e = escapeHtml

/** Only links to this repository's issues are links; anything else the database holds is shown as text. */
const issueLink = (url: string, number: number, text = `#${number}`) =>
  /^https:\/\/github\.com\/ballest-editor\/ballest-editor\/issues\/\d+$/.test(url)
    ? `<a href="${e(url)}">${e(text)}</a>`
    : e(text)

export const formatDuration = (seconds: number | null): string => {
  if (seconds === null) return "–"
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/** The `count` days up to and including `now`'s, oldest first, as YYYY-MM-DD in UTC. */
const lastDays = (now: Date, count: number): Array<string> =>
  Array.from(
    { length: count },
    (_, i) => new Date(now.getTime() - (count - 1 - i) * 86_400_000).toISOString().slice(0, 10)
  )

const table = (head: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>, empty: string) =>
  rows.length === 0
    ? `<p class="empty">${e(empty)}</p>`
    : `<div class="scroll"><table><thead><tr>${head.map((cell) => `<th>${e(cell)}</th>`).join("")}</tr></thead>`
      + `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>`
      + `</table></div>`

const W = 600
const H = 140
const BASE = H - 20

/**
 * One series as bars, a day each, drawn on the server: rounded at the top, a 2px gap between, and a hover title on a
 * full-height target per day. `points` are already escaped-safe (dates and numbers).
 */
const bars = (label: string, points: ReadonlyArray<{ readonly day: string; readonly value: number }>, unit: string) => {
  const max = Math.max(1, ...points.map((point) => point.value))
  const slot = W / points.length
  const width = Math.max(1, slot - 2)
  const marks = points.map((point, i) => {
    const x = i * slot + 1
    const height = (point.value / max) * (BASE - 16)
    const r = Math.min(4, width / 2, height)
    const y = BASE - height
    const bar = height > 0
      ? `<path d="M${x},${BASE} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${
        y + r
      } V${BASE} Z"/>`
      : ""
    return `<g><title>${point.day}: ${point.value} ${e(unit)}</title><rect class="hit" x="${
      i * slot
    }" y="0" width="${slot}" height="${BASE}"/>${bar}</g>`
  })
  const first = points[0]?.day ?? ""
  const last = points.at(-1)?.day ?? ""
  return `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${e(label)}">`
    + `<line class="grid" x1="0" x2="${W}" y1="16" y2="16"/><text class="axis" x="0" y="11">${max}</text>`
    + `<line class="base" x1="0" x2="${W}" y1="${BASE}" y2="${BASE}"/>${marks.join("")}`
    + `<text class="axis" x="0" y="${H - 4}">${first}</text>`
    + `<text class="axis" x="${W}" y="${H - 4}" text-anchor="end">${last}</text></svg>`
}

const tile = (label: string, value: string) =>
  `<div class="tile"><div class="label">${e(label)}</div><div class="value">${e(value)}</div></div>`

const section = (title: string, body: string) => `<section><h2>${e(title)}</h2>${body}</section>`

/** The whole dashboard page, for `now` (which fixes the days shown). */
export const renderPage = (dashboard: Dashboard, now: Date): string => {
  const days = lastDays(now, DAYS)
  const installsBy = new Map(dashboard.activeInstalls.map((row) => [row.day, row.installs]))
  const sessionsBy = new Map(dashboard.sessions.map((row) => [row.day, row]))
  const installs = days.map((day) => ({ day, value: installsBy.get(day) ?? 0 }))
  const sessions = days.map((day) => ({ day, value: sessionsBy.get(day)?.sessions ?? 0 }))

  const week = lastDays(now, 7)
  const versions = [...new Set(dashboard.versions.map((row) => row.appVersion))].sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true })
  )
  const versionCell = new Map(dashboard.versions.map((row) => [`${row.appVersion} ${row.day}`, row.installs]))
  const platformTotal = dashboard.platforms.reduce((sum, row) => sum + row.installs, 0)

  const body = [
    `<div class="tiles">`,
    tile("Active installs today", String(installs.at(-1)?.value ?? 0)),
    tile(`Sessions, ${DAYS} days`, String(sessions.reduce((sum, point) => sum + point.value, 0))),
    tile("Median session", formatDuration(dashboard.sessionLength.medianS)),
    tile("p90 session", formatDuration(dashboard.sessionLength.p90S)),
    `</div>`,
    section(
      `Active installs per day, last ${DAYS} days`,
      bars("Active installs per day", installs, "installs")
        + `<details><summary>Table</summary>${
          table(["Day", "Installs"], installs.toReversed().map((p) => [p.day, String(p.value)]), "No days.")
        }</details>`
    ),
    section(
      `Sessions per day, last ${DAYS} days`,
      bars("Sessions per day", sessions, "sessions")
        + `<details><summary>Table</summary>${
          table(
            ["Day", "Sessions", "First launches", "Median length", "p90 length"],
            dashboard.sessions.toReversed().map((row) => [
              e(row.day),
              String(row.sessions),
              String(row.firstLaunches),
              formatDuration(row.medianS),
              formatDuration(row.p90S)
            ]),
            "No sessions yet."
          )
        }</details>`
    ),
    section(
      "Versions in use, installs per day",
      table(
        ["Version", ...week.map((day) => day.slice(5))],
        versions.map((version) => [
          `<code>${e(version)}</code>`,
          ...week.map((day) => String(versionCell.get(`${version} ${day}`) ?? "·"))
        ]),
        "No installs in the last 7 days."
      )
    ),
    section(
      `Platforms, last ${DAYS} days`,
      table(
        ["Platform", "Installs", "Share"],
        dashboard.platforms.map((row) => [
          `<code>${e(row.platform)}</code>`,
          String(row.installs),
          `${Math.round((row.installs / Math.max(1, platformTotal)) * 100)}%`
        ]),
        "No installs yet."
      )
    ),
    section(
      "Latest errors, by message",
      table(
        ["Message", "Source", "Count", "Installs", "Last seen", "Version"],
        dashboard.errors.map((row) => [
          `<details><summary><code>${e(row.message ?? "(none)")}</code></summary><pre>${
            e(row.latestStack ?? "")
          }</pre></details>`,
          e(row.source ?? "–"),
          String(row.count),
          String(row.installs),
          e(row.lastSeen),
          `<code>${e(row.latestVersion ?? "–")}</code>`
        ]),
        "No errors reported."
      )
    ),
    section(
      "Feedback per week",
      table(
        ["Week of", "Count", "Issues"],
        dashboard.feedbackWeekly.map((row) => [
          e(row.week),
          String(row.count),
          row.issues.map((issue) => `${issueLink(issue.url, issue.number)} <span class="muted">${e(issue.kind)}</span>`)
            .join(", ")
        ]),
        "No feedback yet."
      )
    ),
    section(
      "Latest feedback, with who to reply to",
      table(
        ["Issue", "Kind", "Discord", "Creator", "Version", "Platform", "Received"],
        dashboard.feedbackLatest.map((row) => [
          issueLink(row.issueUrl, row.issueNumber),
          e(row.kind),
          e(row.discord ?? "–"),
          e(row.creator ?? "–"),
          `<code>${e(row.appVersion)}</code>`,
          `<code>${e(row.platform)}</code>`,
          e(row.receivedAt)
        ]),
        "No feedback yet."
      )
    )
  ].join("\n")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Ballest Editor stats</title>
<style>${STYLE}</style>
</head>
<body>
<header><h1>Ballest Editor stats</h1><p class="muted">Days in UTC · made ${
    e(now.toISOString().slice(0, 16).replace("T", " "))
  } UTC</p></header>
<main>
${body}
</main>
</body>
</html>
`
}

/** The page shown when the database can't be read. */
export const renderError = () =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ballest Editor stats</title><style>${STYLE}</style></head><body><main><p>The database couldn't be read; the function's logs say why.</p></main></body></html>`

const STYLE = `
:root {
  color-scheme: light;
  --surface: #fcfcfb;
  --surface-2: #f2f1ee;
  --border: #dddcd7;
  --text: #0b0b0b;
  --text-2: #52514e;
  --series: #2a78d6;
  --link: #1f63b5;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --surface: #1a1a19;
    --surface-2: #242422;
    --border: #383835;
    --text: #f0efec;
    --text-2: #c3c2b7;
    --series: #3987e5;
    --link: #7fb0f0;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--text); font: 14px/1.45 system-ui, sans-serif; }
header, main { max-width: 960px; margin: 0 auto; padding: 16px; }
h1 { font-size: 20px; margin: 8px 0 0; }
h2 { font-size: 15px; margin: 0 0 8px; }
section { margin: 0 0 28px; }
a { color: var(--link); }
code, pre { font: 12px/1.4 ui-monospace, monospace; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0 0; color: var(--text-2); }
.muted, .empty { color: var(--text-2); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 0 0 28px; }
.tile { background: var(--surface-2); border-radius: 8px; padding: 12px; }
.tile .label { color: var(--text-2); font-size: 12px; }
.tile .value { font-size: 24px; font-variant-numeric: tabular-nums; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--text-2); font-weight: 500; }
details summary { cursor: pointer; color: var(--text-2); }
td details summary { color: var(--text); }
.bars { width: 100%; height: auto; display: block; margin: 0 0 4px; }
.bars path { fill: var(--series); }
.bars .hit { fill: transparent; }
.bars g:hover path { opacity: 0.8; }
.bars .grid { stroke: var(--border); stroke-dasharray: 2 3; }
.bars .base { stroke: var(--border); }
.bars .axis { fill: var(--text-2); font-size: 11px; }
`
