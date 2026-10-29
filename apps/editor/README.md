# Ballest editor (apps/editor)

Web map editor for _Ballest of Them All_. TanStack Start (React, Vite), three.js via
@react-three/fiber + drei, Effect v4 for services, schemas and errors. The UI chrome is
built from shadcn/ui components in `packages/ui` (`@workspace/ui`, Base UI primitives,
Tailwind v4).

## Running from the repo root

The repo is a pnpm + Turborepo workspace (`apps/*`, `packages/*`). From the root:

```sh
pnpm install
pnpm dev         # turbo dev       -> http://localhost:3000
pnpm test        # turbo test      (vitest + @effect/vitest)
pnpm typecheck   # turbo typecheck (tsc --noEmit in every package)
pnpm lint        # turbo lint      (eslint)
pnpm build       # turbo build     -> apps/editor/dist
```

Inside `apps/editor` the same scripts exist (`pnpm dev`, `pnpm test`, …), and
`pnpm start` runs `vite preview` on the build.

To add shadcn components, run `pnpm dlx shadcn@latest add <name>` in `apps/editor`.
They're installed into `packages/ui/src/components` (see both `components.json` files).
The preset is `b6nCVm82TK` (style `base-mira`, tabler icons).

`/assets/*` is served from the repo-level `assets/` directory (`../../assets`: catalog.json,
keybinds.json and pieces/**.glb from tools/extract). A small Vite plugin in
`vite.config.ts` does this in `dev` and `preview`, with `Cache-Control: no-cache`, so the
glbs are never copied and a re-exported glb is picked up on reload. If
`assets/catalog.json` is missing, the app falls back to `src/domain/bundledCatalog.json`
and shows a badge. If `assets/keybinds.json` is missing, every keybind uses the editor
default.

## Using it

- **New / Import / Export** in the top bar (also bound to Alt+N / Ctrl+O / Ctrl+S).
  - Export writes `Map_LevelEditorMain&<name>_<creator>.balledit` with the level fields
    the game expects.
  - It refuses to export without exactly one player start.
- **Palette**: grouped by the catalog's `category` in file order (collapsible). Pieces
  with no category go under "Other"; `inPalette: false` pieces go in a collapsed
  "Hidden (not in the in-game browser)" section. `displayName` and `thumbnail` are used
  when present. Search covers all sections. Clicking a piece places it at the
  ground-plane hit under the screen centre, or 15 m ahead of the camera. Only a real
  pointer click places: Space or Enter on a focused entry does nothing, and focus moves
  to the viewport afterwards.
- **Floating toolbar** (bottom centre of the viewport): Select / Move / Rotate / Scale.
  Tooltips show the current keybind (V / G / R / T by default). Pointer-only: it never
  takes keyboard focus.
- **Gizmos** (Blender-style, `src/editor/gizmo/`):
  - Rendered in world space, never under a mirror. Axes are expressed in game
    coordinates: X red, Y green, Z blue = up. Directions come from mapping the game basis
    through `coords.ts`, and arrows never flip toward the camera.
  - Constant screen size, drawn on top, grabbed through invisible fatter hit meshes.
  - Hover highlights only the hovered handle. A drag keeps the active handle lit, dims
    the others, and shows a guide line in the axis colour.
  - Move uses axis arrows plus plane squares. Rotate uses rings plus a white view ring.
    Scale uses cubes on the item's local axes plus a centre uniform ring.
  - The inspector follows the drag live. Each drag is one undo entry, and Escape cancels
    a drag, restoring the transform.
  - Handles are composable specs (`toolHandles`), so a combined tool is a concatenation.
- **Selection box**: an oriented box from the item's local bounds, parented to the item,
  so rotating a piece turns the box instead of growing it (`selectionBounds.ts`).
- **Materials**: `MaterialLibrary` loads `assets/materials.json` (tolerant; a missing file
  means neutral grey). Each primitive gets its game material by UE slot index: the
  item's `materials[]` first, then the catalog's `defaultMaterial`/`meshMaterial`.
  - Lookup is by exact path, then the `redirectedTo` alias, then asset name, so old
    paths such as `M_BaseSurface_Metal` resolve.
  - Base colour, metallic, roughness, opacity and emissive (linear) are applied.
  - Base-colour textures use sRGB per `textures[].sRGB`. Normal maps are linear with
    `normalScale (1, -1)` because UE uses DirectX green.
  - Translucent blend modes render transparent. Materials the game marks `twoSided` are
    DoubleSide.
  - An ORM entry that duplicates the normal map is ignored (an extractor quirk).
  - Textures may not line up where the game uses world-aligned mapping; flat colour is
    the reliable part.
- **Inspector**: map name/creator when nothing is selected; for an item, position
  (game cm, Z up) plus read-only rotation, scale, meshes and materials.
- **Panels**: drag the dividers to resize the palette and inspector. Sizes persist in
  localStorage (`react-resizable-panels:ballest-editor.layout.v1`).
- **Settings** (top bar → Settings; a TODO marks where a File/Edit/View menu bar will
  reach it):
  - A large modal with a left nav (General / Camera / Keybinds / Appearance), a search
    box over every setting, and per-category "Reset to defaults".
  - Everything except keybinds is one `Settings` schema persisted by the
    `SettingsStore` service (`ballest-editor.settings.v1`). Loading is per field, so a
    bad value falls back to its default without dropping the rest.
  - **General:** inspector units (cm/m); autosave is a placeholder.
  - **Camera:** the game's camera presets (from `keybinds.json` `cameraPresets`, plus
    Custom with its own FOV), fly speed, look sensitivity, invert look. The game's FOV is
    horizontal and is converted to three.js's vertical FOV per viewport aspect.
  - **Appearance:** theme (dark/light/system) and grid visibility/colours.
  - **Keybinds:** the game's own names and sections ("mouse and keyboard free camera":
    forward, reverse, left, right, look, up, down; "mouse and keyboard bindings": look
    right/left/up/down), then editor-only sections. Labels and sections
    come from `keybinds.json` when present. Every row has a tooltip describing what it
    does in the editor. Click a binding and press a key, mouse button or wheel; Esc
    cancels. Overrides persist in `ballest-editor.keybinds.v3`.

### Default bindings

The defaults are the game's own. Arrow keys look, F focuses the selection, C switches
the gizmos between local and world axes, and the wheel changes camera speed. The free
camera's "center camera" (C) is left out of `GAME_ACTIONS` because C means local / world
axes in the level editor. Gizmos are V/G/R/T: T is "replay camera mode" in the game, but
that's free in the editor. Editing uses Delete, Ctrl+Z/Ctrl+Y and Escape. File uses
Alt+N/Ctrl+O/Ctrl+S.

- **WASD** flies.
- **Space** goes up.
- **Down is Left Ctrl**, as in the game. It doesn't move the camera when it's the
  modifier of a chord (Ctrl+Z, Ctrl+C, Ctrl+V, Ctrl+D, Ctrl+click, the browser's own Ctrl shortcuts).
- **"fly faster" is unbound** (the wheel already changes speed).
- **RMB-drag looks.** The game's look is Mouse2D, which needs a held button in a browser.
- **Alt+LMB orbits, MMB pans.**

A movement action bound to a bare modifier key only acts after a short solo hold, and
pressing a key that isn't a movement key (Ctrl+Z, Ctrl+C) or clicking a bound chord
(Ctrl+click) suppresses it until released (`HeldKeys`, `formsChord`).

The mapping lives in `src/domain/GameKeybinds.ts`:

- `EDITOR_CONTEXTS`: which contexts may set bindings (free cam, universal, and the empty
  editor contexts).
- `GAME_ACTIONS`: game action → editor action. Negate/Swizzle are resolved to a
  direction, so IA_Look arrows become the look actions.
- `UE_KEY_TO_CODE`: the only key table.

Names come from any context except gamepad rows.

## Architecture

```
src/domain/            pure, framework-free
  MapFile.ts           Schema for the map JSON; open structs keep unknown fields; game key order
  Catalog.ts           Schema for catalog.json (open structs) + CatalogIndex
  GameKeybinds.ts      Schema for keybinds.json + game -> editor action mapping
  Keybinds.ts          editor actions, groups, fallbacks, chord strings
  coords.ts            THE ONLY place where UE and three.js frames meet
  ueJson.ts            UE-layout JSON writer (tabs, CRLF, Allman, %.17g)
  factory.ts, edits.ts, ueMath.ts
src/services/          Effect services (Context.Service + Layer); errors are Schema.TaggedError
  MapCodec, CatalogLoader, GameKeybinds, MaterialLibrary, KeybindStore (KeyValueStore over localStorage),
  MapExporter, runtime.ts (the single ManagedRuntime)
src/editor/            React/R3F: store (zustand), Viewport, FlyCamera, ItemObject,
                       winding.ts, materials.ts (three material/texture cache),
                       selectionBounds.ts, useActionKeys, commands, actions (runs Effects)
src/editor/gizmo/      math.ts (projections, game<->world axes), handles.ts (composable
                       three.js handles), drag.ts (pointer -> game transform),
                       GizmoController.tsx (events, preview, undo, Escape)
src/components/        TopBar, Palette, Inspector, dialogs (all @workspace/ui)
packages/ui            shadcn components (button, input, label, dialog, badge, resizable,
                       separator, scroll-area, kbd, sonner, tooltip) + globals.css
```

### Coordinates and winding

Scene mapping: `three(x, y, z) = UE(x, z, y)`, 1 unit = 1 cm.

- It has det -1. That is required to keep forward, right and up across the handedness
  change; a proper rotation would mirror maps.
- Quaternions map as `(-qx, -qz, -qy, w)`.
- glbs are raw UE local space, wrapped in a group whose matrix is the same M
  (`UE_TO_THREE_MATRIX`).
- `coords.test.ts` checks the axis semantics and that every sample transform round-trips
  bit-exactly.

The extractor README suggests a different mirror, `(ue.y, ue.z, -ue.x)`. Both are valid;
they differ only in which way UE +X faces in three.js.

Materials stay `FrontSide`. three.js decides front faces in **local** space: under a
mirrored world matrix it flips `gl.frontFace` to compensate. So a glb renders solid only
if its triangles are CCW around their normals in the file's own coordinates.

- The first extractor output kept UE's (clockwise) index order, which is why rings and
  tori looked hollow.
- The current glbs are re-exported CCW-outward.
- `editor/winding.ts` checks each geometry once and reverses the winding only if most
  triangles disagree with their normals. It's a no-op for current files and a guard
  against stale exports.
- `winding.test.ts` asserts outward front faces for Torus, SM_Sphere and SM_500 under
  the mirror root.

## Tests

- Every sample round-trips decode -> encode JSON-equal. The `.balledit` drafts also
  round-trip byte-identical.
- Coordinates and winding.
- The real catalog, and the real keybinds.json (game defaults for WASD/Space/Ctrl/wheel/Escape).
- Game keybind mapping (axis modifiers, context whitelist, fallbacks).
- KeybindStore (defaults, overrides, corrupt data, reset).
- Exporter, factory, edits (incl. renormalized rotations), undo/redo store.
- Gizmo:
  - math (axis/plane projection, screen angles, game -> world axes)
  - the rendered red arrow points along the mapped game +X, with no mirrored transforms
  - only the hovered handle highlights
  - translate/plane/rotate/scale drags in game space
- Selection box: a 37 deg game-Z rotation leaves local bounds identical, and the OBB
  corners equal the item's world matrix applied to the local corners.
- Materials: parsing the real file (blue is blue, glass is translucent, the old
  M_BaseSurface_Metal path resolves), per-slot assignment, neutral fallback.
- Palette sections.

## Stubbed / not yet done

- Rotate/scale have gizmos but no numeric fields. No snapping or multi-select yet.
- The selection-origin dot (perspective on faces, dotted line when inside the bounds) is
  a TODO in `gizmo/handles.ts`.
- In dev, `globalThis.__ballest` exposes the scene registry and the store for debugging.
- `editorState.groups` isn't remapped on delete; no sample has groups.
- Air vent and decal properties are emitted empty. Materials aren't rendered (the glbs
  have flat placeholder materials).
- No instancing, and large maps haven't been profiled.
- Exported maps haven't been loaded in game yet.
