/** The operations the CLI and the MCP tools share, as one service: everything below it is plain async code. */
import { Context, Effect, Layer, Schema } from "effect"
import * as path from "node:path"
import { Cdp, openContextPage } from "./cdp.ts"
import { compareWithSheets, latestRun, resolveRun } from "./compare.ts"
import { parseAxes } from "./grade.ts"
import { Page } from "./page.ts"
import { reviewRun } from "./review.ts"
import { type RunOptions, runStates } from "./run.ts"
import { ensureBrowser, ensureServer, home, inSession, stopSession } from "./session.ts"
import { DEFAULT_AXES, type Step } from "./state.ts"
import { loadStates } from "./states.ts"

export class AppDriverError extends Schema.TaggedError<AppDriverError>()("AppDriverError", {
  message: Schema.String
}) {}

const attempt = <A>(work: () => Promise<A>) =>
  Effect.tryPromise({
    try: work,
    catch: (cause) => new AppDriverError({ message: cause instanceof Error ? cause.message : String(cause) })
  })

export interface ListOptions {
  readonly views?: boolean
  readonly uncovered?: boolean
}

const liveViews = async (): Promise<ReadonlyArray<string>> => {
  const url = await ensureServer()
  const browser = await Cdp.connect(await ensureBrowser())
  const { close, sessionId } = await openContextPage(browser)
  const page = new Page(browser, sessionId)
  await page.start(url, DEFAULT_AXES.window)
  await page.waitForHook()
  const views = await page.call<ReadonlyArray<string>>("views")
  await close()
  browser.close()
  return views
}

/** The one page `step` works on, so an agent can poke at a state across calls without writing a client of its own. */
const scratchPage = { browser: null as Cdp | null, page: null as Page | null }

const stepPage = async () => {
  if (scratchPage.page !== null) return scratchPage.page
  const url = await ensureServer()
  const browser = await Cdp.connect(await ensureBrowser())
  const { sessionId } = await openContextPage(browser)
  const page = new Page(browser, sessionId)
  await page.start(url, DEFAULT_AXES.window)
  await page.waitForHook()
  await page.call("pinGameTime")
  await page.call("settings", { appearance: { motion: "off" }, general: { creatorName: "app-driver" } })
  scratchPage.browser = browser
  scratchPage.page = page
  return page
}

export class AppDriver extends Context.Service<AppDriver, {
  readonly list: (options: ListOptions) => Effect.Effect<string, AppDriverError>
  readonly run: (
    options: RunOptions & { readonly axes?: string }
  ) => Effect.Effect<Awaited<ReturnType<typeof runStates>>, AppDriverError>
  readonly compare: (
    before: string,
    after?: string
  ) => Effect.Effect<Awaited<ReturnType<typeof compareWithSheets>>, AppDriverError>
  readonly review: (
    run: string | undefined,
    keys: ReadonlyArray<string>
  ) => Effect.Effect<Awaited<ReturnType<typeof reviewRun>>, AppDriverError>
  readonly step: (step: Step) => Effect.Effect<string, AppDriverError>
  readonly evaluate: (expression: string) => Effect.Effect<unknown, AppDriverError>
  readonly start: Effect.Effect<string, AppDriverError>
  readonly stop: Effect.Effect<ReadonlyArray<string>, AppDriverError>
}>()("ballest/app-driver/AppDriver") {
  static readonly layer = Layer.succeed(
    AppDriver,
    AppDriver.of({
      list: ({ uncovered, views }) =>
        attempt(async () => {
          const states = await loadStates()
          if (views !== true && uncovered !== true) {
            return states.map((state) => {
              const marks = `${state.target === "desktop" ? " [desktop]" : ""}${
                state.pending === undefined ? "" : " [pending]"
              }`
              return `${state.id}${marks}: ${state.views.join(", ")}`
            }).join("\n")
          }
          const known = await inSession(liveViews)
          const named = new Set(states.flatMap((state) => state.views))
          return known.filter((view) => uncovered !== true || !named.has(view)).join("\n")
        }),
      run: ({ axes, ...options }) =>
        attempt(() => runStates({ ...options, ...(axes === undefined ? {} : { overrides: parseAxes(axes) }) })),
      compare: (before, after) => attempt(() => inSession(() => compareWithSheets(before, after ?? latestRun()))),
      review: (run, keys) => attempt(() => reviewRun(run === undefined ? latestRun() : resolveRun(run), keys)),
      step: (step) =>
        attempt(async () => {
          const page = await stepPage()
          await page.step(step, () => {
            throw new Error("a native dialog needs a desktop state")
          })
          const { settled } = await page.settle()
          const file = path.join(home, "step.png")
          await page.capture(file)
          return `${settled ? "settled" : "never settled"}, picture at ${file}`
        }),
      evaluate: (expression) => attempt(async () => (await stepPage()).evaluate(expression)),
      start: attempt(async () => {
        const url = await ensureServer()
        await ensureBrowser()
        return url
      }),
      stop: attempt(async () => {
        scratchPage.browser?.close()
        scratchPage.browser = null
        scratchPage.page = null
        return stopSession()
      })
    })
  )
}
