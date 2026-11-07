// oxlint-disable eslint/no-await-in-loop -- driving one browser is sequential: each step waits on the last
/** What a run leaves behind, sized for a reader who pays per image: a summary and contact sheets, full size on request. */
import * as fs from "node:fs"
import * as path from "node:path"
import { Cdp, openContextPage, parseJson } from "./cdp.ts"
import type { Comparison } from "./compare.ts"
import type { Metrics } from "./grade.ts"
import { ensureBrowser } from "./session.ts"
import type { Axes } from "./state.ts"

export interface ResultRow {
  readonly key: string
  readonly id: string
  readonly views: ReadonlyArray<string>
  readonly axes: Axes
  readonly kind: "guard" | "bad"
  /** null: the state never reached a point it could be graded at, and `error` says why. */
  readonly pass: boolean | null
  readonly failures: ReadonlyArray<string>
  readonly metrics: Metrics
  readonly shot: string
  /** Popped-out panels' pictures. */
  readonly windows: ReadonlyArray<string>
  readonly a11y?: string
  readonly hash?: string
  readonly bytes?: number
  readonly noisy?: boolean
  readonly error?: string
}

export const writeResults = (dir: string, rows: ReadonlyArray<ResultRow>) =>
  fs.writeFileSync(path.join(dir, "results.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n")

export const readResults = (dir: string): ReadonlyArray<ResultRow> =>
  fs.readFileSync(path.join(dir, "results.jsonl"), "utf8").trim().split("\n").filter((line) => line !== "").map(
    (line) => parseJson<ResultRow>(line)
  )

export const renderSummary = (
  rows: ReadonlyArray<ResultRow>,
  pending: ReadonlyArray<{ readonly id: string; readonly reason: string }>,
  comparison: Comparison | null
): string => {
  const passed = rows.filter((row) => row.pass === true).length
  const bad = rows.filter((row) => row.pass !== true)
  const noisy = rows.filter((row) => row.noisy === true)
  return [
    `${passed} of ${rows.length} captures passed, ${pending.length} states pending.`,
    ...(comparison === null
      ? []
      : [`${comparison.changed.length} of ${rows.length} changed since ${comparison.before}.`]),
    ...(bad.length === 0 ? [] : [
      "",
      "| state | kind | why |",
      "| :-- | :-- | :-- |",
      ...bad.map((row) =>
        `| ${row.key} | ${row.kind} | ${
          (row.error ?? row.failures.join("; ")).replaceAll("|", "\\|").replaceAll("\n", " ")
        } |`
      )
    ]),
    ...(noisy.length === 0 ? [] : ["", `Differs between identical runs: ${noisy.map((row) => row.key).join(", ")}.`]),
    ...(comparison === null || comparison.table === "" ? [] : ["", comparison.table]),
    ...(pending.length === 0 ? [] : ["", "Pending:", ...pending.map(({ id, reason }) => `- ${id}: ${reason}`)])
  ].join("\n") + "\n"
}

const TILES_PER_SHEET = 20
const COLUMNS = 4
const TILE_WIDTH = 360

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export interface Tile {
  readonly label: string
  readonly images: ReadonlyArray<string>
}

const sheetHtml = (tiles: ReadonlyArray<Tile>, columns: number, width: number) =>
  `<!doctype html><style>
  body{margin:0;padding:8px;background:#111;color:#ddd;font:12px sans-serif;width:${
    columns * (width + 8)
  }px;height:fit-content}html{height:fit-content}
  main{display:grid;grid-template-columns:repeat(${columns},${width}px);gap:8px}
  figure{margin:0}figure div{display:flex;gap:2px}img{min-width:0;flex:1;width:100%;display:block}
  figcaption{padding:2px 0;overflow-wrap:anywhere}</style><main>${
    tiles.map(({ images, label }) =>
      `<figure><div>${images.map((image) => `<img src="file://${escapeHtml(image)}">`).join("")}</div><figcaption>${
        escapeHtml(label)
      }</figcaption></figure>`
    ).join("")
  }</main>`

/** Lays `tiles` out in pages of small pictures and has the browser draw them: the repo has no image library. */
export const renderTiles = async (
  dir: string,
  tiles: ReadonlyArray<Tile>,
  layout: { readonly columns: number; readonly width: number; readonly perSheet: number } = {
    columns: COLUMNS,
    width: TILE_WIDTH,
    perSheet: TILES_PER_SHEET
  }
): Promise<ReadonlyArray<string>> => {
  if (tiles.length === 0) return []
  const browser = await Cdp.connect(await ensureBrowser())
  const sheets: Array<string> = []
  try {
    for (let start = 0, n = 1; start < tiles.length; start += layout.perSheet, n++) {
      const html = path.join(dir, `sheet-${n}.html`)
      fs.writeFileSync(html, sheetHtml(tiles.slice(start, start + layout.perSheet), layout.columns, layout.width))
      const { close, sessionId } = await openContextPage(browser)
      await browser.send("Page.enable", {}, sessionId)
      const loaded = new Promise<void>((resolve) => {
        const stop = browser.on("Page.loadEventFired", (_, session) => {
          if (session === sessionId) {
            stop()
            resolve()
          }
        })
      })
      await browser.send("Page.navigate", { url: `file://${html}` }, sessionId)
      await loaded
      const { cssContentSize } = await browser.send<{ cssContentSize: { width: number; height: number } }>(
        "Page.getLayoutMetrics",
        {},
        sessionId
      )
      const { data } = await browser.send<{ data: string }>("Page.captureScreenshot", {
        format: "webp",
        quality: 80,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 }
      }, sessionId)
      const sheet = path.join(dir, `sheet-${n}.webp`)
      fs.writeFileSync(sheet, Buffer.from(data, "base64"))
      fs.rmSync(html)
      await close()
      sheets.push(sheet)
    }
  } finally {
    browser.close()
  }
  return sheets
}

export const renderSheets = (dir: string, rows: ReadonlyArray<ResultRow>) =>
  renderTiles(
    dir,
    rows.filter((row) => row.hash !== undefined).flatMap((row) =>
      [row.shot, ...row.windows].map((shot, index) => ({
        label: index === 0 ? row.key : `${row.key} window ${index}`,
        images: [path.join(dir, shot)]
      }))
    )
  )
