import { Effect, FileSystem, Path, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { Channel } from "./channel.ts"
import { decodePieces, Handler, type Measurement as Measured, PIVOT_CHOICES, type PivotChoice } from "./handler.ts"
import { Plugin } from "./plugin.ts"
import { type ProbeItem, quaternion } from "./probe.ts"
import { Probe } from "./probeMap.ts"
import { DriverError, fail, io, Slots } from "./slots.ts"
import { diffPalette, parsePalette, parseWidgets } from "./ui.ts"
import { frame, type Placement, ruler, STANDARD_VIEWS, studio } from "./views.ts"

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

const Vec3 = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite])
const Transform = Schema.Struct({
  rotation: Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]),
  location: Vec3
})
const Pivot = Schema.Literals(PIVOT_CHOICES)
const PivotState = Schema.Struct({ choice: Pivot, gizmo: Transform })
const Measurement = Schema.Struct({
  id: Schema.Finite,
  class: Schema.String,
  pivot: Pivot,
  gizmo: Transform,
  origin: Vec3,
  center: Vec3,
  faces: Schema.Struct({ bottom: Vec3, top: Vec3, left: Vec3, right: Vec3, back: Vec3, front: Vec3 }),
  bounds: Schema.Struct({ min: Vec3, max: Vec3 })
})
const Camera = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  z: Schema.Finite,
  pitch: Schema.Finite,
  yaw: Schema.Finite,
  fov: Schema.Finite
})
const VIEW_NAMES = STANDARD_VIEWS.map((v) => v.name).join(", ")
const Shot = Schema.Struct({ name: Schema.String, path: Schema.String, camera: Camera })
const Views = Schema.Struct({
  measurement: Measurement,
  pivot: Schema.NullOr(PivotState),
  views: Schema.Array(Shot)
})
const viewParams = {
  prefix: Schema.optional(Schema.String),
  gizmo: Schema.optional(Schema.Boolean),
  pivot: Schema.optional(Pivot),
  views: Schema.optional(Schema.Array(Schema.String)),
  fov: Schema.optional(Schema.Finite)
}
const ProbePiece = Schema.Struct({
  classPath: Schema.String,
  location: Schema.optional(Vec3),
  rotation: Schema.optional(Vec3).annotate({ description: "pitch, yaw, roll in degrees" }),
  scale: Schema.optional(Vec3)
})
const Opened = Schema.Struct({
  file: Schema.String,
  pieces: Schema.Array(Schema.Struct({ id: Schema.Finite, class: Schema.String }))
})
const PaletteItem = Schema.Struct({ name: Schema.String, classPath: Schema.String })
const PaletteCategory = Schema.Struct({
  index: Schema.Finite,
  name: Schema.String,
  header: Schema.String,
  tiles: Schema.Finite,
  asset: Schema.String,
  items: Schema.Array(PaletteItem)
})
const Widget = Schema.Struct({
  depth: Schema.Finite,
  class: Schema.String,
  name: Schema.String,
  visibility: Schema.String,
  enabled: Schema.Boolean,
  text: Schema.optional(Schema.String),
  checked: Schema.optional(Schema.Boolean),
  classPath: Schema.optional(Schema.String)
})
/** The details panel's own functions, by what the agent means (W_Details_C, measured with `functions`). */
const ACTIONS = {
  flip_x: "FlipSelectionX",
  flip_y: "FlipSelectionY",
  mirror_on: "SetSelectionMirrored | b:1",
  mirror_off: "SetSelectionMirrored | b:0",
  mirror_x_on: "SetSelectionMirroredX | b:1",
  mirror_x_off: "SetSelectionMirroredX | b:0",
  pivot_default: "ChooseDefault",
  pivot_center: "ChooseCenter",
  pivot_bottom: "ChooseBottom",
  pivot_top: "ChooseTop",
  pivot_left: "ChooseLeft",
  pivot_right: "ChooseRight",
  pivot_back: "ChooseBack",
  pivot_front: "ChooseFront",
  surface_default: "ChooseSurface | u8:0",
  surface_magnet: "ChooseSurface | u8:1",
  surface_grippy: "ChooseSurface | u8:2",
  surface_ice: "ChooseSurface | u8:3"
} as const
const ACTION_NAMES = [
  "flip_x",
  "flip_y",
  "mirror_on",
  "mirror_off",
  "mirror_x_on",
  "mirror_x_off",
  "pivot_default",
  "pivot_center",
  "pivot_bottom",
  "pivot_top",
  "pivot_left",
  "pivot_right",
  "pivot_back",
  "pivot_front",
  "surface_default",
  "surface_magnet",
  "surface_grippy",
  "surface_ice"
] as const satisfies ReadonlyArray<keyof typeof ACTIONS>
const ActionName = Schema.Literals(ACTION_NAMES)
/** Which of a piece's flags the details panel's actions change (BP_BaseItem, read with `props`). */
const FLAGS = new Set(["bMirror", "bMirrorX", "bSupportsMirror", "SurfaceAssignment"])
const Snapshot = Schema.Struct({
  selection: Schema.Unknown,
  pivot: Schema.NullOr(PivotState),
  flags: Schema.Record(Schema.String, Schema.String),
  panel: Schema.Array(Widget)
})

