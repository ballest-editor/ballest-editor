# apps/web

The editor: a React SPA (Vite, TanStack Router) with three.js through @react-three/fiber and drei, and Effect v4 for services, schemas and errors. The UI chrome is built from shadcn/ui components in `packages/ui` (`@workspace/ui`, Base UI primitives, Tailwind v4).

This is the desktop app's renderer. Built on its own it's the web review build, which has no project and nothing that needs the game ([docs/DESKTOP.md](../../docs/DESKTOP.md) § Renderer lists the differences). The window around the map (tabs, menus, the Project panel, the status bar) is described there too. This page covers the scene and the editing.

## Running it

The root [README](../../README.md#build-from-source) has the setup. Inside `apps/web`, `pnpm dev`, `pnpm build`, `pnpm test` and `pnpm typecheck` work too, and `pnpm start` runs `vite preview` on the build. Lint runs from the root.

To add shadcn components, run `pnpm dlx shadcn@latest add <name>` in `apps/web`. They're installed into `packages/ui/src/components` (see both `components.json` files). The preset is `b6nCVm82TK` (style `base-mira`, tabler icons).

`/assets/*` comes from two folders ([tools/compress](../../tools/compress/README.md#where-the-editor-reads-from)): the small committed files in the repo's `assets/` (`catalog.json`, `keybinds.json` and so on) and the compressed meshes and textures in `web-assets/`. A small Vite plugin in `vite.config.ts` serves them in `dev` and `preview` with `Cache-Control: no-cache`, and `vite build` copies them into `dist/`. A re-exported glb shows up after `pnpm assets` and a reload.

If `assets/catalog.json` is missing, the app falls back to `src/domain/bundledCatalog.json` and the top bar shows a "Fixture catalog" badge. If `assets/keybinds.json` is missing, every keybind uses the editor default.

## The editor

- **Saving.** Ctrl+S is Save. Save and Export write `Map_LevelEditorMain&<name>_<creator>.balledit` with the level fields the game expects, and refuse a map that the game would reject (`MapExporter`, `domain/limits.ts`, `domain/gameRules.ts`): it needs a valid name and creator and exactly one player start, within the game's value, character, item, mesh and property limits, with normalized rotations, and has to pass the load rules in [docs/FORMAT.md](../../docs/FORMAT.md#load-time-validation).
- **Palette.** The Pieces panel, grouped by the catalog's `category` in file order, collapsible. Pieces with no category go under "Other", and `inPalette: false` pieces go in a collapsed "Hidden" section. A piece's name and size tag are read from its `displayName` or class (`domain/pieceName.ts`), and a tooltip gives the class and category. `thumbnail` is used when present. A list or grid view is kept in the settings. A piece `assets/verified.json` records as `rejected` is disabled, and a hidden piece nobody has loaded in game is flagged unverified. Search covers all sections, and also matches the game's own name. Clicking a piece places it on the screen-centre ray, at the floor height (the player start's by default) or at the placement distance, whichever is nearer. That distance is Settings › Editor › Placement distance (20 m by default, 5 to 100 m), and bigger pieces go further (`domain/placement.ts`). Only a real pointer click places: Space or Enter on a focused entry does nothing, and focus moves to the viewport afterwards.
- **Floating toolbar** (bottom centre of the viewport): Select, Move, Rotate, Scale. Tooltips show the current keybind (Q, W, E, R by default). It's pointer-only and never takes keyboard focus.
- **View controls** (top right of the viewport, `components/ViewControls.tsx`): local or world axes, then grid and rotation snapping. Grid steps run from 1 cm to 10 m, and rotation steps from the game's snapping menu, 2.8125° to 90° (`domain/snap.ts`). Snapping applies to moves and rotations, not scale.
- **Gizmos** (Blender-style, `src/editor/gizmo/`):
  - They render in world space, never under a mirror. Axes are expressed in game coordinates: X red, Y green, Z blue = up. Directions come from mapping the game basis through `coords.ts`, and arrows never flip toward the camera.
  - Constant screen size, drawn on top, grabbed through invisible fatter hit meshes.
  - Hover highlights only the hovered handle. A drag keeps the active handle lit, dims the others, and shows a guide line in the axis colour.
  - Move uses axis arrows plus plane squares. Rotate uses rings, which show only the camera-facing quarter until dragged, plus a white view ring. Scale uses cubes on the gizmo's axes plus a centre uniform ring, and the item scales along its own axis.
  - The inspector follows the drag live. Each drag is one undo entry, and Escape cancels a drag, restoring the transform.
  - Handles are composable specs (`toolHandles`), so a combined tool is a concatenation.
- **Selection.** A click selects, and Shift or Ctrl+click adds or toggles. The outline runs along the mesh's own edges, as the game draws it (`selectionOutline.ts`): creases always, the silhouette of smooth surfaces from the camera, and the active item lighter. Copy, cut, paste and duplicate work on the selection, and Alt+drag duplicates (Settings › General).
- **Materials.** `MaterialLibrary` loads `assets/materials.json` (tolerant; a missing file means neutral grey). Each primitive gets its game material by UE slot index: the item's `materials[]` first, then the catalog's `defaultMaterial`/`meshMaterial`.
  - Lookup is by exact path, then the `redirectedTo` alias, then asset name, so old paths such as `M_BaseSurface_Metal` resolve.
  - Base colour, metallic, roughness, opacity and emissive (linear) are applied, along with the projection, tiling, colour layers and shader programs `tools/extract` traced from the game's shaders (`editor/materials.ts`).
  - Base-colour textures use sRGB per `textures[].sRGB`. Textures load with `flipY` off. Normal maps are linear, at `NORMAL_STRENGTH` (1.6) times the strength `tools/extract` measured for the material.
  - Translucent blend modes render transparent. Materials the game marks `twoSided` are DoubleSide.
  - An ORM entry that duplicates the normal map is ignored (an extractor quirk).
- **Inspector.** With nothing selected: the map's name, its creator (read-only) and its lighting. With a selection: position (game cm, Z up), rotation and scale as editable rows that work across several items, with copy and paste per row, then Flip X and Flip Y (`FlipSection`), Pivot, Paint (`PaintSection`) and the item's properties (`ItemProperties`), which follow the game's details panel.
- **Panels.** The dock: drag a tab to move a panel around the map tabs and viewport, stack or split it, fold it or pop it out, and close or reopen it from View. [docs/DESKTOP.md § Dock](../../docs/DESKTOP.md#dock) describes it, and `components/dock/panels.tsx` lists the panels.
- **Settings** (File › Settings…). A large modal with a left nav, a search box over every setting, and per-category "Reset to defaults". Everything except keybinds is one `Settings` schema persisted by the `SettingsStore` service (`ballest-editor.settings.v1`). Loading is per field, so a bad value falls back to its default without dropping the rest. Per-map prefs are in `ballest-editor.maps.v1`.
  - **General:** inspector units (cm or m), creator name, Alt+drag duplicates, Export every save (desktop). Autosave is a disabled placeholder.
  - **Editor:** placement distance, and whether a selection change is its own undo step.
  - **Camera:** the game's camera presets (from `keybinds.json` `cameraPresets`, plus Custom with its own FOV), fly speed, look sensitivity, invert look on each axis, when to lock the pointer, and which movement keys need the look button. The game's FOV is horizontal, converted to three.js's vertical FOV at a fixed 16:9 reference, so resizing the window shows more at the sides instead of zooming.
  - **Keybinds:** the game's own section names ("mouse and keyboard free camera": forward, reverse, left, right, look, up, down; "mouse and keyboard bindings": look right, left, up, down) among the editor's ("level editor", "edit", "editor camera", "file", "game", "help"). Game labels come from `keybinds.json` when present. Every row has a tooltip describing what it does in the editor. Click a binding and press a key, mouse button or wheel; Esc cancels. Overrides persist in `ballest-editor.keybinds.v4`.
  - **Appearance:** theme (dark, light, system), animation speed, grid visibility and colours, water.
  - **Lighting:** the map's sun and sky light or fixed studio lights, and whether the sky is drawn.
  - **Game** (desktop): the Game link.

### Default bindings

The defaults are the game's own, from its in-editor hotkey overlay and settings screen, plus editor-only actions (`defaultKeybinds` in `src/domain/Keybinds.ts`). Shift+/ held shows them in a cheat sheet.

| Action                                | Default                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| Select, Move, Rotate, Scale tools     | Q, W, E, R                                                        |
| Local or world axes                   | C                                                                 |
| Focus the selection                   | F                                                                 |
| Add to or toggle the selection        | Shift+click, Ctrl+click                                           |
| Delete                                | Backspace, Delete                                                 |
| Duplicate, copy, cut, paste           | Ctrl+D, Ctrl+C, Ctrl+X, Ctrl+V                                    |
| Undo, redo                            | Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z                                    |
| Deselect, cancel a drag               | Escape                                                            |
| Fly                                   | W, A, S, D, Space up, Left Ctrl down, while RMB is held           |
| Look                                  | RMB-drag, arrow keys                                              |
| Orbit, pan                            | Alt+LMB, MMB                                                      |
| Camera speed                          | Wheel                                                             |
| New map, Import, Save                 | Alt+N, Ctrl+O, Ctrl+S                                             |
| Duplicate map (desktop), Export (web) | Ctrl+Shift+S                                                      |
| Close tab, next tab, previous tab     | Ctrl+F4, Ctrl+Tab or Ctrl+PageDown, Ctrl+Shift+Tab or Ctrl+PageUp |
| Play                                  | F5                                                                |

- By default every movement key flies only while the look button is held, as in the game, so W stays free for the Move tool. Settings › Camera changes that.
- The game's look is Mouse2D, which needs a held button in a browser, so look is RMB-drag.
- "fly faster" is unbound, because the wheel already changes speed.
- The free camera's "center camera" (C) is left out of `GAME_ACTIONS`, because C means local or world axes in the in-game editor.
- Down (Left Ctrl) doesn't move the camera when it's the modifier of a chord (Ctrl+Z, Ctrl+C, Ctrl+V, Ctrl+D, Ctrl+click, the browser's own Ctrl shortcuts). A movement action bound to a bare modifier key only acts after a short solo hold, and pressing a key that isn't a movement key or clicking a bound chord suppresses it until released (`HeldKeys`, `formsChord`).

The mapping from `keybinds.json` lives in `src/domain/GameKeybinds.ts`:

- `EDITOR_CONTEXTS`: which contexts may set bindings (free cam, universal, and the empty editor contexts).
- `GAME_ACTIONS`: game action to editor action. Negate and Swizzle modifiers resolve to a direction.
- `UE_KEY_TO_CODE`: the only key table.

Names come from any context except gamepad rows.

## Architecture

```
src/
  routes/       __root.tsx; index.tsx, the one route
  domain/       pure logic and schemas, framework-free
    MapFile, MapPrefs          the map JSON (open structs keep unknown fields; game key order); per-map prefs
    Catalog, bundledCatalog    catalog.json (open structs), CatalogIndex, palette; the fixture catalog
    Materials, Paint, surface  materials.json; the game's picker; item surfaces
    coords                     THE ONLY place where UE and three.js frames meet, for TypeScript
    ueMath, ueJson             Unreal math; UE-layout JSON writer (tabs, CRLF, Allman objects, %.17g)
    factory, edits, limits     constructors; pure edits; the game's load rules
    gameRules, editTransform   the rest of those rules, measured; what the game does to an edit of a decal or elevator
    groupTransform, pivot, mirror, snap, placement, itemProperties, mapTags, level, sunlight, sky, color
    Keybinds, GameKeybinds     editor actions and defaults, chords; keybinds.json to editor actions
    flyKeys, Settings          fly rules and formsChord; the settings schema
    creator, gameLink, linkState, notifications, project, time, unsaved
  services/     Effect services (Context.Service + Layer); errors are Schema.TaggedError
    MapCodec, MapExporter                          text to map and back; save and export checks
    CatalogLoader, MaterialLibrary, GameKeybinds   served assets
    KeybindStore, SettingsStore, MapPrefsStore     localStorage
    Platform                                       browser or desktop (docs/DESKTOP.md)
    runtime.ts                                     the single ManagedRuntime
  editor/       React, three.js and state
    store, commands, useActionKeys       zustand store; one-shot commands; key handling
    Viewport, FlyCamera, ItemObject      scene, camera, items
    visuals, materials, winding          what to draw; three materials and textures; the winding guard
    selectionOutline, sceneRegistry, thumbnails, preload, assetUrl, sky, water, SceneLights, LaserBeam
    actions/    what components call; runs the Effects, a module per area
    gizmo/      math (projections, game to world axes), handles (composable three.js handles),
                drag (pointer to game transform), GizmoController (events, preview, undo, Escape)
  components/   the UI, all from @workspace/ui
  test/         test helpers
```

### Coordinates and winding

Scene mapping: `three(x, y, z) = UE(x, z, y)`, 1 unit = 1 cm.

- It has det -1. That is required to keep forward, right and up across the handedness change; a proper rotation would mirror maps.
- Quaternions map as `(-qx, -qz, -qy, w)`.
- glbs are raw UE local space, wrapped in a group whose matrix is the same M (`UE_TO_THREE_MATRIX`).
- `coords.test.ts` checks the axis semantics and that every sample transform round-trips bit-exactly.
- Shader code that reads world positions has the same y/z swap written into it (`editor/materials.ts`).

Materials default to `FrontSide`. three.js decides front faces in **local** space: under a mirrored world matrix it flips `gl.frontFace` to compensate. So a glb renders solid only if its triangles are CCW around their normals in the file's own coordinates.

- The first extractor output kept UE's clockwise index order, which is why rings and tori looked hollow.
- The current glbs are exported CCW-outward.
- `editor/winding.ts` checks each geometry once and reverses the winding only if most triangles disagree with their normals. It does nothing for current files and guards against stale exports.
- `winding.test.ts` asserts outward front faces for Torus, SM_Sphere and SM_500 under the mirror root. It skips when `assets/pieces/` isn't on disk.

## Tests

`pnpm test` runs vitest with `@effect/vitest`, with test files beside the code. The ones that matter most when you change their subject:

- Every sample round-trips decode to encode JSON-equal. The `.balledit` drafts also round-trip byte-identical.
- Coordinates and winding.
- The real catalog, and the real `keybinds.json` (game defaults for WASD, Space, Ctrl, wheel, Escape).
- Game keybind mapping (axis modifiers, context whitelist, fallbacks) and `KeybindStore` (defaults, overrides, corrupt data, reset).
- Exporter, factory, edits (including renormalized rotations), the undo and redo store.
- Gizmo: math (axis and plane projection, screen angles, game to world axes), that the rendered red arrow points along the mapped game +X with no mirrored transforms, that only the hovered handle highlights, and translate, plane, rotate and scale drags in game space.
- Selection outline, including a 37° game-Z rotation.
- Materials: parsing the real file (blue is blue, glass is translucent, the old `M_BaseSurface_Metal` path resolves), per-slot assignment, neutral fallback.
- Palette sections.

## Not done yet

[docs/VISION.md](../../docs/VISION.md) has the feature plan. The code-level gaps:

- The selection-origin dot is a TODO in `gizmo/handles.ts` (#82).
- No instancing, and large maps haven't been profiled.

In dev, `globalThis.__ballest` exposes the scene registry and the store for debugging.
