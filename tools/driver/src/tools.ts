import { Effect, FileSystem, Path, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { Channel } from "./channel.ts"
import { Plugin } from "./plugin.ts"
import { DriverError, fail, io, Slots } from "./slots.ts"

// The MCP tools (docs/DRIVER.md § Tools). Each is a thin wrapper over the host's test channel or the slots; replies
// come back as the host wrote them. Pictures and dumps stay on disk and come back as paths.

const slotParam = Schema.optional(Schema.Finite).annotate({ description: "the slot, 1-9 (default 1)" })
const Replies = Schema.Struct({ replies: Schema.Array(Schema.String) })
const PluginReply = Schema.Struct({ reply: Schema.Unknown })
const Status = Schema.Struct({
  slot: Schema.Finite,
  steam: Schema.Boolean,
  running: Schema.Boolean,
  ready: Schema.Boolean,
  sandbox: Schema.Literals(["off", "starting", "incomplete", "complete"]),
  hostVersion: Schema.NullOr(Schema.String),
  dir: Schema.String,
  log: Schema.Array(Schema.String)
})

const tool = <const Name extends string, P extends Schema.Struct.Fields, S extends Schema.Top>(
  name: Name,
  description: string,
  parameters: P,
  success: S
) => Tool.make(name, { description, parameters: Schema.Struct(parameters), success, failure: DriverError })

export const DriverToolkit = Toolkit.make(
  tool(
    "slot_start",
    "Starts a sandboxed copy of the game in its own Proton prefix and waits for its main menu (about 25 s). headless: no window at all; window: a 720p window.",
    { slot: slotParam, mode: Schema.optional(Schema.Literals(["headless", "window"])) },
    Status
  ),
  tool(
    "slot_stop",
    "Stops a slot: every process of its prefix.",
    { slot: slotParam },
    Schema.Struct({ killed: Schema.Finite })
  ),
  tool(
    "slot_status",
    "Whether Steam is running (no slot starts without it), whether a slot runs, is at its menu, and its sandbox state, with the host log's last lines.",
    {
      slot: slotParam
    },
    Status
  ),
  tool("slot_log", "The last lines of a slot's host.log (the host's and the plugins' log, where test replies go).", {
    slot: slotParam,
    lines: Schema.optional(Schema.Finite)
  }, Schema.Struct({ lines: Schema.Array(Schema.String) })),
  tool(
    "command",
    "Runs one of the host's test channel commands in a slot and returns its reply lines: state, click <label>, select, type, tap <x> <y>, gamekey <key>, editorcam, editor pieces|select|screen, open <map>, openmap <name>, dumptypes, props <Class>, find <name>, functions <Class>, instances <Class>, materials, callx <Class> <Function>, seq a || b ... Commands that change the game need the sandbox complete.",
    { slot: slotParam, command: Schema.String, timeoutMs: Schema.optional(Schema.Finite) },
    Replies
  ),
  tool(
    "state",
    "What is on screen as the host lists it: the footer, windows, buttons and texts.",
    { slot: slotParam },
    Replies
  ),
  tool(
    "agent_state",
    "The game's state as JSON: race, track, ball, camera, whether the editor is open.",
    { slot: slotParam },
    Schema.Struct({ state: Schema.Unknown })
  ),
  tool(
    "render",
    "A PNG of the slot's whole frame (1280x720, HUD included), headless too. Returns its path; read the file to look at it.",
    { slot: slotParam, name: Schema.optional(Schema.String) },
    Schema.Struct({ path: Schema.String })
  ),
  tool(
    "open_map",
    "Opens one of the slot's saved maps in the track editor through the Create page (openmap). fragment: part of the map's file name.",
    { slot: slotParam, fragment: Schema.String },
    Replies
  ),
  tool(
    "map_list",
    "The slot's saved maps (its UserSavedMaps folder).",
    { slot: slotParam },
    Schema.Struct({ files: Schema.Array(Schema.String) })
  ),
  tool(
    "map_read",
    "A saved map's JSON text, by file name.",
    { slot: slotParam, fileName: Schema.String },
    Schema.Struct({ json: Schema.String })
  ),
  tool(
    "map_write",
    "Writes a map (its JSON text) into the slot's UserSavedMaps under fileName (Map_LevelEditorMain&<name>_<creator>.balledit). The game lists maps at launch, so open it with open_map after a slot restart, or overwrite one that exists.",
    { slot: slotParam, fileName: Schema.String, json: Schema.String },
    Schema.Struct({ path: Schema.String })
  ),
  tool(
    "types_dump",
    "Runs dumptypes: every class, struct and enum of the running game with offsets and types (types.txt) and a Ballest.usmap for this build, copied into the slot's types folder.",
    { slot: slotParam },
    Schema.Struct({ typesTxt: Schema.String, usmap: Schema.String })
  ),
  tool("tap", "A click at a pixel of the render picture (no window needed).", {
    slot: slotParam,
    x: Schema.Finite,
    y: Schema.Finite
  }, Replies),
  tool(
    "gamekey",
    "A game key through the game's own input (T, W, SpaceBar, Escape, ...), held for frames (default 2).",
    { slot: slotParam, key: Schema.String, frames: Schema.optional(Schema.Finite) },
    Replies
  ),
  tool("editor_pieces", "The open map's pieces with their ids, classes and positions.", { slot: slotParam }, Replies),
  tool(
    "editor_camera",
    "Moves the track editor's camera: to x y z with pitch and yaw, or lookat x y z, or frame <piece id> [distance]. Without arguments, reads it.",
    { slot: slotParam, args: Schema.optional(Schema.String) },
    Replies
  ),
  // Through the driver plugin (packages/ballest-driver), the script API's own calls; the editor must be open.
  tool(
    "editor_spawn",
    "Places pieces in the open map the way the editor pastes (one undo step, left selected): classes are class paths as the catalog and map files write them; transforms hold nine numbers per class: x y z, pitch yaw roll (degrees), scale x y z. Returns the new pieces.",
    {
      slot: slotParam,
      classes: Schema.Array(Schema.String),
      transforms: Schema.Array(Schema.Finite),
      drop: Schema.optional(Schema.Boolean)
    },
    PluginReply
  ),
  tool("editor_pieces_json", "Every piece of the open map as JSON: id, class, location, rotation, scale.", {
    slot: slotParam
  }, PluginReply),
  tool(
    "editor_transform",
    "Moves a piece to x y z and/or turns it to pitch yaw roll (degrees, absolute). Returns the piece.",
    {
      slot: slotParam,
      id: Schema.Finite,
      x: Schema.optional(Schema.Finite),
      y: Schema.optional(Schema.Finite),
      z: Schema.optional(Schema.Finite),
      pitch: Schema.optional(Schema.Finite),
      yaw: Schema.optional(Schema.Finite),
      roll: Schema.optional(Schema.Finite)
    },
    PluginReply
  ),
  tool("editor_select", "Selects exactly these pieces, with the editor's gizmo.", {
    slot: slotParam,
    ids: Schema.Array(Schema.Finite)
  }, PluginReply),
  tool("editor_undo", "The editor's own undo (Ctrl+Z).", { slot: slotParam }, PluginReply),
  tool(
    "camera_set",
    "Takes the camera: at x y z, looking pitch (up/down) and yaw (around), with fov degrees (default 90). camera_release gives it back.",
    {
      slot: slotParam,
      x: Schema.Finite,
      y: Schema.Finite,
      z: Schema.Finite,
      pitch: Schema.Finite,
      yaw: Schema.Finite,
      fov: Schema.optional(Schema.Finite)
    },
    PluginReply
  ),
  tool("camera_release", "Gives the camera back to the game.", { slot: slotParam }, PluginReply),
  tool("hide_editor", "Hides (or shows again) the track editor's panels, for a clean render of the world.", {
    slot: slotParam,
    on: Schema.optional(Schema.Boolean)
  }, PluginReply),
  tool(
    "plugin_call",
    "Any op of the driver plugin with its JSON arguments (see packages/ballest-driver/main.as): ping, project {x,y,z}, redo, ...",
    { slot: slotParam, op: Schema.String, args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)) },
    PluginReply
  )
)