/** As much of assets/catalog.json as the palette diff reads. */
const Catalog = Schema.Struct({
  pieces: Schema.Array(Schema.Struct({
    objectPath: Schema.String,
    displayName: Schema.optional(Schema.NullOr(Schema.String)),
    category: Schema.optional(Schema.NullOr(Schema.String)),
    inPalette: Schema.optional(Schema.Boolean)
  }))
})

/** Where a probe's piece goes: well above the arena's water (at z 0) and clear of the start. */
const PROBE_AT = [0, 0, 5000] as const

const tool = <const Name extends string, P extends Schema.Struct.Fields, S extends Schema.Top>(
  name: Name,
  description: string,
  parameters: P,
  success: S
) => Tool.make(name, { description, parameters: Schema.Struct(parameters), success, failure: DriverError })

export const DriverToolkit = Toolkit.make(
  tool(
    "slot_start",
    "Starts a sandboxed copy of the game in its own Proton prefix and waits for its main menu (about 25 s). headless: no window at all; window: a 720p window. Needs the Steam client running: if it isn't, never start Steam yourself; ask the user to start it and to confirm when it is running.",
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
    "Whether Steam is running (no slot starts without it; if false, ask the user to start Steam, never start it yourself), whether a slot runs, is at its menu, and its sandbox state, with the host log's last lines.",
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
    "Opens one of the slot's saved maps in the track editor through the Create page (openmap). fragment: one word of the map's file name; the host matches only the first word and takes the first entry containing it, so check the pieces shown: `-> ok` doesn't mean it was the map you meant.",
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
    "Moves a piece to x y z and/or turns it to pitch yaw roll (degrees, absolute). Each triple goes together: give all three, because a missing one is written as 0. Returns the piece.",
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
  tool("editor_selection", "The selected pieces as JSON: id, class, location, rotation, scale.", {
    slot: slotParam
  }, PluginReply),
  tool("editor_undo", "The editor's own undo (Ctrl+Z).", { slot: slotParam }, PluginReply),
  // Through the editor's handler (callx): the selection's pivot and gizmo (docs/DRIVER.md § Pivots and the gizmo).
  tool(
    "editor_pivot",
    `The selection's pivot choice and the gizmo's transform (where the editor puts the gizmo for the selected piece: its default differs by piece, and our app copies that). With choice, sets the pivot first, as the inspector's buttons do (it stays with the piece): ${
      PIVOT_CHOICES.join(", ")
    }.`,
    { slot: slotParam, choice: Schema.optional(Pivot) },
    PivotState
  ),
  tool(
    "piece_measure",
    "Measures a piece through the editor's pivot choices: its origin, the centre of its mesh bounds and the centres of the six faces, in the world, plus a world-aligned box around them (the mesh bounds for a piece that isn't turned), with the gizmo's transform for the piece's own pivot. Leaves the piece's pivot and the selection as they were.",
    { slot: slotParam, id: Schema.Finite },
    Measurement
  ),
  tool(
    "piece_views",
    `Renders a piece of the open map from the standard views (${VIEW_NAMES}: elevations level with the piece, plans, and two raised three-quarter views), framed from its measured bounds with the editor's panels hidden; returns the measurement and one PNG per view (<prefix>-<view>.png; read the files to look). gizmo: the piece stays selected, so the editor's gizmo and selection outline show (off: nothing selected). pivot: the pivot to show the gizmo at (default: the piece's own, which is what the game picks for it; Center standardises it); put back afterwards. views: a subset of the names.`,
    { slot: slotParam, id: Schema.Finite, ...viewParams },
    Views
  ),
  // The game's UI as data (docs/DRIVER.md § The UI as data): the host fork's `palette` and `widgets` commands.
  tool(
    "palette_dump",
    "The editor's content browser as the game builds it: every category in panel order with its header, the data asset behind it, how many tiles it shows, and its items (display name, class path). The game's own catalog, for checking ours.",
    { slot: slotParam },
    Schema.Struct({ categories: Schema.Array(PaletteCategory) })
  ),
  tool(
    "palette_diff",
    "palette_dump against assets/catalog.json, by class path: pieces the game shows that the catalog lacks or doesn't mark in the palette, pieces the catalog marks that the game no longer shows, names or categories that differ, and categories whose tiles don't match their items. Empty lists mean the catalog matches the game.",
    { slot: slotParam },
    Schema.Struct({
      missingFromCatalog: Schema.Array(
        Schema.Struct({ name: Schema.String, classPath: Schema.String, category: Schema.String })
      ),
      notMarkedInPalette: Schema.Array(Schema.String),
      goneFromPalette: Schema.Array(Schema.String),
      renamed: Schema.Array(Schema.Struct({
        classPath: Schema.String,
        catalog: Schema.Struct({ displayName: Schema.String, category: Schema.String }),
        game: Schema.Struct({ displayName: Schema.String, category: Schema.String })
      })),
      tileMismatch: Schema.Array(
        Schema.Struct({ category: Schema.String, tiles: Schema.Finite, items: Schema.Finite })
      ),
      palette: Schema.Finite,
      catalog: Schema.Finite
    })
  ),
  tool(
    "ui_widgets",
    "A game widget's tree as data: every widget under the first instance of className (W_Details_C: the details panel with its pivot, flip and surface controls; W_MapEditor_C: the whole editor; W_Categories_C: the palette, tiles with their class paths) with its class, name, visibility, enabled state, text, check state. filter narrows the instance by path fragment (default Transient); depth caps the tree (default 12). At most 400 widgets.",
    {
      slot: slotParam,
      className: Schema.String,
      filter: Schema.optional(Schema.String),
      depth: Schema.optional(Schema.Finite)
    },
    Schema.Struct({ widgets: Schema.Array(Widget) })
  ),
  tool(
    "editor_action",
    `One of the details panel's actions on the selection, through the panel's own function (as its button would), with a snapshot before and after: the selected pieces, the pivot and gizmo, the first selected piece's mirror and surface flags, and the panel's controls. Actions: ${
      ACTION_NAMES.join(", ")
    }. Select the piece first (editor_select).`,
    { slot: slotParam, action: ActionName },
    Schema.Struct({ action: Schema.String, call: Schema.String, before: Snapshot, after: Snapshot })
  ),
  // Probes: the slot's own probe map, written and opened (docs/DRIVER.md § Probe maps).
  tool(
    "probe_map",
    "Writes the slot's probe map with just these pieces (class paths as the catalog writes them; location default 0 0 5000, above the arena's water at z 0; rotation pitch yaw roll; scale) and opens it in the editor by way of the main menu (about 10 s). Returns the pieces as the editor shows them, with their ids. The file is overwritten by the next probe and reset by piece_turntable; nothing is saved unless the editor saves.",
    { slot: slotParam, pieces: Schema.Array(ProbePiece) },
    Opened
  ),
  tool(
    "piece_turntable",
    `Evaluates one piece by class from nothing: opens the probe map with it alone (at 0 0 5000; rotation and scale optional), measures it, puts up a studio around it (six large cubes, so every view has a plain wall behind the piece instead of the arena; off: the arena shows), optionally a 100 cm cube beside it as a ruler for gauging texture scale, then renders the standard views as piece_views does (gizmo, pivot, views, fov as there), and resets the probe map file. Returns the measurement, the gizmo transform and the PNGs. About 30 s.`,
    {
      slot: slotParam,
      classPath: Schema.String,
      rotation: Schema.optional(Vec3).annotate({ description: "pitch, yaw, roll in degrees" }),
      scale: Schema.optional(Vec3),
      studio: Schema.optional(Schema.Boolean),
      ruler: Schema.optional(Schema.Boolean),
      ...viewParams
    },
    Schema.Struct({ ...Views.fields, id: Schema.Finite, probe: Schema.String })
  ),
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
  const handler = yield* Handler
  const probe = yield* Probe
  const call = (slot: number | undefined, op: string, args?: Record<string, unknown>) =>
    plugin.call(n(slot), op, args).pipe(Effect.map((reply) => ({ reply })))
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const run = (slot: number | undefined, command: string, timeoutMs?: number) =>
    channel.send(n(slot), command, timeoutMs).pipe(Effect.map((replies) => ({ replies })))
  const render = (slot: number, name: string) =>
    Effect.gen(function*() {
      const safe = name.replace(/[^A-Za-z0-9_-]/g, "_")
      const replies = yield* channel.send(slot, `render ${safe}`, 20_000)
      const done = replies.find((r) => r.startsWith("render -> "))
      if (done === undefined || done.includes("failed")) return yield* fail(`render: ${replies.join(" | ")}`)
      return path.join(slots.paths(slot).data, `${safe}.png`)
    })

  const probeItem = (p: {
    readonly classPath: string
    readonly location?: readonly [number, number, number] | undefined
    readonly rotation?: readonly [number, number, number] | undefined
    readonly scale?: readonly [number, number, number] | undefined
  }): ProbeItem => ({
    classPath: classPath(p.classPath),
    ...(p.location === undefined ? {} : { location: p.location }),
    ...(p.rotation === undefined ? {} : { rotation: quaternion(p.rotation[0], p.rotation[1], p.rotation[2]) }),
    ...(p.scale === undefined ? {} : { scale: p.scale })
  })

  /** The standard views of a measured piece: the selection, pivot, panels and camera set up and put back around them. */
  const shoot = (
    s: number,
    id: number,
    measurement: Measured,
    o: {
      readonly fov?: number | undefined
      readonly gizmo?: boolean | undefined
      readonly pivot?: PivotChoice | undefined
      readonly prefix?: string | undefined
      readonly views?: ReadonlyArray<string> | undefined
    }
  ) =>
    Effect.gen(function*() {
      const chosen = yield* Effect.forEach(o.views ?? STANDARD_VIEWS.map((v) => v.name), (name) => {
        const view = STANDARD_VIEWS.find((v) => v.name === name)
        return view === undefined ? fail(`no view ${name}; the views are ${VIEW_NAMES}`) : Effect.succeed(view)
      })
      const before = (yield* decodePieces(yield* plugin.call(s, "selection"))).pieces.map((p) => p.id)
      const restore = Effect.gen(function*() {
        yield* plugin.call(s, "camera_release")
        yield* plugin.call(s, "hide_editor", { on: false })
        if (o.gizmo === true && o.pivot !== undefined) yield* handler.setPivot(s, measurement.pivot)
        yield* plugin.call(s, "select", { ids: before })
      }).pipe(Effect.ignore)
      const take = Effect.gen(function*() {
        yield* plugin.call(s, "select", { ids: o.gizmo === true ? [id] : [] })
        let state = null
        if (o.gizmo === true) {
          state = o.pivot === undefined
            ? yield* handler.pivot(s)
            : yield* handler.setPivot(s, o.pivot)
        }
        yield* plugin.call(s, "hide_editor", { on: true })
        const shots: Array<{ name: string; path: string; camera: ReturnType<typeof frame> }> = []
        for (const view of chosen) {
          const camera = frame(measurement.bounds, view, o.fov ?? 60)
          yield* plugin.call(s, "camera", { ...camera })
          yield* Effect.sleep("250 millis")
          const file = yield* render(s, `${o.prefix ?? `piece-${id}`}-${view.name}`)
          shots.push({ name: view.name, path: file, camera })
        }
        return { measurement, pivot: state, views: shots }
      })
      return yield* take.pipe(Effect.ensuring(restore))
    })

  const paletteDump = (s: number) =>
    Effect.gen(function*() {
      const replies = yield* channel.send(s, "palette", 30_000)
      if (!replies.some((r) => r.startsWith("palette -> ") && r.includes("categories"))) {
        return yield* fail(
          `palette: ${replies.join(" | ")} (the host needs the fork's palette command; see tools/driver/README.md)`
        )
      }
      return parsePalette(replies)
    })

  const widgets = (s: number, className: string, filter: string, depth: number) =>
    Effect.gen(function*() {
      const replies = yield* channel.send(
        s,
        `widgets ${quoted(className)} ${quoted(filter)} ${Math.round(depth)}`,
        30_000
      )
      if (!replies.some((r) => r.startsWith("widgets ") && r.includes(" -> /"))) {
        return yield* fail(
          `widgets: ${replies.join(" | ")} (the host needs the fork's widgets command; see tools/driver/README.md)`
        )
      }
      return parseWidgets(replies)
    })

  /** What the details panel's actions can change, read before and after one. */
  const snapshot = (s: number) =>
    Effect.gen(function*() {
      const selection = yield* plugin.call(s, "selection")
      const selected = (yield* decodePieces(selection)).pieces
      const pivot = selected.length === 0 ? null : yield* handler.pivot(s)
      const flags: Record<string, string> = {}
      const first = selected[0]
      if (first !== undefined) {
        // `props` reports the first live instance of the class: exact for one selected piece of its class.
        const lines = yield* channel.send(s, `props ${first.class} PersistentLevel`)
        for (const line of lines) {
          const m = /^ {2}(\S+) \((\w+)\) @\S+ size \d+ = ([0-9a-f]+)$/.exec(line)
          if (m !== null && FLAGS.has(m[1] ?? "")) flags[m[1] ?? ""] = m[3] ?? ""
        }
      }
      const panel = (yield* widgets(s, "W_Details_C", "Transient", 8)).filter((w) =>
        /^(Flip|Pivot|Surface|GroupName|Mirror)/.test(w.name)
      )
      return { selection, pivot, flags, panel }
    })

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
    render: ({ name, slot }) => render(n(slot), name ?? "render").pipe(Effect.map((file) => ({ path: file }))),
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
    editor_selection: ({ slot }) => call(slot, "selection"),
    editor_undo: ({ slot }) => call(slot, "undo"),
    editor_pivot: ({ choice, slot }) =>
      choice === undefined ? handler.pivot(n(slot)) : handler.setPivot(n(slot), choice),
    piece_measure: ({ id, slot }) => handler.measure(n(slot), id),
    piece_views: ({ fov, gizmo, id, pivot, prefix, slot, views }) =>
      Effect.gen(function*() {
        const s = n(slot)
        const measurement = yield* handler.measure(s, id)
        return yield* shoot(s, id, measurement, { fov, gizmo, pivot, prefix, views })
      }),
    palette_dump: ({ slot }) => paletteDump(n(slot)).pipe(Effect.map((categories) => ({ categories }))),
    palette_diff: ({ slot }) =>
      Effect.gen(function*() {
        const palette = yield* paletteDump(n(slot))
        const file = path.resolve(import.meta.dirname, "..", "..", "..", "assets", "catalog.json")
        const text = yield* io(fs.readFileString(file), "reading the catalog")
        const catalog = yield* Schema.decodeUnknownEffect(Catalog)(JSON.parse(text)).pipe(
          Effect.mapError((e) => fail(`assets/catalog.json isn't the shape the diff expects: ${String(e)}`))
        )
        return {
          ...diffPalette(palette, catalog.pieces),
          palette: palette.reduce((sum, c) => sum + c.items.length, 0),
          catalog: catalog.pieces.filter((p) => p.inPalette === true).length
        }
      }),
    ui_widgets: ({ className, depth, filter, slot }) =>
      widgets(n(slot), className, filter ?? "Transient", depth ?? 12).pipe(Effect.map((w) => ({ widgets: w }))),
    editor_action: ({ action, slot }) =>
      Effect.gen(function*() {
        const s = n(slot)
        const before = yield* snapshot(s)
        const [fn, args] = ACTIONS[action].split(" | ")
        const command = `callx W_Details_C ${fn} Transient${args === undefined ? "" : ` | ${args}`}`
        const replies = yield* channel.send(s, command)
        if (!replies.some((r) => r.startsWith("callx ") && r.includes(" ok"))) {
          return yield* fail(`${action}: ${replies.join(" | ")}`)
        }
        yield* Effect.sleep("300 millis")
        return { action, call: command, before, after: yield* snapshot(s) }
      }),
    probe_map: ({ pieces, slot }) => probe.open(n(slot), pieces.map(probeItem)),
    piece_turntable: (
      { classPath: cls, fov, gizmo, pivot, prefix, rotation, ruler: withRuler, scale, slot, studio: withStudio, views }
    ) =>
      Effect.gen(function*() {
        const s = n(slot)
        const opened = yield* probe.open(s, [probeItem({ classPath: cls, location: PROBE_AT, rotation, scale })])
        const subject = opened.pieces.find((p) => !p.class.includes("PlayerStart"))
        if (subject === undefined) {
          return yield* fail(`the probe map opened without the piece: ${JSON.stringify(opened.pieces)}`)
        }
        const measurement = yield* handler.measure(s, subject.id)
        const props: Array<Placement> = withStudio === false ? [] : [...studio(measurement.bounds)]
        if (withRuler === true) props.push(ruler(measurement.bounds))
        if (props.length > 0) {
          yield* plugin.call(s, "spawn", {
            classes: props.map((p) => p.classPath),
            transforms: props.flatMap((p) => [...p.location, ...p.rotation, ...p.scale]),
            drop: false
          })
          yield* plugin.call(s, "select", { ids: [] })
        }
        const shots = yield* shoot(s, subject.id, measurement, {
          fov,
          gizmo,
          pivot,
          prefix: prefix ?? `turntable-${subject.class}`,
          views
        }).pipe(
          Effect.ensuring(probe.reset(s).pipe(Effect.ignore))
        )
        return { ...shots, id: subject.id, probe: opened.file }
      }),
    camera_set: ({ fov, pitch, slot, x, y, yaw, z }) => call(slot, "camera", { x, y, z, pitch, yaw, fov: fov ?? 90 }),
    camera_release: ({ slot }) => call(slot, "camera_release"),
    hide_editor: ({ on, slot }) => call(slot, "hide_editor", { on: on ?? true }),
    plugin_call: ({ args, op, slot }) => call(slot, op, args)
  })
}))
