# tools/extract: piece meshes, catalog, keybinds and materials from the game pak

This pipeline reads the game's IoStore containers, resolves the level-editor piece Blueprints, and writes:

- `assets/pieces/**.glb`: one file per StaticMesh (LOD0). The path mirrors the UE package path without `/Game/`, so `/Game/Maps/_GENERATED/PC/SM_500.SM_500` becomes `pieces/Maps/_GENERATED/PC/SM_500.glb`, and `/Engine/...` becomes `pieces/_Engine/...`.
- `assets/catalog.json`: one entry per level-editor item class: the 200 the recipe registry references, which include all 91 classes seen in `samples/`. Every exported mesh is listed too.
- `assets/thumbs/*.png`: the content-browser icons, at most 256 px and about 3 MB. They are committable.
- `assets/keybinds.json`: the default Enhanced Input bindings, with in-game labels, settings sections and camera presets.
- `assets/strings.json`: the English locres strings.
- `assets/registry.json`: the item class hierarchy, the in-game palette, and recipe-registry references (which pieces exist).
- `assets/materials.json` + `assets/textures/**.png`: material parameters, plus how each texture is read (UV or object/world projection, scale, layers), traced through the game's compiled shaders (the textures are gitignored, about 142 MB).

The current output has 200 pieces and 5 unresolved. 195 meshes were exported with 0 failures. That covers the 157 meshes referenced by the pieces, including their extra components, plus everything else in `/Game/Maps/_GENERATED/PC`. All files pass the Khronos glTF validator with no errors or warnings.

`assets/pieces/` is about 86 MB, so it is listed in `.gitignore`. Of that, 34 MB is `/Game/Maps/_GENERATED/PC/Box`, a 1.2M-triangle mesh that no piece uses. The glbs referenced by the catalog total about 49 MB.

## Running it

```sh
nix run .#extract                                   # default Steam path
nix run .#extract -- "/path/to/Ballest of Them All" --pieces-only --keep-work
nix develop -c tools/extract/run.sh [GAME_DIR] [options]   # same thing, from the dev shell
```

Run it from the repo root. By default it reads `./samples` and writes to `./assets`. Use `run.sh --help` to see the options.

Flakes only see files tracked by git. Until `flake.nix`, `flake.lock` and `tools/` are committed, use `path:.#extract` instead. That copies the whole working tree into the store, which is slow because of `app/node_modules`.

What `run.sh` does:

1. Copies `Ballest/Content/Paks/*.{pak,utoc,ucas}` to `/tmp/ballest-paks` (`--paks-copy`) with `cp -u -p`. The game directory is only read and is never opened for writing.
2. Downloads data files, each into its own directory under `~/.cache/ballest-editor/downloads/`:
   - **Oodle.** CUE4Parse's `OodleHelper` downloads `liboodle-data-shared.so` from its pinned `WorkingRobot/OodleUE` release.
   - **The `.usmap`.** This is Fortnite `++Fortnite+Release-42.40-CL-59086525`, from the URL pinned in `run.sh` (found via `fortnitecentral.genxgames.gg/api/v1/mappings`). The download is checked against a sha256.
3. Builds `cue4/` (the `BallestExtract`, .NET 10 project) against the pinned CUE4Parse source. That source comes from the flake input `cue4parse`, rev `df14b99`. The build copies it into `~/.cache/ballest-editor/extract` because the nix store is read-only and dotnet writes `obj/` next to the sources. NuGet restore needs network access.
4. Runs the pipeline:
   1. `scan-samples.mjs` lists the classes in the samples.
   2. `BallestExtract classes` resolves each Blueprint's components.
   3. `build-catalog.mjs meshes` builds the mesh list.
   4. `BallestExtract export` writes the glbs.
   5. `build-catalog.mjs catalog` writes `catalog.json`.
5. Writes `assets/keybinds.json`, `assets/materials.json` + `assets/textures/`, and `assets/registry.json` (see below).
   Materials go through `src/` (TypeScript + Effect, run by node directly): `materials list` collects the referenced materials, `BallestExtract materials` dumps them, `materials shader-list` + `BallestExtract shaders` dump every loaded material's cooked vertex/pixel shaders from the IoStore shader library, `shaders` disassembles them with `dxc` and traces each texture read back to its coordinate source, and `materials build` writes `materials.json` from both.
6. Runs `verify.mjs`, which has no dependencies. It parses the GLB and recomputes bounds and the signed volume (winding) for `SM_500` and `SM_Start_Fixed`.

The extractor also has debugging modes. Run them with `dotnet ~/.cache/ballest-editor/extract/bin/BallestExtract.dll MODE --paks DIR --oodle FILE --usmap FILE ...`:

