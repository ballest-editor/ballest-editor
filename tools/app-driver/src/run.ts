// oxlint-disable eslint/no-await-in-loop -- driving one browser is sequential: each step waits on the last
/** Runs states: each variation in a page of its own, from a fresh profile, into `.app-driver/runs/<id>/`. */
import * as fs from "node:fs"
import * as path from "node:path"
import { Cdp, openContextPage, parseJson } from "./cdp.ts"
import { compareRuns } from "./compare.ts"
import { readFixture } from "./fixtures.ts"
import { type AxisOverrides, checkFails, keyOf, type Metrics, variationsOf } from "./grade.ts"
import { Page } from "./page.ts"
import { samePicture } from "./png.ts"
import { renderSheets, renderSummary, type ResultRow, writeResults } from "./report.ts"
import {
  buildDesktop,
  ensureBrowser,
  ensureServer,
  launchDesktop,
  runsDir,
  sessionRunning,
  stopSession
} from "./session.ts"
import { type Axes, DEFAULT_AXES, type Step } from "./state.ts"
import { type LoadedState, loadStates, pickStates } from "./states.ts"

export interface RunOptions {
  readonly states?: ReadonlyArray<string>
  readonly views?: ReadonlyArray<string>
  readonly overrides?: AxisOverrides
  readonly smoke?: boolean
  /** Runs each variation this many times and reports the ones that differ: the noise floor. */
  readonly repeat?: number
  /** A run to compare with: the sheets then hold only what changed. */
  readonly since?: string
  readonly name?: string
  readonly gpu?: boolean
}

export interface RunReport {
  readonly dir: string
  readonly summary: string
  readonly sheets: ReadonlyArray<string>
  readonly failed: boolean
}

/** What every page gets before its state: one motion setting, and a creator so saving isn't disabled. */
const baseSettings = (axes: Axes) => ({
  appearance: { theme: axes.theme, motion: "off" },
  general: { creatorName: "app-driver" }
})

interface Driven {
  readonly page: Page
  /** The desktop app's own connection: its other windows are reached through it. */
  readonly cdp?: Cdp
  readonly answer: (answer: unknown) => void
  readonly close: () => Promise<void>
}

const openWebPage = async (browser: Cdp, url: string, axes: Axes): Promise<Driven> => {
  const { close, sessionId } = await openContextPage(browser)
  const page = new Page(browser, sessionId)
  await page.start(url, axes.window)
  return {
    page,
    answer: () => {
      throw new Error("a native dialog needs `target: \"desktop\"`")
    },
    close
  }
}

const mainWindowTarget = async (cdp: Cdp): Promise<string> => {
  for (let i = 0; i < 200; i++) {
    const { targetInfos } = await cdp.send<
      { targetInfos: ReadonlyArray<{ targetId: string; type: string; url: string }> }
    >(
      "Target.getTargets"
    )
    const found = targetInfos.find(({ type, url }) => type === "page" && !url.startsWith("devtools"))
    if (found !== undefined) return found.targetId
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("the desktop app opened no window")
}

const openDesktopPage = async (url: string, axes: Axes, dir: string): Promise<Driven> => {
  const app = await launchDesktop(url, dir)
  const cdp = await Cdp.connect(app.ws)
  const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", {
    targetId: await mainWindowTarget(cdp),
    flatten: true
  })
  const page = new Page(cdp, sessionId)
  await page.start(null, axes.window)
  // Main treats an aborted first load as fatal: let it finish, then load again with the pins in.
  await page.waitForHook()
  await page.reload()
  return {
    page,
    cdp,
    answer: (answer) => {
      const queued: ReadonlyArray<unknown> = fs.existsSync(app.dialogs)
        ? parseJson<ReadonlyArray<unknown>>(fs.readFileSync(app.dialogs, "utf8"))
        : []
      fs.writeFileSync(app.dialogs, JSON.stringify([...queued, answer]))
    },
    close: async () => {
      cdp.close()
      await app.stop()
    }
  }
}

/** Popped-out panels are windows of their own: one extra picture each. */
const captureOtherWindows = async (cdp: Cdp, shots: string, key: string): Promise<ReadonlyArray<string>> => {
  const { targetInfos } = await cdp.send<
    { targetInfos: ReadonlyArray<{ targetId: string; type: string; url: string }> }
  >(
    "Target.getTargets"
  )
  const windows = targetInfos.filter(({ type, url }) => type === "page" && url.includes("popout"))
  const files: Array<string> = []
  for (const [index, { targetId }] of windows.entries()) {
    const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })
    const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" }, sessionId)
    const file = path.join(shots, `${key}.window-${index + 1}.png`)
    fs.writeFileSync(file, Buffer.from(data, "base64"))
    files.push(path.relative(path.dirname(shots), file))
  }
  return files
}

interface Target {
  readonly open: (state: LoadedState, axes: Axes, scratch: string) => Promise<Driven>
}

const applyAxes = async (page: Page, axes: Axes) => {
  if (axes.panes !== DEFAULT_AXES.panes) await page.call("panes", axes.panes)
  if (axes.dock === "bare") await page.call("closePanels")
}

