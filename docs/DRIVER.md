# Game driver: an MCP server that runs and drives the game for agents

Status: built, and this page holds its design and what was measured (written 2026-11-03). `tools/driver/` is an MCP
server `.mcp.json` registers. It runs slots and the file channel, and [its README](../tools/driver/README.md) lists its
tools and how to run them. The driver plugin (`packages/ballest-driver`) backs the ones that go through the script API.
Not built: the rendering comparisons, feeding `Ballest.usmap` into `tools/extract`, and the pipe bridge (§ Order of
work). The spike's files are in `~/.cache/ballest-editor/driver-spike/`; the driver's own live in
`~/.cache/ballest-editor/driver/`.

## What it is for

Two jobs, both of which so far cost a long session of hand work each time:

1. **Support changes after a game patch.** The 0.4.1 refresh (#155) needed the user to build a probe map in the in-game
   editor, by hand, step by step from a written list, so the agent could learn how surfaces and mirroring are saved.
   Before that it grepped the exe for property names and still could not learn the elevator's speed labels. With a
   driver, an agent builds the probe itself, saves it, and reads the file.
2. **Rendering checks.** A driver places one piece in the game, frames it with the game's camera, takes a picture,
   and the editor renders the same piece the same way for a side-by-side. It also answers what no picture can: the
   live components' transforms and visibility (`callx`, `objprop`), a dynamic material's parameters, the light's
   forward vector. The first pass with it found the elevator's platform placement and most of what the materials
   got wrong (tools/extract/README.md). The editor and a race are different levels with different light actors, so
   the sun of a morning map is on the other side in editor pictures.

Both need: start a copy of the game, get into its editor, place pieces, read what is on screen, take pictures, save
maps and read them back. Headless, several at once, without touching the user's own game or settings.

## What already exists

- **The plugin manager's own agent tooling.** The [Ballest plugin manager](https://github.com/AnythingGoes-ballest/ballest-plugin-manager)
  (clone at `~/.cache/ballest-editor/bpm`) ships, under `tools/`, what this document would otherwise have to design
  from scratch: `test_instance.py` (sandboxed copies of the game in slots 1-9, each with its own data folder,
  saves and plugins, started headless with `-RenderOffscreen -d3d11 -nosound` at a 30 fps cap), `sandbox.py` (start,
  stop, drive, screenshot, reload plugins, written for agents), and `agent.py` (a named pipe into the host, one
  command per frame). The host's **test channel** (`src/host/testchannel.hpp`) is the command set: `state` (what is
  on screen), `click <label>`, `select`, `type`, `tap <x> <y>`, `gamekey <key>`, `openmap <name>` (the Create page's
  entry into the editor), `open <map>`, `editor pieces|select|screen`, `editorcam`, `render <name>` (a PNG of the
  frame, headless too), `agentstate` (JSON), `dumptypes` (every class, struct and enum with offsets, and a `.usmap`
  for this build), `props`, `find`, `functions`, `instances`, `listprop`, `materials`, `callx <Class> <Function>`
  (any game function). Commands arrive through `test_command.txt` next to `host.log` (read twice a second) or the
  pipe; replies go to `host.log`.
