#!/usr/bin/env -S node --experimental-strip-types
// The game driver (docs/DRIVER.md): `serve` is the MCP server over stdio; the other commands do the same things from
// a shell. `node tools/driver/src/main.ts --help`.
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Layer, Option } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { Argument, Command, Flag } from "effect/cli"
import { Channel } from "./channel.ts"
import { Plugin } from "./plugin.ts"
import { Slots } from "./slots.ts"
import { DriverToolkit, DriverToolsLayer } from "./tools.ts"

const VERSION = "0.1.0"

const services = Layer.mergeAll(Channel.layer, Plugin.layer, Slots.layer)

const serve = Command.make("serve", {}, () =>
  Layer.launch(
    McpServer.toolkit(DriverToolkit).pipe(
      Layer.provide(DriverToolsLayer),
      Layer.provide(services),
      Layer.provide(McpServer.layerStdio({
        name: "ballest-driver",
        version: VERSION,
        instructions:
          "Runs sandboxed copies of Ballest of Them All headless under Proton and drives them through the plugin manager's test channel. Start with slot_start, look with render and state, drive the editor with open_map, tap, gamekey and command, read the game's types with types_dump, and probe the map format with map_write, open_map and map_read.",
        protocols: [McpProtocol.v2025_06_18, McpProtocol.v2025_03_26, McpProtocol.v2024_11_05]
      }))
    )
  )).pipe(Command.withDescription("The MCP server, over stdio"))

const slotFlag = Flag.Int("slot").pipe(Flag.withDescription("the slot, 1-9"), Flag.withDefault(1))

const setup = Command.make(
  "setup",
  {
    host: Flag.String("host").pipe(
      Flag.withDescription("a folder with version.dll and plugins/ to lay over the copy (default: the install's own)"),
      Flag.optional
    )
  },
  ({ host }) =>
    Effect.gen(function*() {
      const slots = yield* Slots
      const game = yield* slots.setup({ host: Option.getOrUndefined(host) })
      yield* Console.log(`game copy at ${game}`)
    })
).pipe(Command.withDescription("Copies the game install (with the plugin manager in it) into the driver's folder"))

const start = Command.make(
  "start",
  {
    slot: slotFlag,
    window: Flag.Boolean("window").pipe(
      Flag.withDescription("a 720p window instead of no window"),
      Flag.withDefault(false)
    )
  },
  ({ slot, window }) =>
    Effect.gen(function*() {
      const slots = yield* Slots
      const status = yield* slots.start(slot, window ? "window" : "headless")
      yield* Console.log(JSON.stringify(status, null, 2))
    })
).pipe(Command.withDescription("Starts a slot and waits for its menu"))

const stop = Command.make("stop", { slot: slotFlag }, ({ slot }) =>
  Effect.gen(function*() {
    const slots = yield* Slots
    yield* Console.log(`killed ${yield* slots.stop(slot)} processes`)
  })).pipe(Command.withDescription("Stops a slot"))

const status = Command.make("status", { slot: slotFlag }, ({ slot }) =>
  Effect.gen(function*() {
    const slots = yield* Slots
    yield* Console.log(JSON.stringify(yield* slots.status(slot), null, 2))
  })).pipe(Command.withDescription("A slot's state"))

const run = Command.make(
  "run",
  { slot: slotFlag, command: Argument.String("command").pipe(Argument.withDescription("a test channel command")) },
  ({ command, slot }) =>
    Effect.gen(function*() {
      const channel = yield* Channel
      for (const line of yield* channel.send(slot, command)) yield* Console.log(line)
    })
).pipe(Command.withDescription("Runs one test channel command in a slot and prints its replies"))

Command.make("driver").pipe(
  Command.withSubcommands([serve, setup, start, stop, status, run]),
  Command.run({ version: VERSION }),
  Effect.provide(services.pipe(Layer.provideMerge(NodeServices.layer))),
  NodeRuntime.runMain
)