const runOne = async (
  state: LoadedState,
  axes: Axes,
  dir: string,
  target: Target,
  extraSteps: ReadonlyArray<Step> = []
): Promise<ResultRow> => {
  const key = keyOf(state.id, axes)
  const row = { key, id: state.id, views: state.views, axes, kind: state.kind ?? "guard" as const }
  const scratch = path.join(dir, "scratch", key)
  const opened = await target.open(state, axes, scratch).then(
    (driven) => ({ driven }),
    (error: unknown) => ({ error: String(error).slice(0, 400) })
  )
  if ("error" in opened) {
    return { ...row, pass: null, failures: [], metrics: {}, shot: "", windows: [], error: opened.error }
  }
  const { driven } = opened
  const { page } = driven
  try {
    await page.waitForHook()
    await page.call("pinGameTime")
    await page.call("settings", baseSettings(axes))
    const fixture = readFixture(state.fixture ?? "none")
    if (fixture !== null) await page.call("openMap", fixture.name, fixture.text)
    await applyAxes(page, axes)
    for (const step of [...(state.reach ?? []), ...extraSteps]) await page.step(step, driven.answer)
    const { ms, settled, stillMoving } = await page.settle()
    const shot = path.join("shots", `${key}.png`)
    const { bytes, hash } = await page.capture(path.join(dir, shot))
    const a11yFile = path.join("a11y", `${key}.txt`)
    fs.writeFileSync(path.join(dir, a11yFile), await page.a11y())
    const measured: Record<string, Metrics[string]> = { settleMs: ms, pageErrors: page.errors.length }
    for (const [name, probe] of Object.entries(state.measure ?? {})) {
      const result = await page.probe(probe)
      for (const [field, value] of Object.entries(result)) {
        measured[field === "value" ? name : `${name}.${field}`] = value
      }
    }
    const windows = driven.cdp === undefined ? [] : await captureOtherWindows(driven.cdp, path.join(dir, "shots"), key)
    const failures = [
      ...(state.checks ?? []).flatMap((check) => checkFails(check, measured) ?? []),
      ...(settled ? [] : [`never settled: ${stillMoving}`]),
      ...page.errors.slice(0, 3).map((error) => `page error: ${error.slice(0, 200)}`)
    ]
    return {
      ...row,
      pass: failures.length === 0,
      failures,
      metrics: measured,
      shot,
      windows,
      a11y: a11yFile,
      hash,
      bytes
    }
  } catch (error) {
    const shot = path.join("shots", `${key}.failed.png`)
    await page.capture(path.join(dir, shot)).catch(() => {})
    return { ...row, pass: null, failures: [], metrics: {}, shot, windows: [], error: String(error).slice(0, 400) }
  } finally {
    await driven.close()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

const stamp = () => new Date().toISOString().replaceAll(/[:.]/g, "-").slice(0, 19)

/** Runs the picked states. A session this started stops with it; one that was already up stays up. */
export const runStates = async (options: RunOptions): Promise<RunReport> => {
  const all = await loadStates()
  const picked = pickStates(all, options.states ?? [], options.views ?? [])
  const dir = path.join(runsDir, options.name ?? stamp())
  fs.rmSync(dir, { recursive: true, force: true })
  for (const folder of ["shots", "a11y", "scratch"]) fs.mkdirSync(path.join(dir, folder), { recursive: true })
  const wasRunning = sessionRunning()
  // Killed mid-run, it still takes down what it started.
  const onSignal = () => void stopSession().finally(() => process.exit(130))
  if (!wasRunning) { for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, onSignal) }
  try {
    const url = await ensureServer()
    const browser = await Cdp.connect(await ensureBrowser(options.gpu === true))
    if (picked.some(({ pending, target }) => target === "desktop" && pending === undefined)) buildDesktop()
    const target: Target = {
      open: (state, axes, scratch) =>
        state.target === "desktop" ? openDesktopPage(url, axes, scratch) : openWebPage(browser, url, axes)
    }
    const rows: Array<ResultRow> = []
    const pending: Array<{ readonly id: string; readonly reason: string }> = []
    for (const state of picked) {
      if (state.pending !== undefined) {
        pending.push({ id: state.id, reason: state.pending })
        continue
      }
      for (const axes of variationsOf(state, options)) {
        const row = await runOne(state, axes, dir, target)
        const repeats = Math.max(1, options.repeat ?? 1) - 1
        let noisy = false
        const shot = path.join(dir, row.shot)
        const first = row.hash === undefined ? null : fs.readFileSync(shot)
        if (first !== null) {
          for (let i = 0; i < repeats; i++) {
            const again = await runOne(state, axes, dir, target)
            noisy = noisy || again.hash === undefined || !samePicture(first, fs.readFileSync(shot))
            fs.writeFileSync(shot, first)
          }
        }
        rows.push(noisy ? { ...row, noisy } : row)
        console.error(`${row.pass === true ? "ok  " : row.pass === false ? "FAIL" : "ERR "} ${row.key}`)
      }
    }
    browser.close()
    fs.rmSync(path.join(dir, "scratch"), { recursive: true, force: true })
    writeResults(dir, rows)
    const comparison = options.since === undefined ? null : compareRuns(options.since, dir)
    const changed = comparison === null ? null : new Set(comparison.changed)
    const sheets = await renderSheets(
      dir,
      rows.filter((row) => changed === null || changed.has(row.key))
    )
    const summary = renderSummary(rows, pending, comparison)
    fs.writeFileSync(path.join(dir, "summary.md"), summary)
    return {
      dir,
      summary,
      sheets,
      failed: rows.some((row) => row.kind === "guard" && row.pass !== true)
    }
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    if (!wasRunning) await stopSession()
  }
}
