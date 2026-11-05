# Vision

Ballest Editor is a standalone, professional-grade map editor for _Ballest of Them All_. It reads `.balledit` and `.ballmap` files and writes `.balledit`, the game's own JSON (see [FORMAT.md](FORMAT.md)). The output is a normal map file: it goes into the game's maps folder, opens in the in-game editor for validation, and publishes through the game.

The in-game editor is good for placing a few pieces. This project is for people building large, precise tracks who want CAD-style tooling.

## Why standalone, and where the plugin fits

- Maps are plain JSON. The game does the spawning, validation and Workshop publishing.
- Published Workshop items contain only the `.ballmap` and a thumbnail, so custom pieces can't ship anyway. The shareable vocabulary is the built-in piece set and compositions of it.
- There's no UE 5.8 toolchain and no binary patching. A game update can only break the format, and we can re-derive that from samples.

The editor needs no game mod to make, export or publish a map. One feature reaches into the running game: Play. The desktop app exports the map, and the [editor plugin](../packages/ballest-editor-link/README.md), running under the third-party [Ballest plugin manager](https://anythinggoes-ballest.github.io/ballest-plugin-manager/), races it. Both are optional: without them Play only exports the map and starts the game.

## Desktop

Ballest Editor is a desktop app for Windows and Linux, because the maps folder, the game launch and Play all need the file system. [DESKTOP.md](DESKTOP.md) explains why and how it behaves. The web review build exists so that pull requests can be tried without installing anything. [PROJECTS.md](PROJECTS.md) describes how the app keeps maps in project folders and exports them to the game.

## Features

Numbers are issues. The [milestones](https://github.com/ballest-editor/ballest-editor/milestones) sequence them, and the ones with no milestone are unscheduled.

### Built

- **Camera.** Free-fly and orbit with configurable keybinds, focus on the selection, a 1 m floor grid with 10 m sections at the map's floor height.
- **Gizmos.** Separate translate, rotate and scale gizmos in the Blender style, with per-handle hover highlight and axes coloured in game coordinates (X red, Y green, Z blue = up). Local or world axes.
- **Placement and transform.** A piece palette using the exact meshes the in-game editor uses, numeric entry for position, rotation and scale, uniform scale, the game's pivot choices (`editorState.pivots`).
- **Selection.** Shift or Ctrl+click multi-select. Copy, cut, paste, duplicate, and Alt+drag to duplicate.
- **Materials.** A per-slot picker with the game's finishes and colours, and the 0.4.1 item surfaces.
- **App shell.** A menu bar (File, Edit, View, Project), a Settings window (keybinds, camera, appearance) whose keybind names and defaults mirror the game's settings screen, map tabs, a Project panel, a status bar and notifications.
- **Projects.** Folders of maps, export to the game's maps folder, backups, and detection of edits made in the in-game editor ([PROJECTS.md](PROJECTS.md)).
- **Playtest handoff.** Play exports the map and races it in the game.
- **Export.** A `.balledit` that passes the game's [load rules](FORMAT.md#load-time-validation), measured on 0.4.1: Save and Export refuse a map with no player start, too many items, a rotation that isn't normalized, or anything else that would make the game open a blank map.
- **Import.** A `.balledit`, `.ballmap` or `.json` from a file dialog.

### Partly built

- **Grid snapping** covers position and rotation, on fixed steps. Still to come: scale snapping, and user-defined origins, spacing and angle steps (#84).
- **Mirroring** is the game's per-item Flip X and Flip Y. Still to come: flipping the selection or the map across a chosen plane in world, grid or selection space (#87).
- **Linting** stops a save on the first problems it finds. Still to come: a lint view and the checks the game doesn't make itself, such as a missing goal and pieces outside the palette (#98).
- **Importing from the Workshop cache** works through the file dialog. Still to come: finding maps there for study and remix (#103).
- **Menus** are missing Select, Tools and Help.

### Planned

Roughly in the order we expect to tackle them.

Navigation and view:

- View cube in the Fusion 360 style, top right, to snap to orthographic faces, edges and corners and reorient the perspective (#79).
- Orthographic views with a world grid in cm, matching the game (#80).
- Hide, isolate and lock pieces (#81).

Gizmos and transform:

- Selection-origin dot: when the pivot is on a face (front, back, top, left, right), render it in perspective, and draw it with a dotted line when it is inside the selection's bounding box, global or piece-local (#82).
- Per-axis locks and free scale (#83).
- A combined gizmo, maybe (#109).

Selection-based operations:

- Box and lasso select (#85), and select similar by class or material (#86).
- Align and distribute along an axis, equal spacing, stacking (#88).
- Flush and tangent: pick a face on object A and a face on object B and make them coplanar or tangent (#89).
- Linear and radial arrays (#90), and path-following placement along a spline for tracks and bevels (#91).

Organisation:

- Groups, as the game's Ctrl+G and Shift+G (#78; the format already has `editorState.groups`), and nested groups.
- Layers with visibility and lock, not persisted by the game but kept in a sidecar so that a round trip through the in-game editor doesn't lose them (#111, #112).
- Prefabs: import and export the game's `BallestPrefab` JSON (#102).

Materials:

- A paint tool: pick a material and click faces or objects to assign it to the hit slot, with an eyedropper (#97).
- Find and replace materials across the selection or the map (#96).

Other:

- A stress-test generator to find practical item-count ceilings (#107).
- A thumbnail renderer for Workshop uploads (#108).

## Non-goals

- Running the game's physics or replicating the validation run (`bValidated`, medal times). The game does that.
- Mod paks and custom pieces. See § Why standalone for why they can't be shared.
