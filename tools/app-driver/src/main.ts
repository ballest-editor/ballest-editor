#!/usr/bin/env -S node --experimental-strip-types
// The app driver (tools/app-driver/README.md): `serve` is the MCP server over stdio; the other commands do the same
// things from a shell. `node tools/app-driver/src/main.ts --help`.
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Layer, Option } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { Argument, Command, Flag } from "effect/cli"
import * as path from "node:path"
import NodeProcess from "node:process"
import { AppDriver } from "./driver.ts"
import { readResults } from "./report.ts"
import { AppDriverToolkit, AppDriverToolsLayer } from "./tools.ts"

const VERSION = "0.1.0"

const serve = Command.make("serve", {}, () =>
  Layer.launch(
    McpServer.toolkit(AppDriverToolkit).pipe(
      Layer.provide(AppDriverToolsLayer),
      Layer.provide(AppDriver.layer),
      Layer.provide(McpServer.layerStdio({
        name: "ballest-app-driver",
        version: VERSION,
        instructions:
          "Puts Ballest Editor into a declared state in this worktree's own headless browser, then captures, measures or compares it. Use this instead of writing a browser script. app_list shows the states, app_run runs them and returns a summary and contact sheet paths, app_compare compares two runs, app_step and app_evaluate explore on a scratch page. Read the contact sheet before any full-size picture.",
        protocols: [McpProtocol.v2025_06_18, McpProtocol.v2025_03_26, McpProtocol.v2024_11_05]
      }))
    )
  )).pipe(Command.withDescription("The MCP server, over stdio"))

const list = Command.make(
  "list",
  {
    views: Flag.Boolean("views").pipe(Flag.withDescription("every view the app has"), Flag.withDefault(false)),
    uncovered: Flag.Boolean("uncovered").pipe(Flag.withDescription("views with no state"), Flag.withDefault(false))
  },
  (options) => AppDriver.use((driver) => driver.list(options)).pipe(Effect.flatMap(Console.log))
).pipe(Command.withDescription("Lists the states, or the views"))

const many = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), Flag.atLeast(0))
const maybe = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), Flag.optional)
const toggle = (name: string, description: string) =>
  Flag.Boolean(name).pipe(Flag.withDescription(description), Flag.withDefault(false))

const printReport = (
  report: { readonly dir: string; readonly summary: string; readonly sheets: ReadonlyArray<string> }
) =>
  Console.log(
    [report.summary.trimEnd(), "", `run: ${report.dir}`, ...report.sheets.map((sheet) => `sheet: ${sheet}`)].join("\n")
  )

const runCommand = Command.make(
  "run",
  {
    state: many("state", "a state's id (repeatable; default all)"),
    view: many("view", "every state showing this view (repeatable)"),
    axes: maybe("axes", "a cross product, such as theme=light,window=*"),
    smoke: toggle("smoke", "default axes only"),
    repeat: Flag.Int("repeat").pipe(
      Flag.withDescription("run each this many times to find noise"),
      Flag.withDefault(1)
    ),
    since: maybe("since", "a run to compare with; sheets then hold only what changed"),
    name: maybe("name", "this run's name (default: the time)"),
    jobs: Flag.Int("jobs").pipe(Flag.withDescription("browser captures at once"), Flag.withDefault(1)),
    gpu: toggle("gpu", "the real GPU, for frame times; pictures aren't comparable")
  },
  ({ axes, gpu, jobs, name, repeat, since, smoke, state, view }) =>
    Effect.gen(function*() {
      const driver = yield* AppDriver
      const report = yield* driver.run({
        states: state,
        views: view,
        smoke,
        repeat,
        gpu,
        jobs,
        ...Option.match(axes, { onNone: () => ({}), onSome: (value) => ({ axes: value }) }),
        ...Option.match(since, { onNone: () => ({}), onSome: (value) => ({ since: value }) }),
        ...Option.match(name, { onNone: () => ({}), onSome: (value) => ({ name: value }) })
      })
      yield* printReport(report)
      if (report.failed) NodeProcess.exitCode = 1
    })
).pipe(Command.withDescription("Runs states and writes a run folder"))

const capture = Command.make(
  "capture",
  {
    state: Argument.String("state").pipe(Argument.withDescription("the state's id")),
    axes: maybe("axes", "axis values, such as theme=light")
  },
  ({ axes, state }) =>
    AppDriver.use((driver) =>
      driver.run({
        states: [state],
        smoke: true,
        ...Option.match(axes, { onNone: () => ({}), onSome: (value) => ({ axes: value }) })
      })
    ).pipe(
      Effect.tap(printReport),
      Effect.flatMap(({ dir }) =>
        Console.log(
          readResults(dir).map(({ metrics, shot }) => `${JSON.stringify(metrics)}\n${path.join(dir, shot)}`).join("\n")
        )
      )
    )
).pipe(Command.withDescription("One state at its default axes, with its measurements"))

const compare = Command.make(
  "compare",
  {
    before: Argument.String("before").pipe(Argument.withDescription("a run's name or folder")),
    after: Argument.String("after").pipe(Argument.withDescription("a run's name or folder"), Argument.optional)
  },
  ({ after, before }) =>
    Effect.gen(function*() {
      const driver = yield* AppDriver
      const report = yield* driver.compare(before, Option.getOrUndefined(after))
      yield* Console.log(
        [report.table === "" ? "No state changed." : report.table, ...report.sheets.map((sheet) => `sheet: ${sheet}`)]
          .join("\n")
      )
    })
).pipe(Command.withDescription("What changed between two runs"))

const review = Command.make(
  "review",
  {
    run: Argument.String("run").pipe(Argument.withDescription("a run (default the newest)"), Argument.optional),
    state: many("state", "a state or capture to review (repeatable; default all)")
  },
  ({ run, state }) =>
    AppDriver.use((driver) => driver.review(Option.getOrUndefined(run), state)).pipe(
      Effect.flatMap((findings) =>
        Console.log(
          findings.length === 0
            ? "No findings."
            : findings.map(({ issue, key, severity }) => `${severity} ${key}: ${issue}`).join("\n")
        )
      )
    )
).pipe(Command.withDescription("A stateless model review of each capture; costs money, never in CI"))

const start = Command.make(
  "start",
  {},
  () => AppDriver.use((driver) => driver.start).pipe(Effect.flatMap((url) => Console.log(`up on ${url}`)))
).pipe(
  Command.withDescription("Keeps this worktree's server and browser up between commands")
)

const stop = Command.make("stop", {}, () =>
  AppDriver.use((driver) => driver.stop).pipe(
    Effect.flatMap((stopped) => Console.log(`stopped: ${stopped.join(", ") || "nothing"}`))
  )).pipe(Command.withDescription("Stops what this worktree started, by pid"))

Command.make("app-driver").pipe(
  Command.withSubcommands([serve, list, runCommand, capture, compare, review, start, stop]),
  Command.run({ version: VERSION }),
  Effect.provide(AppDriver.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  NodeRuntime.runMain
)