const n = (slot: number | undefined) => slot ?? 1
const quoted = (s: string) => s.replace(/[\r\n]/g, " ")
/** A class path as SpawnPieces wants it: the catalog and map files wrap it as `/Script/Engine.BlueprintGeneratedClass'<path>'`. */
const classPath = (s: string) => /'(.+)'$/.exec(s)?.[1] ?? s

export const DriverToolsLayer = DriverToolkit.toLayer(Effect.gen(function*() {
  const slots = yield* Slots
  const channel = yield* Channel
  const plugin = yield* Plugin
  const call = (slot: number | undefined, op: string, args?: Record<string, unknown>) =>
    plugin.call(n(slot), op, args).pipe(Effect.map((reply) => ({ reply })))
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const run = (slot: number | undefined, command: string, timeoutMs?: number) =>
    channel.send(n(slot), command, timeoutMs).pipe(Effect.map((replies) => ({ replies })))

  return DriverToolkit.of({
    slot_start: ({ mode, slot }) => slots.start(n(slot), mode ?? "headless"),
    slot_stop: ({ slot }) => slots.stop(n(slot)).pipe(Effect.map((killed) => ({ killed }))),
    slot_status: ({ slot }) => slots.status(n(slot)),
    slot_log: ({ lines, slot }) => slots.log(n(slot), lines ?? 60).pipe(Effect.map((l) => ({ lines: l }))),
    command: ({ command, slot, timeoutMs }) => run(slot, quoted(command), timeoutMs),
    state: ({ slot }) => run(slot, "state"),
    agent_state: ({ slot }) =>
      Effect.gen(function*() {
        const replies = yield* channel.send(n(slot), "agentstate")
        const line = replies.find((r) => r.startsWith("agentstate "))
        if (line === undefined) return yield* fail(`no state in the reply: ${replies.join(" | ")}`)
        return { state: JSON.parse(line.slice("agentstate ".length)) as unknown }
      }),
    render: ({ name, slot }) =>
      Effect.gen(function*() {
        const safe = (name ?? "render").replace(/[^A-Za-z0-9_-]/g, "_")
        const replies = yield* channel.send(n(slot), `render ${safe}`, 20_000)
        const done = replies.find((r) => r.startsWith("render -> "))
        if (done === undefined || done.includes("failed")) return yield* fail(`render: ${replies.join(" | ")}`)
        return { path: path.join(slots.paths(n(slot)).data, `${safe}.png`) }
      }),
    open_map: ({ fragment, slot }) => run(slot, `openmap ${quoted(fragment)}`, 30_000),
    map_list: ({ slot }) =>
      io(fs.readDirectory(slots.paths(n(slot)).maps), "listing the maps").pipe(
        Effect.map((files) => ({ files: files.filter((f) => f.endsWith(".balledit")).sort() }))
      ),
    map_read: ({ fileName, slot }) =>
      io(fs.readFileString(path.join(slots.paths(n(slot)).maps, path.basename(fileName))), "reading the map").pipe(
        Effect.map((json) => ({ json }))
      ),
    map_write: ({ fileName, json, slot }) =>
      Effect.gen(function*() {
        const file = path.join(slots.paths(n(slot)).maps, path.basename(fileName))
        yield* Effect.try({ try: () => JSON.parse(json) as unknown, catch: () => fail("the map isn't valid JSON") })
        yield* io(fs.makeDirectory(path.dirname(file), { recursive: true }), "creating the maps folder")
        yield* io(fs.writeFileString(file, json), "writing the map")
        return { path: file }
      }),
    types_dump: ({ slot }) =>
      Effect.gen(function*() {
        const replies = yield* channel.send(n(slot), "dumptypes", 30_000)
        if (!replies.some((r) => r.startsWith("dump written"))) return yield* fail(`dumptypes: ${replies.join(" | ")}`)
        const s = slots.paths(n(slot))
        yield* io(fs.makeDirectory(s.types, { recursive: true }), "creating the types folder")
        const copies: Array<string> = []
        for (const name of ["types.txt", "Ballest.usmap"]) {
          const to = path.join(s.types, name)
          yield* io(fs.copyFile(path.join(s.data, "types", name), to), `copying ${name}`)
          copies.push(to)
        }
        return { typesTxt: copies[0] ?? "", usmap: copies[1] ?? "" }
      }),
    tap: ({ slot, x, y }) => run(slot, `tap ${Math.round(x)} ${Math.round(y)}`),
    gamekey: ({ frames, key, slot }) => run(slot, `gamekey ${quoted(key)} ${frames ?? 2}`),
    editor_pieces: ({ slot }) => run(slot, "editor pieces"),
    editor_camera: ({ args, slot }) => run(slot, `editorcam${args === undefined ? "" : ` ${quoted(args)}`}`),
    editor_spawn: ({ classes, drop, slot, transforms }) =>
      call(slot, "spawn", { classes: classes.map(classPath), transforms, drop: drop ?? false }),
    editor_pieces_json: ({ slot }) => call(slot, "pieces"),
    editor_transform: ({ id, pitch, roll, slot, x, y, yaw, z }) =>
      call(slot, "transform", { id, x, y, z, pitch, yaw, roll }),
    editor_select: ({ ids, slot }) => call(slot, "select", { ids }),
    editor_undo: ({ slot }) => call(slot, "undo"),
    camera_set: ({ fov, pitch, slot, x, y, yaw, z }) => call(slot, "camera", { x, y, z, pitch, yaw, fov: fov ?? 90 }),
    camera_release: ({ slot }) => call(slot, "camera_release"),
    hide_editor: ({ on, slot }) => call(slot, "hide_editor", { on: on ?? true }),
    plugin_call: ({ args, op, slot }) => call(slot, op, args)
  })
}))
