# Vision

A standalone, professional-grade map editor for _Ballest of Them All_ that reads and writes the game's own `.balledit` / `.ballmap` JSON (see [FORMAT.md](FORMAT.md)). It never needs a game mod: the output is a normal map file you drop into `UserSavedMaps/`, open in the in-game editor to validate, and publish through the game.

The in-game editor is good for placing a few pieces. This project is for people building large, precise tracks who want CAD-style tooling.

## Why standalone (not a mod)

- Maps are plain JSON; the game does the spawning, validation and Workshop publishing.
- Published Workshop items contain only the `.ballmap` and a thumbnail, so custom pieces can't ship anyway. The shareable vocabulary is the built-in piece set, and compositions of it.
- No UE 5.8 toolchain or binary patching; nothing to break on a game update except the format itself, which we can re-derive from samples.

## Long-term feature inspiration

Roughly in the order we expect to tackle them. Items marked ✅ are in the first iteration.

### Navigation and view

- ✅ Free-fly / orbit camera with configurable keybinds.
- View cube (Fusion 360 style, top-right) to snap to orthographic faces/edges/corners and reorient the perspective.
- Orthographic views with a world grid; grid units in cm matching the game.
- Isolate / hide / focus on selection.

### Gizmos

- Blender-style separate translate / rotate / scale gizmos (done after iteration 1 review); a combined gizmo may come later.
- Selection-origin dot: when the pivot is set to a face (front/back/top/left/right) render it in perspective, and draw it with a dotted line when it is inside the selection's bounding box (global or piece-local).
- Per-handle hover highlight only; axes coloured in game coordinates (X red, Y green, Z blue = up).

### Placement and transform

- ✅ Piece palette using the exact meshes the in-game editor uses.
- ✅ Translate in 3D with gizmo and numeric entry.
- Rotate / scale gizmos; per-axis locks; uniform vs. non-uniform scale.
- Configurable snapping grid (position, angle, scale) with user-defined origins; the game has no built-in grid constraint, so the grid is entirely ours.
- Pivot choice per item (Default/Center/Bottom/Top/Left/Right/Back/Front) matching `editorState.pivots`.

### Selection-based operations

- Multi-select (click, box, lasso), select-similar (same class / material).
- Flip and mirror across a chosen plane (world, grid or selection-relative).
- Distribute / align along an axis; equal spacing; stack.
- Flush / tangent: pick a face on object A and a face on object B, make them coplanar or tangent.
- Array / radial array; path-following placement along a spline (tracks, bevels).

### App shell

- Universal menu bar (File / Edit / View / Select / Tools / Help) replacing the ad-hoc top bar; Settings lives under it.
- Desktop-style Settings window (category nav + content) holding keybinds, camera, appearance; keybind names and defaults mirror the game's own settings screen.

### Organisation

- Projects: a folder of maps with their editor-only data, exports into the game's maps folder, and sync with edits made in the in-game editor. Design in [PROJECTS.md](PROJECTS.md).
- Groups (the format already has `editorState.groups`) and nested groups.
- Layers with visibility/lock, not persisted by the game but kept in a sidecar so round-tripping through the in-game editor doesn't lose them.
- Prefabs: import/export the game's `BallestPrefab` JSON.

### Materials

- Per-slot material picker populated from the pak.
- Paint tool: pick a material, click faces/objects to assign to the hit slot; eyedropper.
- Find/replace materials across the selection or map.

### Validation and export

- ✅ Export a `.balledit` the game accepts (schema + known hard limits).
- Lint: missing `MP_PlayerStart`, items beyond limits, non-normalized rotations, unknown properties.
- Import a `.ballmap` from the Workshop cache for study/remix.

### Nice to have

- Playtest handoff: write directly into `UserSavedMaps` and launch the game.
- Stress-test generator to find practical item-count ceilings.
- Thumbnail renderer for Workshop uploads.

## Non-goals

- Running the game's physics or replicating the validation run (`bValidated`, medal times). The game does that.
- Mod paks / custom pieces. See [FORMAT.md](FORMAT.md) for why they can't be shared.