- **The script API** (`src/host/api.cpp`, docs at the site's reference pages): `Editor::SpawnPieces(classes,
  transforms)`, `ReplacePieces`, `Select`, `GetLocation/SetLocation`, `GetRotation`, `GetScale`, `Pieces`,
  `PieceClass`, `ScreenPosition`, `Undo/Redo`, `Camera::Set(x, y, z, pitch, yaw, fov)`, `Camera::Project/Pick`,
  `Hud::HideEditor`, `Tracks::OpenLocal` (what our `ballest-editor-link` plugin uses). No function opens the editor.
- **Our earlier scripts.** `/tmp/ballest-probe/` (2026-10-26): `ui.sh` and `pad.sh` drove the user's own game window
  with xdotool and ydotool and screenshotted with spectacle. They worked, but against the real game, in the user's
  session, with hand-measured pixel positions. The `cdp.mjs` files around `/tmp` drive the Electron app, not the
  game. None of it is committed.

The Windows tooling is Windows only: it patches the launcher's single-instance mutex name in memory, lists processes
with PowerShell, and opens `\\.\pipe\...`. The design below keeps its ideas and the host's command set, and replaces
the process side with Proton.

## What the spike measured

| Question                                    | Answer                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the host load under Proton?            | Yes, once Wine is told to prefer the game folder's `version.dll`: `"version"="native,builtin"` under `[Software\\Wine\\DllOverrides]` in the prefix's `user.reg` (or `WINEDLLOVERRIDES="version=n,b"` in the launch options). Without it Wine loads its own `version.dll` and the host never runs. Nothing else was needed.                 |
| Do test commands work in the user's game?   | The read-only ones: `state`, `render` (a 3840x2083 PNG in 3 s), `agentstate`, `dumptypes` (13651 types, 2699 enums, `Ballest.usmap`, 2 s). Mutations (`editor`, `console`, `openmap`) are refused outside a complete sandbox, by design.                                                                                                    |
| Can a copy run headless, in its own prefix? | Yes. `umu-run <copy>/Ballest.exe -RenderOffscreen -d3d11 -nosound -userdir=C:\slot\UserDir` with its own `WINEPREFIX` (a copy of the game's prefix) reaches the main menu in about 20 s with no window at all. `render` gives a real 1280x720 frame of the menu, footer button included.                                                    |
| Cost of one headless slot                   | About 800 MB of VRAM, 15 % GPU, 60-75 % of one core (uncapped when measured; the driver now writes `FrameRateLimit=30` into the slot's `GameUserSettings.ini`, and whether that caps it is unmeasured), 1.1 GB RSS. Several slots fit on the RX 7600 (8 GB).                                                                                |
| Does the sandbox work under Wine?           | Not with the release host. With `sandbox.txt` in place the game deadlocks a few seconds in: `RtlpWaitForCriticalSection "msvcrt/file.c: MSVCRT_file_cs" wait timed out in thread 0194, blocked by 0198`. Fixed in a patched host, see § Open problems.                                                                                      |
| Launching the copy through umu              | `GAMEID` must be `umu-3339810`; a bare `3339810` leaves `SteamAppId` at 0, the launcher's DRM asks Steam to run the game instead, and Steam shows a "Launch Game with custom arguments" prompt for the user's own install. The copy must be under `$HOME` (the runtime container does not see `/tmp`).                                      |
| Single-instance lock                        | Not a problem on Linux: each prefix has its own wineserver, so the copy's `Local\BallestLauncherSingleInstanceV1` is not the real game's. No exe patching.                                                                                                                                                                                  |
| Closing a copy                              | The window's title is `Ballest` (two trailing spaces), which name matches miss. `xdotool windowquit` on the window did nothing; `SIGTERM` to the `Ballest-Win64-Shipping.exe` process worked (the launcher records it as an abnormal exit, harmless for a slot). `slot_stop` sends `SIGKILL` to every process with the slot's `WINEPREFIX`. |

Two findings from `dumptypes` show what the driver is for. `EBallestSurfaceAssignment` has six values, not four: `None, Magnet, Ice, Grippy, GrippyCards, Grass`; the exe string grep in #155 found four. And `BP_PhysicsPaddle` carries `SpeedTierMaterials` and `TopSpeedTierMaterials` arrays, which say how the paddle's speed tier is drawn.

## Design

### Where it lives

`tools/driver/`: an MCP server in TypeScript on Effect (`effect/ai`'s `McpServer`, in the pinned 4.0.6), run with
`node` like `tools/extract/src`. It is a developer tool, not part of the app: no dependency from `apps/`, no UI. Agents
reach it through their MCP client's config. It owns:

- `~/.cache/ballest-editor/driver/game/`: a copy of the game install (2 GB, `rsync` from the Steam library) with the
  host and our plugins installed. The real install is never written; the user's own plugin folder is `GameLink`'s
  business.
- `~/.cache/ballest-editor/driver/slots/<n>/`: one Proton prefix per slot, cloned from the game's prefix on first use
  (600 MB; it carries the user's saves as a seed, and the driver patches the `version` override into its `user.reg`),
  with `C:\slot\UserDir` as the game's `-userdir` (its `Saved`: config, saves, `UserSavedMaps`, logs) and `sandbox.txt`
  in its `PluginManager` folder, written on every start. The driver writes the slot's `GameUserSettings.ini`: 1280x720,
  windowed, every scalability group at 0 except `sg.ResolutionQuality` at 100, 30 fps. The user's settings never reach
  a slot, and a slot never reaches the user's.

### Transport

The driver uses the file channel: write `test_command.txt`, tail `host.log` for the reply. One command costs about half
a second to two seconds; the spike's `render` took 3 s on the 4K user game and should be faster at 720p. The agent pipe
(`\\.\pipe\ballest-test-<pid>`) is a Wine named pipe, which a Linux process cannot open; reaching it needs a small
Windows helper run inside the prefix (`wine bridge.exe` forwarding the pipe to a TCP port, or one line in the host that
also listens on TCP in sandbox mode). Worth asking upstream for; the file channel has been enough so far.

### Tools

Each tool is one MCP tool with an Effect schema for its input and output. [tools/driver/README.md](../tools/driver/README.md#the-tools)
lists them. The design choices behind that list:

- Common test commands get a thin wrapper that returns the host's reply: `state`, `tap`, `gamekey`, `editor_pieces`,
  `editor_camera` and `open_map` (`openmap`). `command {command}` is the raw test channel for whatever the wrappers
  lack, `click`, `select`, `type`, `hover`, `editor screen`, `find`, `functions`, `instances`, `listprop`, `materials`
  and `callx` included. The host refuses the commands that change the game outside a complete sandbox.
- `types_dump` runs `dumptypes` and copies `types.txt` and `Ballest.usmap` out. Parsing them into JSON, and tools that
  query an enum or a class, are not built.
- A probe is: write a draft (`map_write`, plain JSON into the slot's `UserSavedMaps`), open it in the in-game editor,
  change something (tap, gamekey, plugin call), save, read the file back (`map_read`). Comparing two versions is left
  to the agent.

The server keeps every picture and log under the slot folder and returns paths, not bytes.

### The driver plugin

`packages/ballest-driver/`: a second AngelScript plugin, beside the editor plugin, installed only into slots. It reads
`command.json` from its own folder (`Plugins::ReadFile`, on a timer), runs script API calls the test channel lacks
(`Editor::SpawnPieces`, `Select`, `SetLocation`, `SetRotation`, `Camera::Set`, `Camera::Project`, `Hud::HideEditor`;
`ReplacePieces`, `Hud::HideGame` and `Editor::ScreenPosition` exist upstream and aren't called yet), and
answers with `Log::Info` lines the driver reads from `host.log`, the same way it reads test command replies. These
calls work in any game, sandboxed or not, because the script API is what plugins are for. It uses no `Console::Run`,
so it could be listed in the registry if that is ever useful; it is not needed for the editor's users.

### Pivots and the gizmo

The default gizmo position is the piece's origin, wherever that falls on its mesh, and the app copies the game's pivots (docs/FORMAT.md § Pivots), so where the
gizmo sits is a thing to check as much as how the piece looks. Measured on this build: the editor pawn's handler
(`SKGMLEHandlerComponent`, reached with the test channel's `callx` on the instance under `PersistentLevel`) has
`GetSelectionPivotChoice`, `SetSelectionPivot` (the inspector's buttons: `ESKGMLEEditorPivot` Default 0, Center 1,
Bottom 2, Top 3, Left 4, Right 5, Back 6, Front 7, WorldOrigin 8) and `GetSelectionTransform`, the gizmo's transform
as a 96-byte FTransform of which the host reports the first 64 bytes (quaternion and translation, not the scale).
The gizmo and the selection outline render whenever a piece is selected, with the editor's panels hidden too, so a
render with the gizmo is a render with the piece selected, and a clean one has nothing selected.

That gives a measurement for free: the Center, Bottom, Top, Left, Right, Back and Front pivots put the gizmo at the
centre of the piece's mesh bounds and the centres of its six faces, in the world. On the ramp `BP_Ramp_Curve_Short1`
they matched the catalog's bounds to the millimetre. For a piece that isn't turned, the box around those points is
its mesh bounds; `piece_measure` reports the points and the box and puts the piece's own pivot choice and the
selection back, since the choice stays with the piece (it is what the map saves in `editorState.pivots`).

`piece_views` is the piece evaluation flow for a piece of the open map, and `piece_turntable` the same from nothing
but a class path (§ Probe maps): measure, select the piece (or nothing, for a clean render),
set the pivot to show (the piece's own by default, since that is the game's choice for it; Center standardises it),
hide the panels, frame the camera from the measured bounds for each standard view (front, back, left and right as elevations level
with the piece, so heights read off them; top and bottom as plans; front-left and back-right raised: fixed names
and directions, so renders of two pieces or two game versions line up),
render each, then release the camera, show the panels and put the pivot and the selection back. It returns the
measurement, the gizmo's transform and the PNGs; what the pictures show is the agent's to judge.

### Probe maps

Every slot has one probe map, `Map_LevelEditorMain&driver probe_driver.balledit` in its `UserSavedMaps`, written
empty (the start alone) at every start: the game lists maps at launch, but reads a map's file when it is opened
from the Create page, so the file can be overwritten with any pieces and opened again without a restart. Measured:
`levelData.userLevelName` has to match the file's name, or the game opens whichever map has that name. From inside
the editor the route is `open Map_MainMenu`, then `openmap driver probe` once the Create page's entries exist
(about 10 s in all). `probe_map` does that for a list of pieces; `piece_turntable` opens the map with one piece at
(0, 0, 5000), well above the arena's water at z 0, measures it, builds a studio and a ruler if asked (six primitive
cubes at scale 30 around the piece, so every view has a plain tiled wall behind it instead of the arena, and a
100 cm cube at its near corner for texture scale), takes the views, and writes the empty probe back. Nothing is
saved unless the editor saves; the next probe overwrites the file anyway.

### Saving from the editor

`gamekey` has no Ctrl+S and the host's `click` doesn't reach game buttons. Either of these saves, with the same result:

- `callx W_SaveLoad_C ManuallySaveNoCallback Transient | b:1`, which overwrites without asking.
- `callx W_MapEditor_C BndEvt__W_MapEditor_WBP_SaveButton_K2Node_ComponentBoundEvent_11_ButtonPressed__DelegateSignature Transient`, the save button, then `tap 590 415` on the popup's yes.

The game writes `<name>_<player>`, not the file it opened, so a save of the probe map leaves `driver probe_<player>` beside it. Check the file's mtime: `ok` only says the call ran.

`openmap` matches the first word of its argument, in the first entry that contains it, so give it one distinctive word and check the pieces that come up. A map the game rejects opens as a blank one, and its start is called `MP_PlayerStart_00_C_0`.

To race a map, copy `packages/ballest-editor-link` into the slot's `plugins` folder before a restart and write its `play.json`; `callx W_SaveLoad_C BeginTrackValidation` starts a stock track instead. Races run in `Map_TrackUGCPlayback`, whose light is not the editor's: docs/qa/save-roundtrip.md has what differs.

### The UI as data

The host's `state` lists only its own UI, so two test commands were added to the host (the fork's `ui-dump` branch,
on top of PR #28): `widgets <Class> [filter] [depth]` walks a user widget's tree and writes one line a widget (class,
name, visibility, enabled, a text block's or box's text, a check box's state, a combo's choice, a palette tile's
piece class), and `palette` reads the content browser as the game builds it: `W_Categories_C` holds one
`W_CategoryItems_C` per category in panel order, each with its FName, its header and the data asset behind it,
`PDA_MapItem_C`, whose `Items` are `S_Item` structs of name, thumbnail and class. Those fourteen data assets under
`/Game/LevelEditor/PackageAssets/MultiplayerLevelEditor/UI/Data/ContentBrowser/` are the game's catalog; they are in
the paks, so `tools/extract` could read them offline too.

Two traps when reading a piece's properties. `ui_widgets W_ItemPropertyData_C` takes the first instance, and old ones stay around, so it can return another piece's rows: read `W_ItemsDatas_C`, which holds the live one, and check `TB_Actor` names the selected piece. And `openmap` matches only its first word against the file name, so `openmap palette probe 1` opens the first map containing `palette`; the game's own save of the probe map also writes a second `driver probe_<creator>` file that the same word matches.

`palette_dump` returns that, and `palette_diff` compares it with `assets/catalog.json` by class path: measured on
0.4.1, the two match exactly, 140 pieces in 14 categories. `ui_widgets` returns a widget tree (`W_Details_C` for the
details panel, `W_MapEditor_C` for the whole editor). `editor_action` runs one of the details panel's own functions
on the selection (`FlipSelectionX`, `ChooseCenter`, `SetSelectionMirrored`, `ChooseSurface`: what its buttons call)
with a snapshot before and after: the selected pieces, the pivot and gizmo, the first selected piece's mirror and
surface flags, and the panel's controls. Measured: Flip X toggles the piece's `bMirrorX` and leaves its transform
alone, which is what the app's mirror handling assumes (docs/FORMAT.md § 0.4.1: surfaces, mirroring, physics props).

Placing from the palette has no tool, but a tile's click handler can be called directly. `instances W_MapItem_C` lists the tiles, `widgets W_MapItem_C <tile> 1` shows each one's class, and `callx W_MapItem_C BndEvt__W_MapItem_B_Item_K2Node_ComponentBoundEvent_0_OnButtonClickedEvent__DelegateSignature <tile>` places the piece, leaving a second instance of the class that `editor pieces` doesn't list. A class outside the palette goes through the handler component: `callx SKGMLEHandlerComponent SpawnActorLocalPrePlace PersistentLevel | o:BlueprintGeneratedClass,<Class>_C`, then `callx SKGMLEHandlerComponent PlacePrePlacedActor PersistentLevel`. `callx` can't pass the transform, so that piece sits at the origin with a zero transform, and it wasn't in the map when the editor saved: read it live with `props <Class> <instance>`.

### Reading objects

Traps from the budget QA (docs/qa/budget.md):

- `props <Class> PersistentLevel` reads the first instance whose class matches, and subclasses match. Pass the instance's own name as the filter and check the reply's first line.
- `props` with no `Transient` filter on a widget class reads the Blueprint's archetype, not the live widget.
- `probe_map` waits for at least the pieces it wrote, so a map that didn't reload can pass if the open one has as many. It can't wait for an exact count: a piece with a child actor, like `MP_Airvents`, shows as two.
- From a heavy map (tens of thousands of pieces) the game can stall on `open Map_MainMenu`. Restart the slot.
- The save button writes `<name>_<player>.balledit`, under the player's name, not the probe's file. A second save asks to overwrite in a dialog that waits for a tap.
- `membytes` returns at most 512 bytes a call.

### What the headless modes do and do not give

- `-RenderOffscreen` (measured): no window, real frames through `render`, the host's `tap` and `gamekey` for input.
  `tap` and `gamekey` are mutations, so they need the sandbox.
- A window on a nested display (unmeasured): `gamescope --headless -W 1280 -H 720 -- umu-run ...` gives each slot its
  own Xwayland display with GPU rendering and no window on the user's screen. There, `xdotool` on that display drives
  the game's own menus and editor without the sandbox, as `/tmp/ballest-probe/ui.sh` did on the real game. This is the
  fallback route into the editor for a slot without the patched host: xdotool to navigate, the driver plugin to
  place and frame, `render` to look. Xvfb is the poorer version of this (no GPU, DXVK may refuse it).

## Open problems

1. **The sandbox under Proton: fixed in upstream PR
   [#28](https://github.com/AnythingGoes-ballest/ballest-plugin-manager/pull/28), not merged yet.** Three host bugs,
   found with `winedbg` and lsteamclient's symbol table: `hostlog::Open` held the log's mutex around `_wfopen` while
   Wine's C runtime held its global file lock, and the sandbox's own hook refused the log's path (under Wine the
   host's folder sits under the prefix's `AppData\Local`, which the sandbox took for the player's `Saved`) and logged
   that through the same mutex, a self-deadlock that starved the game thread; the flat wrapper decoder read
   `SetLobbyGameServer`'s `mov r10,[rcx]` wrapper as its neighbour's slot (a Windows bug too); and the game's older
   Steam interface versions (`SteamFriends017`, `STEAMUSERSTATS_INTERFACE_VERSION012`,
   `STEAMUGC_INTERFACE_VERSION020`) could not be matched by address because Proton's `lsteamclient` has a thunk per
   version, so the host now finds them by the thunk names in that DLL's symbol table. With the patched host a slot
   reports `sandbox: status on, complete`, takes `console t.MaxFPS 30` and `openmap`, and renders the in-game editor
   headless. The slot copy runs the patched build (`~/.cache/ballest-editor/bpm/build/version.dll`) until a release
   carries it.
2. **No pipe from Linux.** See § Transport.
3. **The host warns "this game build was not measured"** on 0.4.1 and finds its tables itself. It worked; a host
   release measured on 0.4.1 will stop the warning.

## The decompile question

A UE 5.8 shipping build cannot be turned back into source: the C++ is compiled and stripped, and the Blueprints are
cooked to Kismet bytecode. What the extract tool already reads is everything the pak holds. What it could not read in
#155 (which properties native classes have, their types, the enum values, which functions exist) is exactly what the
host's `dumptypes` writes from the running game: `types.txt` with every class, struct and enum, property offsets and
types, and function signatures, plus a `Ballest.usmap` for this build. With the build's own usmap, CUE4Parse reads
the Blueprints' bytecode, which is how the plugin manager's author wrote the Editor API. So the answer is: no full
decompile, but `dumptypes` replaces the exe string grepping, and `tools/extract` should take `Ballest.usmap` from a
driver run instead of the Fortnite mapping it downloads today. What no dump can give is how a material looks on
screen, and that is the second job above.

## Order of work

1. Open: get upstream PR #28 reviewed and released (§ Open problems 1). Until then slots run the patched build.
2. Done: `tools/driver/` with slots, the file channel, `render`, `state`, `agent_state`, `types_dump` and the map
   probes, headless and sandboxed. The gamescope route wasn't needed.
3. Done: the driver plugin and the `editor_*` tools over it.
4. Open: feed `Ballest.usmap` from a driver run into `tools/extract` (`run.sh --usmap` takes one) and drop the Fortnite
   mapping.
5. Done: `sandbox.txt` in every slot, and `tap`, `gamekey`, `open_map` and `command`, with the 30 fps cap in the slot's
   settings. Open: the pipe bridge, if the file channel gets too slow.
6. Open: the rendering comparisons: a probe map per piece, `editor_camera` with `frame <id>` plus `Camera::Set`,
   `render`, and the editor's render of the same map from the same camera.