- `list --filter X` lists files in the pak.
- `probe <Ballest/Content/...>` dumps every export of a package as JSON.
- `dump --prefix DIR --file PATH --out F` does the same for a whole directory, plus loose files, with errors captured.
- `imports --prefix DIR [--props PKG] --out F` writes header-only dependency data (imports, name-map paths, export classes and supers).
- `usmap-dump --types A B` prints the property layout the `.usmap` gives for those types.
- `shaders --list FILE --out DIR` writes each listed material's base-pass shaders (`DIR/<asset>/*.dxil`) and `DIR/index.json` (shader map hashes, the uniform expression set with texture slots and preshader bytecode).

## Shader analysis (`src/shaders.ts`)

A cooked `UMaterial` has no expression graph, so UV tiling, projection and texture wiring can't be read from the asset. The compiled shader is the graph: `src/dxil.ts` parses `dxc -dumpbin` output and, for every `sample` in the base-pass pixel shader, walks the coordinate's SSA chain back to its sources (interpolants, vertex buffers, GPU-scene transforms, constant-buffer parameters, literals), keeping the product of literal factors along each path; the vertex shader's outputs are traced the same way so an interpolant resolves to the mesh UVs or to the object/world position. `src/preshader.ts` decodes the material preshader so constant-buffer slots map back to parameter names, and `src/approx.ts` (the per-material half of `materials build`: name picks, translucency, layers, output) folds the instance's parameter values in. The result per material is `approx.reads`: texture, role, projection (`uv` / `object` / `world`), scale in repeats per UV unit or per cm, whether the piece's instance scale multiplies in, and a normal layer's strength. `src/evaluate.ts` goes one step further and evaluates the pixel shader numerically for the material's own parameter values and a facing view (constant buffers from the preshader slots, texture reads at 0 or their mean, view terms at their engine defaults): the GBuffer outputs then give the base colour, metallic and roughness the game really produces, and how much each colour texture adds (`approx.colorLayers`), so a master that lerps two colours by a fresnel or scales a texture by a parameter is read correctly without naming heuristics. Translucent passes are evaluated twice, for a face looking up and a vertical one: the beam materials (the vent's air, the checkpoint glow) multiply their alpha by `1 - |world normal z|`, so a cube drawn with them shows only its sides; `approx.opacity` is the larger alpha and `approx.upFade` what is left on an up-facing face. An additive pass renders as its evaluated unlit colour. `src/glsl.ts` goes further where the linearised layers cannot: it emits the shader's own output chain as GLSL (`approx.programs`: a translucent pass's alpha, an additive glow, an opaque base colour whose reads the layers cannot place), folding every parameter, engine constant and scene value for a piece at the origin (SCENE_ROWS / ENGINE_DEFAULTS in `src/evaluate.ts`, phis resolved by walking the control flow) and leaving the UVs, world normal, object position, material texture reads and the game time as inputs; the renderer runs it per fragment, so the vent's streaks are the game's for any frame (`uBallestTime`). The few materials the cooked data cannot describe (`M_PlasticBase` samples its cell noise from the engine's placeholder texture) are overridden by name in `src/materials.ts` (`OVERRIDES`). Checked against the game: the Env masters' 200 cm object-aligned tiles (20 across the 10 m cube, 80/40/20 at scale 2,1,1), the metal master's 12 UV repeats (48 tiles).

## Coordinate convention (glb files)

**The glb files are not converted to glTF's Y-up convention.** Vertex positions are raw Unreal values:

- centimetres
- left-handed axes: +X forward, +Y right, +Z up

Normals are UE TangentZ, normalized. UVs are UV0 as cooked; UE and glTF both put the UV origin at the top left.

### Winding (measured)

In the cooked UE index buffers, outward faces are **clockwise** when the stored positions are read with ordinary right-handed math. The signed volume `Σ a·(b×c)/6` comes out negative, and every face normal points opposite the vertex normals:

| mesh                       | signed volume, UE index order | after the writer fix |
| -------------------------- | ----------------------------- | -------------------- |
| `SM_500`                   | -25,000,000 (= -500·500·100)  | +25,000,000          |
| `SM_Sphere`                | -33,369,034                   | +33,369,034          |
| `Torus`                    | -443,775,589                  | +443,775,589         |
| `/Engine/BasicShapes/Cube` | -1,000,000                    | +1,000,000           |

glTF, and three.js, define the front face as **CCW in the mesh's local coordinates**. three.js keeps that true under a negative-determinant world matrix: it sees `det < 0` and switches `gl.frontFace` to CW, which compensates for the mirror. So under the mapping M (negative determinant), three.js flips frontFace, and faces are outward only if the stored winding is CCW-outward. With UE's original order they weren't, which is why rings and tori showed their inside faces. Mirroring the root does not change which faces three.js treats as front.

**Fix applied in `cue4/Glb.cs`:** each triangle is written as `(i0, i2, i1)`. The glbs are now CCW-outward in their stored coordinates, which is glTF-conformant. They still pass the Khronos validator with no errors or warnings. `verify.mjs` prints the signed volume as a check.

Opened in a plain glTF viewer, a glb now has correct faces, but it looks mirrored (left/right swapped) and Z-up, because the data is still left-handed.

### What the web app must do

1. Put all UE content under one root `Object3D` with this fixed matrix (determinant -1):

   ```js
   // three.x = ue.y (right), three.y = ue.z (up), three.z = -ue.x (UE forward = three -Z)
   root.matrixAutoUpdate = false
   root.matrix.set(0, 1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1)
   ```

   The mirror undoes UE's left-handedness, so the map isn't shown mirrored. three.js handles the CW/CCW switch itself.
2. Use **`material.side = THREE.FrontSide`**, which is the default. Don't use `BackSide`, and don't use `DoubleSide` as a workaround.
3. Under the root, use item transforms from the map file unchanged:
   - `translation` goes to `position`
   - `rotation` {x,y,z,w} goes to `quaternion`
   - `scale3D` goes to `scale`

   Quaternion rotation `q v q*` doesn't depend on handedness. If you ever convert a quaternion outside the root, use `v' = det(M) * M * v` on its vector part and keep `w`. For `M` above that gives `(-qy, -qz, qx, w)`.
4. FRotator values (`relative.rotation`) must go through UE's `FRotator::Quaternion` formula. `actorSpace`/`transformRelativeToMain` already give quaternions.
5. Normals are transformed correctly by three's `normalMatrix`, including under the mirror.

## catalog.json

The top level is an object, not a bare array:

```
{ version, game, units: "cm", coordinateSystem, transformNote,
  pieces: [Piece], unresolved: [{classPath, meshAssetPath?, reason}],
  meshes: [{meshAssetPath, glb, vertices, triangles, bounds, materialSlots}],   // every exported mesh
  meshErrors: [] }

Piece = {
  classPath            // full actorToSpawn string, as it appears in map files
                       // (built as /Script/Engine.BlueprintGeneratedClass'<objectPath>' for unsampled classes)
  category             // in-game content-browser category ("Ramps", "Tracks", "Shapes", ...) or null
  displayName          // palette display name or null
  inPalette, inRegistry// shown in the content browser / referenced by DA_UGCPlaybackRecipeRegistry
  thumbnail            // "thumbs/<Texture>.png" (palette icon) or null
  className            // e.g. "BP_Prim_Cube"
  objectPath           // "/Game/.../BP_Prim_Cube.BP_Prim_Cube_C"
  meshAssetPath        // Main component's StaticMesh (null when Main is meshless)
  glb                  // path relative to assets/, e.g. "pieces/Maps/_GENERATED/PC/SM_500.glb"
  materialSlots: [{ index, slotName, defaultMaterial, meshMaterial }]
                       // defaultMaterial = component OverrideMaterials[i] ?? mesh slot material
  bounds: { min:[x,y,z], max:[x,y,z] }   // mesh-local, UE cm, from LOD0 vertices
  seenInSamples        // item count across samples/ (0 for classes never sampled)
  meshSource           // "pak" (resolved from the Blueprint) | "samples" (fallback)
  sampleMeshAssetPath  // most common meshAssetPath the game wrote for this class
  mainRelativeTransform// Main's RelativeLocation/Rotation/Scale3D in the BP (informational)
  extraMeshes: [{ name, meshAssetPath, glb, visible, hiddenInGame,
                  transformRelativeToMain: {location, quat, scale}, materialSlots, bounds }]
  sampleProperties     // "propertyName:type" pairs seen in samples
  properties: [{ name, list, type, ueType, default, hidden, source }]
                       // the CDO's LevelEditorExposedProperties, in order: list/type are where and how
                       // map files store it ("floatProperties"/"Float", "intProperties"/"Integer",
                       // "boolProperties"/"Bool"; null for other Blueprint types), default is the CDO
                       // value (0/false when unversioned serialization omitted it), hidden = listed in
                       // LevelEditorHiddenProperties (left out of the in-game property panel)
}
```

**`properties`:** where the CDO lists `LevelEditorExposedProperties` (the air vent, the circuit decal, five light classes) they come from there (`source: "cdo"`). Some classes expose properties from native code instead (the shape decal, the light cards): for those the names, lists and order are the ones the game wrote into the samples, and the defaults are the Blueprint variables' CDO values (`source: "samples"`; the class's `variables` in `classes.json`). Every sample item's properties match these names, lists and order, and unedited sample items carry exactly these defaults.

**Piece order:** palette order first, category by category, following `DT_MapItems` rows and the items within each. Then the 100 registry-only ("hidden") items, alphabetically.

The pieces are the classes referenced by `DA_UGCPlaybackRecipeRegistry`. Every one of them descends from `BP_BaseItem`. The one item class missing from the registry, `BP_TwoCubeTwoColor_2`, is left out, and so are non-item classes such as `BP_KillZone`.

**`unresolved` (5):** classes with no mesh in any StaticMeshComponent:

- `BP_ActualCheckpointBase` and `BP_PhysicsPropBase`: abstract bases; their subclasses are pieces.
- `BaseSplineActor` and `BaseSplineActor2`: the geometry is generated at runtime.
- `MP_CheckpointStrip`

All five are registry-only.

Nine pieces have a meshless `Main` and are drawn only from `extraMeshes`:

- `MP_AirVent`, `BP_AirVent`
- `MP_ActualCheckpoint_Strip`, `MP_ActualCheckpoint_Disc`
- `BP_UGCCircuitDecal`, `BP_UGCShapeDecal`
- `BP_CircularFlexiblePlatform`, `MP_OrangeSign`, `MP_PinballPaddle`

In each glb, `materials[i]` is UE material slot `i`. The material is named `"<i>:<slotName>"` and carries `extras.ueMaterial`. Each section is one primitive with `material` set to the UE section's material index, also stored in `extras.ueMaterialIndex`. The materials themselves are flat placeholders, because no textures or material graphs are extracted.

### How to place a piece (finding)

**`itemTransform` in a map file is the world transform of the `Main` component, not of the actor root.** Two pieces of evidence:

- In every sample, items whose `Main` template has a non-identity scale were saved with that same scale:
  - `MP_AirVent`: Main scale (0.75, 0.75, 1); 211/211 items have scale3D (0.75, 0.75, 1)
  - `BP_Checkpoint`: 1.5; 68/69 items
  - `MP_PlayerStart`: 0.2765; 21/22 items
- The map JSON stores `meshComponents[]` only for the component tagged `SKGMapEditor`, which is `Main`.

So to place a piece:

1. Render `glb` with `itemTransform` applied directly.
2. Render each visible `extraMeshes[]` entry with `itemTransform * transformRelativeToMain`.

Three classes have a meshless `Main` and are drawn only through `extraMeshes`:

- `MP_AirVent` (`SM_AirVent` plus a wind cube)
- `MP_ActualCheckpoint_Strip` (`SM_ActualCheckpoint_Strip`, light rods, aura cube)
- `BP_UGCCircuitDecal` (an editor-only marker sphere, `hiddenInGame`)

The decal itself is a game-native component and isn't readable (see Limits).

## keybinds.json

`run.sh` also dumps the Enhanced Input assets (`BallestExtract dump`) and turns them into `assets/keybinds.json` (`build-keybinds.mjs`). It reads:

- every package under `/Game/Core/Input`
- the SKGMultiplayerLevelEditor plugin dir (only a `.uplugin` is cooked; no content)
- the level-editor widgets and player controller
- `Ballest/Config/DefaultInput.ini`, a loose file in `Ballest-Windows.pak`

Output shape:

```
{ contexts: [{ name, path, priority: null, description,
               mappings: [{ action, key /* FKey name */, modifiers: [class], triggers: [class],
                            modifierSettings: [{type, settings}], triggerSettings, mappable?: {name, displayName, category} }] }],
  actions: [{ name, path, valueType, description, consumeInput, triggerWhenPaused, accumulationBehavior, modifiers, triggers, ... }],
  legacy: { actionMappings, axisMappings, consoleKeys, defaultInputComponentClass },
  blueprintKeyEvents: [...], errors: [{ asset, message }], notes: [...] }
```

- `modifierSettings`/`triggerSettings` are effective values: UE 5.8 class defaults merged with the cooked deltas.
- `priority` is not stored in the asset, so it is always null.
- **Usmap patch:** UE 5.8's `FEnhancedActionKeyMapping` has `bShouldBeIgnored` after `Key`, which Fortnite's mapping lacks. `Program.cs` (`OnlyInUe58`) inserts it. Without that, `IMC_Play` fails with `EnhancedActionKeyMapping: Unknown property with value 7. Can't proceed with serialization (Serialized 5 properties until now)`.
- The game-native modifiers can't be parsed. These are `BallestInputModifierLookSensitivity`, `...StickDeadzone`, `...CaptureMove` and `...LatestMove`, which fail with `Missing prop mappings for type ...`. They appear with `settings: null` and are listed under `errors`. All 16 errors are of this kind.
- **The level editor's own shortcuts are not data.** In the cooked game:
  - `IMC_LevelEditor`, `IMC_ModeEditor`, `IMC_MainMenu`, `IMC_ModeRace` and `IMC_Paused` are empty. Each is a 10-byte export with no properties.
  - `IA_Translate`, `IA_Rotate`, `IA_Scale` and `IA_Coordinates` exist but are mapped by no context.
  - There are no legacy Action/Axis mappings in `DefaultInput.ini`.

  The editor hotkeys live in the native SKGMultiplayerLevelEditor code. The exe has `USKGMLEGizmoDeveloperSettings`, with properties such as `ToggleGizmoVisibilityKey`, and its `[...SKGMLEDeveloperSettings]` ini section is empty, so the defaults compiled into the exe apply. Getting them would mean disassembling the exe, or reading the settings CDO with a game usmap.

  In the level editor, the camera uses `IMC_FreeCam`:
  - WASD: `IA_Pan`
  - SpaceBar / LeftControl: `IA_Height`, up / down
  - Mouse2D: `IA_Camera`, look
  - MouseWheelAxis: `IA_CamSpeedModifier`
  - Gamepad equivalents for all of the above

  `IMC_Universal` maps Escape to `IA_Pause`.

### Labels, sections, camera presets, strings

- **`label`** on each mapping and action is `PlayerMappableKeySettings.DisplayName`, for example "Forward", "Replay back 5 seconds" or "Look Right". This is the text the Controls page shows; the UI lowercases it.
- **`section`** is the Controls-page header the mapping is listed under. It comes from `UI/MainMenu/Pages/WBP_2_Settings`, whose `Keybinds` scroll box alternates `WBP_OptionsHeader` (the title) with a box named `<Game|Spectator>Bindings_<MNK|Controller>_VB`. The widget graph fills each box at runtime from the key profile, filtered by `DisplayCategory`:

  | `DisplayCategory`     | Section                          |
  | --------------------- | -------------------------------- |
  | `MNK`                 | "mouse and keyboard bindings"    |
  | `SpectatorMNK`        | "mouse and keyboard free camera" |
  | `Controller`          | "gamepad"                        |
  | `SpectatorController` | "gamepad free camera"            |

  Those category literals appear in the widget's bytecode.
- **`sections[]`** gives the sections in UI order with their actions. Membership is exact. Row order within a section is assigned at runtime and isn't stored in the asset, so it's listed in IMC order. Each section has 9 or 11 design-time row slots (`rowSlots`).
- **`cameraPresets`** comes from `Core/SaveSystem/Settings/CameraSettings/DT_CameraSettingsPresets`: Default 90/350/65, Wide Angle 110/310/75, Over the Shoulder 90/150/60, Orbital 110/600/200 (fov/distance/height; pitch 0 for all). The dropdown also offers Custom.
- **`assets/strings.json`** holds all 1404 English strings from `Localization/Game/en/Game.locres`, as `{namespace: {key: text}}`. It is written by the new `BallestExtract locres` mode.
- **Usmap patch:** reading the widget instances needed one more: `BlueprintGeneratedClass` drops `bIsNativePropertyInitFastPathDisabled`. That property isn't in the 5.8 header, and without the patch every BP class failed with `Failed to read ... BoolProperty bIsNativePropertyInitFastPathDisabled`.

## materials.json and textures

`run.sh` collects material paths from two sources:

- all sample `materials[].material` entries
- every `defaultMaterial`/`meshMaterial` in `catalog.json`, including `extraMeshes`
- every material the in-game Paint picker offers (see below)

That gives 122 paths now that the catalog covers all 200 pieces. `BallestExtract materials` follows each one's `Parent` chain up to the root `UMaterial` and dumps every asset in the chain. It also decodes every texture those assets reference: 55 textures, written as PNG to `assets/textures/` mirroring the UE path. Each PNG is the largest mip at or below `--tex-max`, which defaults to 2048 px. Textures with no mip that small (single-mip UI textures, for example) are resized with ImageSharp.

The textures total about 142 MB, so `assets/textures/` is gitignored.

Decoding uses CUE4Parse-Conversion's managed AssetRipper BCn decoder (`TextureDecoder.UseAssetRipperTextureDecoder = true`), and the PNGs are written with ImageSharp. Neither SkiaSharp nor any native library is needed, so the flake doesn't add one.

Normal maps (BC5) get their Z channel rebuilt, and they keep UE's DirectX green channel. In three.js, use `normalScale (1, -1)`.

`build-materials.mjs` merges each chain from the root down: instances store only their overrides. That produces:

- `scalars`, `vectors` (linear RGBA), `textures` (PNG paths) and `switches`
- `blendMode`, `shadingModel`, `twoSided`
- `connectedOutputs`, taken from the root's `CachedExpressionData.PropertyConnectedMask` and mapped to UE 5.8 `EMaterialProperty` names
- `referencedTextures`
- `approx`

**Where the values come from:**

- **Instances:**
  - `ScalarParameterValues`, `VectorParameterValues` and `TextureParameterValues`
  - `StaticParametersRuntime.StaticSwitchParameters`
  - `BasePropertyOverrides`
- **Root UMaterials:** a cooked material has no expression graph. What it does keep is `CachedExpressionData`:
  - Parameter names per type are in `RuntimeEntries[EMaterialParameterType].ParameterInfoSet` (types: 0 Scalar, 1 Vector, 3 Texture, 8 StaticSwitch).
  - Default values are in `ScalarValues`, `VectorValues`, `TextureValues` and `StaticSwitchValues`, in the same order.
  - `BlendMode`, `ShadingModel`, `TwoSided` and `OpacityMaskClipValue` are ordinary properties.

**Parameter names `approx` keys on.** `approx.keys` records which parameter was used for each field. First match wins:

- **baseColor (vector):** `BaseColor`/`Base Color`, `Albedo`/`Diffuse`, `Color`, `Tint`, `*Glass Color*`. Names containing emissive, fresnel, edge, outline, light, grunge, highlight, angle, secondary, direction, noise or blend are skipped.
- **metallic:** `Metallic`, `Metal`.
- **roughness:** `Roughness`, then `RoughnessMin`/`Roughness Low`, then any other `*rough*` name. Names with mult, max, high, contrast, offset, grunge, edge, angle or rain are skipped.
- **opacity:** `Opacity`.
- **emissive colour:** `*Emissive*`, `*Glow*`, `Light_Color`.
- **emissive intensity:** `*Emissive Intensity*`, `Light_Emissive_Intensity`, `Intensity`. Emissive in `approx` is colour × intensity, so it can exceed 1 (HDR).
- **textures:**
  - base colour: `Base Color`/`Albedo`/`Diffuse`
  - normal: `Normal`/`Normal Map`
  - ORM: only a parameter whose name has a whole-word token `ORM`, `RMA`, `MRA`, `ARM` or `OcclusionRoughnessMetallic`, and never one with "normal" in it. Otherwise it's null. None of the masters uses these names, so `ormTexture` is null everywhere. An earlier substring match picked up "N**orm**al" by mistake.

If the root's BaseColor pin isn't connected but EmissiveColor is (`M_Emissive_Light`), `approx.baseColor` is black and the colour goes into `approx.emissive`. Anything not found falls back to grey 0.8, roughness 0.6, metallic 0 and opacity 1, or 0.5 for translucent blend modes.

**Results:**

- 116 materials, 111 recovered, 35 with textures.
- Every instance chain resolves.
- Old map files reference `/Game/Art/Materials/Masters/M_BaseSurface_Metal`, which no longer exists. The extractor applies `DefaultEngine.ini`'s `+PackageRedirects` and reports the new path as `redirectedTo`.
- **Not recovered (5):**
  - `/Engine/EngineMaterials/DefaultMaterial`, `/Engine/EngineMaterials/WorldGridMaterial`
  - `M_AirventBlock`, `M_AJ_LandRay`, `M_Metal_Steel`

  These are root materials with zero parameters; their look is built from constants inside the graph, which isn't cooked. Each still has `referencedTextures`, and `recovered: false`.
- `approx` ignores UV tiling and world-aligned or triplanar mapping. Masters such as `M_Env_Material_Default` and `M_SmartMat` use world-space UVs, so textures on mesh UVs won't line up with the game. Flat colour is the reliable part.

**The Paint picker (`paint`).** The level editor's Paint panel (`UI/Details/Material/WBP_CustomizeMaterial`, one row per mesh slot) offers a finish dropdown and a row of colour swatches. Its data:

- `UI/Data/MaterialSelection/MaterialCategories_Library` (a `PDA_MaterialCategories`) lists the finishes in order. Each one is a `PDA_MaterialCategory` under `/Game/Art/DataAssets/BallestMaterials/`.
- Each category's `ColorMaterialMap` maps an `EBallestMaterialColors` value to a material. `MaterialCategory` is an `EBallestMaterialCategories` value; `MaterialCategory_Smooth` leaves it unset, so it takes the first enumerator, `smooth`. `ColorColorMap` sets an explicit swatch colour, and only `special` uses it.
- Category and colour names are the enums' display names. The `*_Dark` materials are listed as "Black". `MaterialName` says "emmissive", so the extractor uses the enum's name instead.

`run.sh` dumps both directories to `paint-dump.json`. `build-materials.mjs` adds the picker's materials to the list and writes `paint: [{ name, colors: [{ color, material, displayColor? }] }]`, with `material` class-qualified the way map files store it. That's 7 finishes and 66 materials: smooth, rough, glossy, concrete, tiled and emissive in 10 colours each (White, Black, Red, Orange, Yellow, Lime, Blue, SkyBlue, Purple, Wine), and special in 5 (Aluminum, Copper, Iron, Concrete, Grey = `MI_Pipes`). The swatches' preview textures (`ColorPreviewTextureMap`) are empty in the cooked assets.

**Usmap patches (`Program.cs`):** found by diffing against the 5.8.0-release headers.

- `MaterialInstance`: drop `ToonProfileParameterValues`.
- `Material`: drop `bEnableNewHLSLGeneratorOverridden`, `bMaterialTranslatorProfileOverridden` and `MaterialTranslatorProfile`.
- `MaterialCachedExpressionData`: drop `ToonProfileValues`, and change `RuntimeEntries[11]` to `[10]` (`NumMaterialRuntimeParameterTypes` is 10 in 5.8).
- Matching, no patch needed: `MaterialInterface`, `MaterialInstanceConstant`, `MaterialInstanceBasePropertyOverrides`, `Texture`, `Texture2D`, `StreamableRenderAsset`, `StaticParameterSetRuntimeData`, `MaterialCachedParameterEntry`.

What each failure looked like without the patches:

- Every MI: `Failed to read ... UserSceneTextureOverrides ---> ArrayProperty element count 34210320 is larger than the remaining archive size`.
- Masters: `MaterialCachedParameterEntry: Unknown property with value 178`.

## registry.json (which pieces exist)

`BallestExtract imports` reads only package headers, so it needs no property mappings. For every package under `/Game` (2834 of them) it records four things:

- the resolved import table
- the imported packages
- the exports, with class and super
- every name-map entry that is an object path

The name map matters because soft references (`TSoftClassPtr`, `FSoftObjectPath`) live there, not in the import table.

`build-registry.mjs` combines that with a property dump of the content-browser data:

- **`levelEditorItems`:** 201 Blueprint classes whose parent chain reaches `BP_BaseItem`. The native root is `/Script/SKGGizmo.SKGMLEEditorItem`. For each one it gives:
  - the parent chain
  - `inPalette`
  - `inRecipeRegistry`
  - `seenInSamples`
  - `referencedBy` (other packages, such as cooked maps, that reference it)
- **`palette`:** what the in-game item browser shows: `UI/Data/ContentBrowser/DT_MapItems`, a DataTable of `S_ItemData {Category, DataAsset}`. Each row points to a `PDA_MapItem` data asset with `Items[] {Name, Thumbnail, Class}`. Both are Blueprint-defined, so they parse fully.
  - 11 categories, 100 items: Ramps 30, Tracks 32, Pipes 8, Props 5, Scenery 1, Misc 4, Shapes 5, Special 5, Bowls 7, Objectives 2, Decals 1.
  - No `PDA_MapItem` asset exists outside the table.
  - All 91 sampled classes are in the palette except `MP_PlayerStart`, which isn't in the palette (it is required in every map).
- **`recipeRegistry`:** `/Game/LevelEditor/Playback/DA_UGCPlaybackRecipeRegistry` is a native `BallestUGCPlaybackRecipeRegistry`. Its properties fail with `Missing prop mappings for type BallestUGCPlaybackRecipeRegistry`, so the per-class recipe data can't be read. Its name map still lists the classes it references: 200 of the 201 items. The one it lacks is `ExampleObjects/RandomObjects/BP_TwoCubeTwoColor_2`.
- **`candidates`:** the classes the coordinator asked about, each with in-registry, in-palette, is-item and parent chain.

**"Hidden" pieces:** 100 item classes are in the recipe registry but not in the palette. Examples:

- the lights: `MP_Raw*Light`, `MP_*LightFixture`, `MP_LightCard_01..04`
- boosters, pinball parts, `BP_CircularFlexiblePlatform`, `BP_UGCShapeDecal`, `MP_CheckpointStrip`, `MP_ActualCheckpoint_Disc`
- `BP_Bowl_Shallow`, `MP_Airvents`
- several `Bevel_*` pieces

They are real level-editor items the game can spawn from a map file, but the browser doesn't offer them. `BP_KillZone` is a plain `Actor`, not an item, and is referenced by neither the palette nor the registry.

## What worked

**Route 2: CUE4Parse.** It opens the copied IoStore containers directly with `EGame.GAME_UE5_8`, which exists in CUE4Parse at the pinned rev. It handles TOC v8 / `ReplaceIoChunkHashWithIoHash`, the container header version `SoftPackageReferencesOffset`, and Oodle. `BallestExtract` writes the GLB itself (`cue4/Glb.cs`) instead of using CUE4Parse-Conversion's glTF writer, because that writer converts to Y-up metres (`SwapYZ`, `* 0.01`). None of the meshes is Nanite-only: they all have LOD0 render data.

**Class resolution.** The extractor walks the BP parent chain through `UObject.Super`, which comes from the export map. It collects the `SCS_Node` exports of each package and applies `InheritableComponentHandler` overrides. For property lookups it follows each component template's archetype (`Template`) chain. For all 87 classes whose `Main` has a mesh, the resolved mesh matches the `meshAssetPath` the game wrote into the sample maps.

## What didn't work, and the limits

- **Packages use unversioned properties** (`PKG_Cooked | PKG_UnversionedProperties | PKG_FilterEditorOnly`). Even StaticMesh needs a `.usmap`, because the StaticMesh UPROPERTYs come before the render data. Without one, CUE4Parse refuses to load anything:
  `CUE4Parse.UE4.Exceptions.MappingException: Package has unversioned properties but mapping file is missing, can't serialize`.
  No usmap exists for this game. Making one needs Dumper-7 or UE4SS on Windows. Instead we use Fortnite's, which is an engine superset.
- **Fortnite's usmap is not exactly UE 5.8.** We diffed it against the `5.8.0-release` headers for these types, using the tag `5.8.0-release` on EpicGames/UnrealEngine:
  - `ActorComponent`, `SceneComponent`, `PrimitiveComponent`, `MeshComponent`, `SCS_Node`, `ComponentKey`, `ComponentOverrideRecord`: match.
  - `StaticMeshComponent`: Fortnite has two extra properties, `bOverrideNavAreaClass` and `NavAreaClass`. `Program.cs` (`NotInUe58`) drops them at load time.

  Without that patch, every StaticMeshComponent template fails with `StreamingTextureBuildInfo: Unknown property with value 117. Can't proceed with serialization`. Worse, the inherited SceneComponent values are read 2 slots off without any error: `RelativeScale3D` comes out as `RelativeLocation`. Any new mismatch would show up the same way, so check `usmap-dump` against the headers if you switch to a different usmap.
- **`BlueprintGeneratedClass`/`Class` layouts differ from Fortnite's.** CUE4Parse fails with `Failed to read FPropertyTagType ArrayProperty<ObjectProperty> ComponentTemplates ---> ArrayProperty element count 50331648 is larger than the remaining archive size` (and similar errors on `FieldNotifies`). That means class-level properties such as `SimpleConstructionScript`/`InheritableComponentHandler` can't be read. The pipeline avoids them by finding SCS nodes and ICH records through the package export list. These errors are expected noise in `classes.log`.
- **CDOs and game-native components need the game's own usmap.** This covers:
  - CDO (`Default__*_C`) properties
  - game-native component classes such as `BallVentPhysicsComponent`, `BallGoalCrossingComponent` and `BallestUGCCircuitDecalComponent`, which fail with `Missing prop mappings for type BallVentPhysicsComponent`

  So piece-specific gameplay defaults (vent strength, decal size) are not in the catalog, and the decal piece has no real visual. Native C++ components that aren't overridden in a BP would also be missed. None of the sampled pieces has one.
- **retoc (route 1)** was built from source (rev `885a8da`). The host's rustup has no default toolchain (`error: command failed: 'cargo': No such file or directory`), so it was built with `nix shell nixpkgs#cargo nixpkgs#rustc`. Results:
  - `retoc info` parses the container. Note it reports `container_flags: Compressed | Signed | Indexed`, and there is a `Ballest-Windows.sig`.
  - `retoc to-legacy -f SM_500 /tmp/ballest-paks OUT` converted 14 assets with 0 failures, auto-detecting the version (`--version` only goes up to `UE5_7`).
  - The legacy `.uasset/.uexp` it produces are still unversioned, so a parser and a usmap would still be needed. It isn't part of the pipeline.
- **Materials** are reported as paths only. No textures or material parameters are extracted, and `M_OutlineEdges` sections (for example slot 1 of `SM_500`) are real geometry that the game renders with an edge shader.
