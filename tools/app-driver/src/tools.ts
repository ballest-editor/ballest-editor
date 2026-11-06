import { Effect, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { AppDriver, AppDriverError } from "./driver.ts"
import type { Step } from "./state.ts"

// The MCP tools: the same operations as the CLI. Pictures stay on disk and come back as paths, a contact sheet first.

const Report = Schema.Struct({
  dir: Schema.String,
  summary: Schema.String,
  sheets: Schema.Array(Schema.String),
  failed: Schema.Boolean
})
const Text = Schema.Struct({ text: Schema.String })

const strings = Schema.optional(Schema.Array(Schema.String))

const tool = <const N extends string, P extends Schema.Struct.Fields, S extends Schema.Top>(
  name: N,
  description: string,
  parameters: P,
  success: S
) => Tool.make(name, { description, parameters: Schema.Struct(parameters), success, failure: AppDriverError })

export const AppDriverToolkit = Toolkit.make(
  tool(
    "app_list",
    "Lists declared states. views: every view the app has; uncovered: views with no state.",
    { views: Schema.optional(Schema.Boolean), uncovered: Schema.optional(Schema.Boolean) },
    Text
  ),
  tool(
    "app_run",
    "Runs states (all when none are named) in this worktree's own browser and returns a small summary and contact sheet paths. since: a run to compare with, so the sheets hold only what changed. axes: for example theme=light,window=*. Open full-size pictures from dir/shots only when the sheet isn't enough.",
    {
      states: strings,
      views: strings,
      axes: Schema.optional(Schema.String),
      smoke: Schema.optional(Schema.Boolean),
      repeat: Schema.optional(Schema.Finite),
      since: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String)
    },
    Report
  ),
  tool(
    "app_compare",
    "Compares two runs, by name or folder (after defaults to the newest run here): a table of what changed and side-by-side sheets of the changed states.",
    { before: Schema.String, after: Schema.optional(Schema.String) },
    Schema.Struct({ table: Schema.String, changed: Schema.Array(Schema.String), sheets: Schema.Array(Schema.String) })
  ),
  tool(
    "app_step",
    "Runs one step on a scratch page and settles, for exploring: step is a Step from tools/app-driver/src/state.ts, such as {\"do\":\"click\",\"at\":\"button\"} or {\"do\":\"app\",\"call\":\"select\",\"args\":[\"\",1]}.",
    { step: Schema.Unknown },
    Text
  ),
  tool(
    "app_evaluate",
    "Evaluates an expression on the scratch page and returns its JSON: for measuring something no probe covers.",
    { expression: Schema.String },
    Schema.Struct({ value: Schema.Unknown })
  ),
  Tool.make("app_stop", {
    description: "Stops this worktree's dev server and browser, by the pids it recorded, and nothing else.",
    parameters: Tool.EmptyParams,
    success: Text,
    failure: AppDriverError
  })
)

export const AppDriverToolsLayer = AppDriverToolkit.toLayer(Effect.gen(function*() {
  const driver = yield* AppDriver
  const text = <E>(effect: Effect.Effect<string, E>) => effect.pipe(Effect.map((value) => ({ text: value })))
  return AppDriverToolkit.of({
    app_list: ({ uncovered, views }) => text(driver.list({ uncovered: uncovered === true, views: views === true })),
    app_run: ({ axes, name, repeat, since, smoke, states, views }) =>
      driver.run({
        states: states ?? [],
        views: views ?? [],
        smoke: smoke === true,
        repeat: repeat ?? 1,
        ...(axes === undefined ? {} : { axes }),
        ...(name === undefined ? {} : { name }),
        ...(since === undefined ? {} : { since })
      }),
    app_compare: ({ after, before }) => driver.compare(before, after),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an agent's step; the page refuses one it can't run
    app_step: ({ step }) => text(driver.step(step as Step)),
    app_evaluate: ({ expression }) => driver.evaluate(expression).pipe(Effect.map((value) => ({ value }))),
    app_stop: () => text(driver.stop.pipe(Effect.map((stopped) => `stopped: ${stopped.join(", ") || "nothing"}`)))
  })
}))
