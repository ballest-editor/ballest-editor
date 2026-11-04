# tools/driver: the game driver for agents

An MCP server that runs sandboxed copies of _Ballest of Them All_ headless under Proton and drives them through the
plugin manager's test channel. The design and what was measured are in [docs/DRIVER.md](../../docs/DRIVER.md); this
is how to run it.

## Needs

- Linux with Steam running. `slot_start` refuses to start a copy while Steam is closed, and an agent must not start
  Steam either (the tools say so): it asks the user to start it and to confirm when it is running. A copy that started
  Steam would leave Steam with the copy's environment.
- The game installed and started once (its Proton prefix exists), Proton Experimental, and `umu-run` (the [umu launcher](https://github.com/Open-Wine-Components/umu-launcher)).
- The [plugin manager](https://github.com/AnythingGoes-ballest/ballest-plugin-manager) host in the game, with the
  Wine override that makes it load (`WINEDLLOVERRIDES="version=n,b"` in the launch options, or
  `"version"="native,builtin"` in the prefix's `user.reg`). Until upstream carries
  [PR #28](https://github.com/AnythingGoes-ballest/ballest-plugin-manager/pull/28), the host has to be built from that
  branch: without it a sandboxed copy deadlocks at start, and without its interface fix the sandbox stays incomplete
  and refuses every command that changes the game.
- `rsync`.

## Running it

```sh
pnpm driver setup                 # copies the install (host and plugins included) and the driver plugin into the driver's folder
pnpm driver setup --host DIR      # ... and lays DIR's version.dll and plugins/ over it (a build of the host)
pnpm driver start --slot 1        # a headless copy in its own prefix; prints its status once the menu is up (~25 s)
pnpm driver run --slot 1 state    # one test channel command, its replies printed
pnpm driver status --slot 1
pnpm driver stop --slot 1
pnpm driver serve                 # the MCP server over stdio
```

`.mcp.json` at the repo root registers `serve` for Claude Code and T3 Code, so an agent in this repo has the tools
without any setup beyond `pnpm driver setup`.

Everything lives in `~/.cache/ballest-editor/driver/` (`BALLEST_DRIVER_HOME`): `game/`, the copy of the install;
`slots/<n>/`, one Proton prefix per slot (cloned from the game's on first start, about 600 MB), with the game's
`-userdir` at `pfx/drive_c/slot/UserDir` (its saves seeded from the player's, its own `GameUserSettings.ini`: 720p,
everything low, 30 fps), the host's folder at `pfx/drive_c/users/steamuser/AppData/Local/Ballest/Saved/PluginManager`
(`host.log`, `test_command.txt`, renders, `sandbox.txt`), and `launch.log`. The game install is only read.
`BALLEST_GAME_DIR`, `BALLEST_COMPATDATA`, `BALLEST_PROTON` and `BALLEST_UMU` move the inputs.

A headless slot costs about 800 MB of VRAM, 15 % of the GPU and 1.1 GB of RAM; several fit on one desktop card.
Each prefix has its own wineserver, so copies run beside each other and beside the player's own game.

## The tools

| Tool                                                                                     | Does                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slot_start {slot, mode}`                                                                | Starts a slot (`headless`, the default, or `window`) and waits for its menu. Returns its status.                                                                                                                                                |
| `slot_stop`, `slot_status`, `slot_log`                                                   | What they say. Status includes whether Steam is running (`steam`) and whether the sandbox is `complete` (commands that change the game need that).                                                                                              |
| `command {slot, command}`                                                                | Any test channel command (`src/host/testchannel.hpp` upstream lists them); its reply lines.                                                                                                                                                     |
| `state`, `agent_state`                                                                   | What is on screen as the host lists it; the game's state as JSON.                                                                                                                                                                               |
| `render {name}`                                                                          | A 1280x720 PNG of the frame, headless too. Returns the path; read the file to look.                                                                                                                                                             |
| `open_map {fragment}`                                                                    | Opens one of the slot's saved maps in the track editor.                                                                                                                                                                                         |
| `map_list`, `map_read`, `map_write`                                                      | The slot's `UserSavedMaps`. A written map shows on the Create page after a slot restart (the game lists maps at launch).                                                                                                                        |
| `types_dump`                                                                             | `dumptypes`: every class, struct and enum with offsets, and `Ballest.usmap` for this build, copied to the slot's `types/`.                                                                                                                      |
| `tap`, `gamekey`, `editor_pieces`, `editor_camera`                                       | Thin wrappers over the test commands of the same names (`editorcam` for the camera).                                                                                                                                                            |
| `editor_spawn`, `editor_pieces_json`, `editor_transform`, `editor_select`, `editor_undo` | Through the driver plugin ([packages/ballest-driver](../../packages/ballest-driver)): pieces placed as the editor pastes them (class paths as the catalog writes them), the map's pieces as JSON, a piece moved or turned, the selection, undo. |
| `camera_set`, `camera_release`, `hide_editor`, `plugin_call`                             | The plugin's camera (position, pitch, yaw, fov), the editor's panels hidden for a clean render, and any op of the plugin by name.                                                                                                               |

Replies are the host's own lines. The channel is the file one (a command costs about half a second); the host's
named pipe isn't reachable from Linux yet (docs/DRIVER.md § Transport).
