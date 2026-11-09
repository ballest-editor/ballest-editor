# Vision

Ballest Editor is a standalone, professional-grade map editor for _Ballest of Them All_. It reads `.balledit` and `.ballmap` files and writes `.balledit`, the game's own JSON (see [FORMAT.md](FORMAT.md)). The output is a normal map file: it goes into the game's maps folder, opens in the in-game editor for validation, and publishes through the game.

The in-game editor is good for placing a few pieces. This project is for people building large, precise tracks who want CAD-style tooling.

## Why standalone, and where the plugin fits

- Maps are plain JSON. The game does the spawning, validation and Workshop publishing.
- Published Workshop items contain only the `.ballmap` and a thumbnail, so custom pieces can't ship anyway. The shareable vocabulary is the built-in piece set and compositions of it.
- There's no UE 5.8 toolchain and no binary patching. A game update can only break the format, and we can re-derive that from samples.

The editor needs no game mod to make, export or publish a map. One feature reaches into the running game: Play. The desktop app exports the map, and the [editor plugin](../packages/ballest-editor-link/README.md), running under the third-party [Ballest plugin manager](https://anythinggoes-ballest.github.io/ballest-plugin-manager/), races it. Both are optional: without them Play only exports the map and starts the game.

## Desktop

Ballest Editor is a desktop app for Windows and Linux. [DESKTOP.md](DESKTOP.md) explains why and how it behaves, and [PROJECTS.md](PROJECTS.md) how it keeps maps in project folders and exports them to the game.

## Features

Numbers are issues. The [milestones](https://github.com/ballest-editor/ballest-editor/milestones) sequence them, and the ones with no milestone are unscheduled.

### Built

- **Camera.** Free-fly and orbit with configurable keybinds, focus on the selection, a 1 m floor grid with 10 m sections at the map's floor height.
- **Split views.** One, two or four panes on a map, each perspective or an orthographic top, bottom, front, back, left or right view with a world grid in cm that matches the snapping grid (#80, [DESKTOP.md](DESKTOP.md#view-panes)).
- **Gizmos.** Separate translate, rotate and scale gizmos in the Blender style, with per-handle hover highlight and axes coloured in game coordinates (X red, Y green, Z blue = up). Local or world axes for moving and turning; a scale is always along the items' own axes, as in the game. A Together or Each pivot setting, group pivots and chains ([DESKTOP.md § Pivot setting](DESKTOP.md#pivot-setting-together-and-each)), and a dot at every pivot.
- **Placement and transform.** A piece palette using the exact meshes the in-game editor uses, numeric entry for position, rotation and scale, uniform scale, the game's pivot choices (`editorState.pivots`).
- **Selection.** Shift or Ctrl+click multi-select. Box and lasso select, by drag direction or a setting, inside or touching (#85, [DESKTOP.md](DESKTOP.md#box-and-lasso-select)). Copy, cut, paste, duplicate, and Alt+drag to duplicate.
- **Materials.** A per-slot picker with the game's finishes and colours, and the 0.4.1 item surfaces. A paint tool that clicks or drags the picker's paint or a surface onto the slot under the pointer or the whole piece, by the game's paint rules, with an eyedropper (#97, [DESKTOP.md § Paint tool](DESKTOP.md#paint-tool)).
- **App shell.** A menu bar (File, Edit, View, Project), a Settings window (keybinds, camera, appearance) whose keybind names and defaults mirror the game's settings screen, map tabs, a Project panel, a status bar and notifications.
- **Projects.** Folders of maps, export to the game's maps folder, backups, and detection of edits made in the in-game editor ([PROJECTS.md](PROJECTS.md)).
- **Playtest handoff.** Play exports the map and races it in the game.
- **Export.** A `.balledit` that passes the game's [load rules](FORMAT.md#load-time-validation), measured on 0.4.1: Save and Export refuse a map with no player start, too many items, a rotation that isn't normalized, or anything else that would make the game open a blank map.
- **Import.** A `.balledit`, `.ballmap` or `.json` from a file dialog.

### Partly built

- **Snapping** lands a move, turn or scale on the grid, piece ends, meshes, construction geometry, tracking lines and alignment guides, by a priority the user sets, with the tools built on the same targets: flush and tangent, align and distribute, measure, mirror ([SNAPPING.md](SNAPPING.md)). Still to come: connector data for the families not measured yet.
- **Mirroring** is the game's per-item Flip X and Flip Y, and a selection mirrored across a face, a construction plane or a world plane ([SNAPPING.md](SNAPPING.md)). Still to come: mirroring in selection space.
- **Linting** stops a save on the first problems it finds. Still to come: a lint view and the checks the game doesn't make itself, such as a missing goal and pieces outside the palette (#98).
- **Prefabs** read and write the game's `BallestPrefab` files in a user and a project tier, and place as instances that follow their definition ([DESKTOP.md](DESKTOP.md#prefabs)). Still to come: the ballestrecords library (#102).
- **Importing from the Workshop cache** works through the file dialog. Still to come: finding maps there for study and remix (#103).
- **Menus** are missing Select.

### Planned

Roughly in the order we expect to tackle them.

Navigation and view:

- View cube in the Fusion 360 style, top right, to snap to orthographic faces, edges and corners and reorient the perspective (#79).
- Hide, isolate and lock pieces (#81).

Gizmos and transform:

- Per-axis locks and free scale (#83).
- A combined gizmo, maybe (#109).

Selection-based operations:

- Select similar by class or material (#86).
- Stacking (#88).
- Linear and radial arrays (#90), and path-following placement along a spline for tracks and bevels (#91).

Organisation:

- Groups, as the game's Ctrl+G and Shift+G (#78; the format already has `editorState.groups`), and nested groups.
- Layers with visibility and lock, not persisted by the game but kept in a sidecar so that a round trip through the in-game editor doesn't lose them (#111, #112).

Materials:

- Find and replace materials across the selection or the map (#96).

Other:

- A stress-test generator to find practical item-count ceilings (#107).
- A thumbnail renderer for Workshop uploads (#108).

## Non-goals

- Running the game's physics or replicating the validation run (`bValidated`, medal times). The game does that.
- Mod paks and custom pieces. See § Why standalone for why they can't be shared.
