# Map format

What we know about _Ballest of Them All_'s custom map files, found from samples, the pak and the exe from 2026-10-26 on.

Game: Steam app 3339810, Unreal Engine 5.8 (`++UE5+Release-5.8-CL-56702186`), build 0.4.0-playtest. The assets and the 0.4.1 section below are from 0.4.1 (2026-11-02).

## Where files live

| What                 | Windows                                              | Linux (Proton)                                                                                                 | Ext                           |
| -------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Install              | `<library>/steamapps/common/Ballest of Them All`     | same; by default `~/.local/share/Steam/steamapps/common/Ballest of Them All`                                   |                               |
| Maps folder (drafts) | `%LOCALAPPDATA%\Ballest\Saved\UserSavedMaps`         | `<library>/steamapps/compatdata/3339810/pfx/drive_c/users/steamuser/AppData/Local/Ballest/Saved/UserSavedMaps` | `.balledit`                   |
| Published (Workshop) | `<library>/steamapps/workshop/content/3339810/<id>/` | same                                                                                                           | `.ballmap` + `.jpg` thumbnail |
| Prefabs              | `.../Saved/SaveGames/Prefabs/`                       | same                                                                                                           | `.json` (§ Prefab file)       |
| Plugins folder       | `<install>/Ballest/Binaries/Win64/plugins`           | same                                                                                                           | one folder per plugin         |

The install is read-only for us, and samples are copied into `samples/`.

The Proton prefix is `~/.local/share/Steam/steamapps/compatdata/3339810/pfx` in the default library. The file name convention is `Map_LevelEditorMain&<displayName>_<creatorName>.balledit`. The exe has `ListUserSavedMapSubfolders`, so subfolders under `UserSavedMaps` are scanned.

The plugins folder exists once the [plugin manager](https://anythinggoes-ballest.github.io/ballest-plugin-manager/) is installed. The editor plugin lives in `<plugins>/ballest-editor-link/`, and the desktop app's Play writes `play.json` there to ask for a race. That is the one file the editor writes in the install apart from the plugin's own. The [plugin's README](../packages/ballest-editor-link/README.md#playjson) has its format.

## File format

Plain UTF-8 JSON, tab-indented, CRLF line endings, no BOM. `.balledit` and `.ballmap` are the same schema. A `.ballmap` lacks `editorState` and has `bIsBaseItem` true on every item, and in every sample it differs in `metaData` and `systemLevelName` too (below).

```
{
  worldSettings: {
    directionalLight: { timeOfDay: float, brightness: float },
    metaData: [ { title, descriptor } ],            // .balledit: "Foo"/"Bar" or empty; .ballmap: userLevelName/""
    levelData: {
      systemLevelName: "Map_LevelEditorMain",        // .ballmap: "Map_TrackUGCPlayback"
      userLevelName: "<displayName>_<creator>",
      levelDifficulty: "Beginner",                   // EBallgameDifficulty; see "Difficulty and tags"
      levelDescription: "",
      uploaderOnlyLevelPreviewImagePath: "",
      bValidated: bool,                              // true once a validation run has been completed in-game
      mapTags: { gameplayTags: [ { tagName: "UGCTypes.Map" | "MapTags.UGCTags.*" } ] },
      medalTimesByIndex: [ float x4 ] | [0],         // set by validation run
      createdAt: "YYYY.MM.DD-HH.MM.SS",              // UTC; 0.4.1 sets it to the time the map was opened
      creatorName: string,
      levelDisplayName: string,
      levelPublishedFileId: -1 | int
    },
    skylightIntensity: float,                        // optional (older files omit)
    directionalLightAngle: float                     // optional
  },
  items: [ Item ],
  editorState: {                                     // draft-only
    version: 1,
    groups: [ { members: [ itemIndex ], name, frame: { rotation, translation, scale3D } } ],  // frame: the group's gizmo, see "Groups"; no sample has one
    pivots: [ { itemIndex, pivot: { choice: Default|Center|Bottom|Top|Left|Right|Back|Front, localPosition: {x,y,z} } } ],
    bHasCamera, cameraLocation: {x,y,z}, cameraRotation: {pitch,yaw,roll}
  }
}

Item = {
  actorToSpawn: "/Script/Engine.BlueprintGeneratedClass'/Game/.../BP_X.BP_X_C'",
  itemTransform: { rotation: {x,y,z,w} (unit quat), translation: {x,y,z} (cm), scale3D: {x,y,z} },
  meshComponents: [ { meshComponentTag: "SKGMapEditor", meshAssetPath, materials: [ { material, materialIndex } ], materialAssetPaths: [] } ],
  bIsBaseItem: false,                                // true on every item of a .ballmap; see "Load-time validation"
  boolProperties / floatProperties / intProperties / textProperties / nameProperties / stringProperties:
      [ { propertyName, propertyType, currentValue } ]
}
```

Across the 30 samples, `metaData` is `Foo`/`Bar` in 4 drafts, empty in the 7 drafts 0.4.1 saved, and `userLevelName` with an empty descriptor in all 19 `.ballmap` files. `bIsBaseItem` is false on all 500 draft items and true on all 9,517 published ones.

Older maps vary. All 28 items of the Workshop map Roundabout use `meshComponent` (a component path) in place of `meshAssetPath` and `materialAssetPaths`. `meshAssetPath` is empty on 250 items, the air vents and checkpoint strips among them, whose `Main` has no mesh.

Round-trip: `json.dumps(d, indent='\t', ensure_ascii=False)` with `\n` turned into `\r\n` is semantically identical but not byte-identical. UE's writer puts the opening `{` of a nested object on its own line (Allman style), while an array opens on its key's line. The game parses with a generic JSON reader, so whitespace is irrelevant. `apps/web/src/domain/ueJson.ts` matches the layout exactly, which keeps diffs against in-game saves clean.

## Lighting (`worldSettings.directionalLight`, `directionalLightAngle`)

Recovered from the pak's Blueprint bytecode (`W_WorldSettings`, `BP_Sky_Sphere_Stylized`, `BP_BallgameGameInstance.InitUGCSkylight`) and the light actors in `Map_LevelEditorMain`. The in-game World Settings panel has a "lighting" section with three sliders, all on one `SKGMapEditorDirectionalLight`:

| Slider (in-game label) | Field                          | Slider range | What it does                                                                            |
| ---------------------- | ------------------------------ | ------------ | --------------------------------------------------------------------------------------- |
| time of day            | `directionalLight.timeOfDay`   | 0 to 24      | Light pitch = −(t − 6) × 15°: sunrise at 6, overhead at 12, sunset at 18, below at 0/24 |
| sunlight               | `directionalLight.brightness`  | 1.25 to 7    | The light's intensity. New maps save 12, the editor map's light intensity               |
| light rotation         | `directionalLightAngle` (opt.) | −360 to 360  | The light's yaw in degrees (default −20.6474552154541)                                  |

The game's sky light captures the sky alone, but its global illumination and reflections stop at the stadium: from the arena the stands reach about 15° above the horizon, and they and the water are blue-green with almost no red. The renderer's capture holds that colour below that height (`ARENA_RIM`, `ARENA_COLOR` in `domain/sky.ts`), so a face turned from the sun takes the game's blue, and a mirror like the ice reflects the arena near the horizon rather than a bright sky.

The pitch formula is the native `SetWorldTimeOfDay`, which we can't read; it is confirmed by the editor map's light, which sits at pitch −19.495638 for the default time 7.2997093 (and yaw −20.647455, the default angle). The light is 6000 K.

In a race the sun doesn't cross overhead: the light's forward vector keeps its horizontal part on the yaw's side at every hour measured, so 13:00 lights a map as 11:00 does. The game's editor differs: loading a map there sets the yaw to the file's value plus 180, and a save writes that live yaw back, normalised. Before noon each open and save in the game moves `directionalLightAngle` by 180, which is where the `159.3525390625` in some samples comes from; a race reads the file's value as it is, so the race's sun moves too. The slider is direct (set 100, saves 100). Measurements are in [docs/qa/save-roundtrip.md](qa/save-roundtrip.md). The number fields accept values outside the slider ranges, and samples contain brightness 0, 2, 8 and 12.

The sky light is not a control. On load and on every time change the game sets it from the time of day alone: `clamp(t < 12 ? lerp(MinimumFillLight, 3, t/12) : t ≥ 24 ? MinimumFillLight : lerp(3, MinimumFillLight, (t − 12)/12), 1, 3)`. `MinimumFillLight` is a game-instance default we couldn't read. `skylightIntensity` (always 1 in samples) isn't used for this. The stylized sky sphere switches to a night look before 4:00 and after 20:00.

The sky is `BP_Sky_Sphere_Stylized`, a sphere drawn with the unlit `M_Sky_Panning_Clouds_Stylized`. Its `RefreshMaterial` sets the material from the sun: by day (4:00 to 20:00) the horizon and zenith colours are the engine's `C_Sky_Horizon_Color` / `C_Sky_Zenith_Color` curves (each channel clamped to 0 to 1) at the sun height elevation / 90, the horizon falloff is lerp(3, 7, |height|) and the sun brightness 20 (it sets the light to 12 first, so 10 × sky light × 12 always passes the clamp); at night the colours are fixed dark blues, the falloff 0.2 and the stars 25. The material's compiled pixel shader (dumped with `BallestExtract shaders`, read with `dxc -dumpbin`) then outputs `1.5 × (lerp(zenith + stars × "Sun height", horizon, pow(1 − saturate(view.z), falloff)) + sunColor × brightness × saturate(1 − |view · toSun − 1| / 0.0003))`, with panning cloud textures blended over by `saturate(cloud²)`. "Sun height" is |height| below the horizon and 0 above, so stars only show at night. The level's sky light is a real-time capture of this sky. What the game shows of the horizon, which the viewport can't get to from those curves, is in [docs/qa/sky-horizon.md](qa/sky-horizon.md).

The editor approximates all of this in `apps/web/src/domain/sunlight.ts` and `sky.ts`: the sky is drawn without its clouds (their textures aren't served), with procedural stars, and lights the scene as an environment map captured from it.

## Difficulty and tags

The game's publish screen sets a difficulty and Workshop tags. Both end up in `levelData`.

- **Difficulty.** Five levels, from `EBallgameDifficulty` in the exe and the English locres. The names are Beginner, Medium, Advanced, Expert and Baller. Baller shows as a yellow warning sign; the other four show 1 to 4 bars in white, green, blue and red. The tag is `MapTags.UGCTags.Difficulty.<beginner|medium|advanced|expert|baller>`. Every sample has `levelDifficulty: "Beginner"`, even the published ones tagged medium, advanced or expert, so the tag is what the game uses. The editor writes both.
- **Tags.** `MapTags.UGCTags.<Group>.<tag>`, in the screen's groups:
  - Gameplay: balance, climb, downhill, endurance, flow, mini, ninja, out and back, pathfinding, practice, precision, puzzle, RPG, speed, tech, troll.
  - Mood: day, night, sunrise, sunset.
  - Routes: multiple, single, symmetrical.
  - Props: rubber, vents.
- **Map type tag.** Every file with tags lists `UGCTypes.Map`, usually first. Four Workshop samples list it after other tags.
- **Old tags.** Older Workshop maps use an ungrouped form, `MapTags.UGCTags.<tag>`, e.g. `MapTags.UGCTags.expert`. The editor keeps those as they are.
- **No limit found.** Neither the exe nor the locres has a cap on the number of tags. One sample (A08 Lover 3) has 25 tags, including all 16 gameplay tags.
- **Grid height.** The editor keeps it outside the file, in localStorage keyed by `userLevelName`. The file has no field for it, the game validates `editorState`, and its Save drops keys it doesn't know.

## Catalog (from 30 sample maps, 10,017 items)

The samples use 238 distinct `actorToSpawn` classes. The families are `BP_Prim_*` (cube, cylinder, sphere), `BP_Track_*`, `BP_Ramp_*`, `BP_Pipe_*`, `Bevel_*` (~40 pieces), `MP_*` (glass planes, bowls, air vent, cone, torus…), `BP_Checkpoint`, `MP_ActualCheckpoint_Strip`, `MP_PlayerStart` (needed to race, forbidden in prefabs) and `BP_UGCCircuitDecal`. The largest sample has 3,750 items ("Ballest Of The Mall").

About 60 % of mesh components reference `/Game/Maps/_GENERATED/PC/*` (71 meshes exported from there). Most of the rest are under `/Game/Art/GreyBoxing/_GENERATED/PC`, `/Game/LevelEditor/...` and `JacksonMaps`. Materials come from `/Game/Art/Materials/*` (`MI_Env_*`, `M_GlassV2`, …).

Exposed item properties include `Field Magnitude`, `EntryAssistMinSpeed`, `QualifiedAirflowTargetSpeed`, `UpperAirflowMultiplier` (air vent), `DecalWidth/Height/Depth`, `DecalStyle`, `bFacingOnly` (decal). The samples show 54 distinct names.

A class's exposed properties are its CDO's `LevelEditorExposedProperties` (Blueprint variables, so readable from the pak; `catalog.json` `properties`). The game saves every one of them on every item of that class, in that order, split by type into the typed lists (Blueprint `Double`/`Float` → `floatProperties` `"Float"`, `Int` → `intProperties` `"Integer"`, `Bool` → `boolProperties` `"Bool"`). Defaults: air vent 750000 / 800 / 0.25 / 2000; decal 200 × 200 × 100, style 0, `bFacingOnly` true. `LevelEditorHiddenProperties` (the decal's width/height/depth, a rect light's source size) are still saved, just left out of the in-game panel.

Not every class lists them in its CDO. The probe map `samples/UserSavedMaps/...props probe...` (one of each hidden piece with Blueprint variables, loaded and saved in game on 2026-10-28) showed:

- `BP_UGCShapeDecal` (17) and `MP_LightCard_01` to `04` (9, or 10 for card 04) are saved with properties although their CDOs have no exposed list: native code exposes the class's own bool/int/double variables, in declaration order. Their defaults match the CDO values exactly. The shape decal's `LevelEditorHiddenProperties` still applies.
- `MP_LaserTerminal`, `MP_BoostPlatform/Ring/Volume`, `MP_PinballLauncher` and `MP_PinballPaddle` have editable Blueprint variables (laser radii and brightness, `BoostMagnitude`, ...) but are saved with no properties and show none in the in-game panel.
- `DecalStyle` (circuit decal) is a dropdown in game: 0 = Arrow, 1 = scratch marks, 2 = Stripes. A probe with styles 3, 4, 5 and 10 drew all of them as Stripes, and the decal imports exactly three material pairs (`Decal_Arrow`/`M_UGCCircuitArrowFacing`, `MI_DecalTrack_02`/`MI_UGCCircuitTrackFacing`, `D_Strip_Wrap_Straight_Recolor`/`D_Strip_Facing_Straight_Recolor`), so there is no hidden fourth style.
- The shape decal draws one material (`Decal_AnimatedShapes`) whose `ShapeType` and `FillType` are scalar parameters. In game both are sliders. `DecalShapeType` 0 to 4 = square, circle, hexagon, parallelogram, triangle (the slider stops at 4; 5 to 7 draw a triangle); `DecalFillType` 0 = filled, 1 = outline (2 and 3 draw an outline). The panel shows `DecalRed/Green/Blue` as one colour swatch and the hidden width/height/depth as the transform's "scale" row. The labels come from native code (`GetStyleDisplayNames`) and aren't in the pak, the locres or the exe's strings; each style is a pair of decal materials (`BallestUGCCircuitDecalMaterialOption`: `NormalMaterial`, `FacingOnlyMaterial`).
- What the details panel offers isn't in the pak: native code decides it at runtime (`BallestUGCPropertyDisplayLibrary`: `ShouldShowUGCPropertyInLevelEditor`, `GetUGCPropertyDisplayName`, `Configure*PropertySlider`). `tools/extract/panel.json` holds it as measured on 0.4.1, for all 237 classes the game can load, and [docs/qa/exposed-properties.md](qa/exposed-properties.md) has the tables. Every class saves more than its panel shows: every item saves `SurfaceAssignment`, but 41 classes have no Surfaces control, and the decal's size, a light's `LightAttenuationRadius` and a rect light's source size have no row.
- A slider's range is fixed per property, not derived from the value. Typing stops at the slider's ends except on Travel height (10000), a light card's Brightness (100), Near and Intersection Fade Distance (100000) and Density (0.02). Loading is looser: the air vent keeps any value in the file, while the elevator's speed, the decal style, and the paddle's and cylinder's speeds clamp on load and save clamped.
- Two edits change a second property: a spot light's inner cone stops at its outer, and lowering the outer pulls the inner down; setting a shape decal's Emissive above 0 turns `bDecalUseEmissive` on.
- Colours are three float properties holding linear channels (`DecalRed/Green/Blue`, `LightRed/Green/Blue`, `LightColorR/G/B`), shown in game as one swatch. The swatch for (1, 0.1, 0.1) is sRGB (255, 89, 89): 0.1 through the sRGB curve, not 0.1 × 255 = 26.
- In the saved file every item except the two floors sat 170 to 400 cm higher than written (z only; the player start went from 0 to 170). Not yet explained. The probes also showed that z = 0 is under the default map's water: items placed at z ≈ 0 were hidden in it. That may be why the game raised them.

## Materials (the in-game Paint panel)

Each `meshComponents[].materials[]` entry is one UE material slot (`materialIndex`, contiguous from 0, in index order), and `materialAssetPaths`, where present, repeats the same materials as bare object paths in the same order. Every slot of a paintable piece can be repainted independently, including outline strips such as `M_OutlineEdges`. The in-game Paint panel offers 7 finishes (smooth, rough, glossy, concrete, tiled, emissive, special) × colours, which come to 65 material instances, listed in `assets/materials.json` under `paint` (see `tools/extract/README.md`). Maps also carry materials outside that list: catalog defaults (`MI_ArenaOrange2`, `M_BaseSurface_Metal`, …) and older instances (`MI_Env_Smooth_Lime_OLD`). The game keeps them on load and save.

What the panel lists, measured on 0.4.1 for every palette piece ([docs/qa/materials.md](qa/materials.md)):

- **Slots.** One row per slot of the item's one mesh component, numbered from 1, each offering the whole library. No piece narrows the choices (`SetMaterialListFiltered` is empty). Items of the same class are listed and painted together.
- **Pieces that take no paint** (`catalog.json` `paintable` false). The 20 palette pieces whose class sets `bCanChangeMaterial` false (rubber, air vent, glass, the three physics props, objectives, decal, lights, light cards and laser), and every piece outside the palette, since the panel builds no row for a class it can't name from `DT_MapItems`. The panel drops them and keeps the rest of the selection. It is the panel's rule, not the loader's: a map file can paint most of them, and the game draws that, saves it and validates the map (`catalog.json` `offPanelPaint` has the slots). The rest are slots the game overwrites or never draws.
- **Surfaces.** A selection with any item on a surface lists no slots at all. A material painted before the surface was set stays saved, and shows again when the surface is cleared.
- **Picking a finish.** It swaps the slot to the new finish's version of its colour, when there is one, and otherwise paints nothing. A slot not on a picker choice counts as Grey, so `special` paints it `MI_Pipes` and the other finishes leave it.

A material entry at or past the mesh's slot count makes the game discard the whole map, one past the end included, and open an empty one. An empty `materials` list is fine: the game fills in the defaults. The app refuses to save a map with such an entry when the catalog knows the mesh. A physics surface (0.4.1) is separate from the paint: see "0.4.1: surfaces, mirroring, physics props".

## Hard limits (constants recovered from the shipping exe, build 0.4.0-playtest)

Found by locating the `lea` that references each error string and reading the adjacent `cmp` immediate (`/tmp/ballest-re`, objdump).

| Limit                     | Value                                     | Error string                                                  | Code addr   |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------- | ----------- |
| JSON values per file      | **2,000,000** (0.4.1, measured)           | `...exceeds the maximum value count of %lld.`                 | n/a         |
| Characters per file       | **67,108,864** (0.4.1, measured)          | `...exceeds the %d-character safety limit.`                   | n/a         |
| Items per level           | **100,000** (0x186A0)                     | `Serialized level contains more than %d items.`               | 0x1447EEB9D |
| Any JSON array or object  | 100,000 entries (0.4.1, measured)         | `...array with more than %d entries.`                         | 0x1447EE993 |
| JSON string length        | 1,048,576 (0.4.1, measured)               | `...a string longer than %d characters.`                      | 0x144FE1462 |
| JSON nesting              | 64, root at 0 (0.4.1, measured)           | `...exceeds the maximum nesting depth of %d.`                 | 0x144FE0F50 |
| Materials per mesh        | 256 (0.4.1, exe only)                     | `Item %d mesh %d exceeds the %d-entry material safety limit.` | 0x144FE2768 |
| Mesh or material path     | 4,096 (0.4.1, exe only)                   | `Item %d mesh %d asset path is longer than %d characters.`    | 0x144FE22E3 |
| Mesh components per item  | 64                                        | `Item %d contains more than %d saved mesh components.`        | 0x1447EFAFB |
| Properties per typed list | 4,096                                     | `Item %d contains more than %d saved %s properties.`          | 0x1447B665B |
| JSON field-name length    | 4,096                                     | `...oversized field name.`                                    | 0x1447EE8C2 |
| Prefab items              | 2 to 4,096 (0.4.1, measured)              | `Select 2 to 4096 items before saving a prefab.`              | n/a         |
| Workshop `.ballmap` bytes | not recovered (64-bit constant elsewhere) | `...oversized root .ballmap (%lld bytes; maximum %lld)`       | 0x144ECBD1C |

The value and character limits are the ones a big map meets (`docs/qa/budget.md` § The real limits). Every object, array and scalar counts as a value, and every character of the file counts, whitespace and the game's layout included. A real map stops near 46,600 items on characters, and no map gets past 83,331 items on values, so the 100,000-item limit is never the one that binds. Past either, the game drops the map without a message and opens the default new map.

There is no piece budget. Items still carry a `BudgetCost` and `MaximumMapBudget` is still 300, but on 0.4.1 nothing counts the cost or enforces the limit, and the header's bar stays empty (`docs/qa/budget.md`, which has every cost).

The practical ceiling is performance, not the parser. The largest Workshop map seen has 3,750 items, and the game spawns one actor per item (`Ballest.UGC.Playback.ForceFullActors`; spatial bucketing cvars suggest instancing for big maps).

## Which classes the game will spawn (`assets/registry.json`)

The in-game item browser is one table of 14 categories pointing at data assets that list 140 item classes (0.4.1; 0.4.0 had 11 and 100). `DA_UGCPlaybackRecipeRegistry`, the load-time allowlist, references 237 item classes. So 97 classes are in the allowlist but hidden from the in-game browser. Of those, 44 are generated mesh classes (`AJ_*`, `Boolean_*`, `Box_*`, `Cylinder_*`, `Merge_*`, `Mirror_*`) and two are abstract bases (`BP_ActualCheckpointBase`, `BP_PhysicsPropBase`). The rest are spawnable from a map file: point and spot light fixtures, orange sign, boost platform/ring/volume, pinball launcher, circular flexible platform, shape decal, checkpoint strip, shallow bowl, extra bevels, `BP_Prim_Sphere` (in the browser until 0.4.0), and 0.4.1's spinning paddles, surface cubes, moving kill zone and slip platform. 0.4.1 moved the raw lights, light cards, laser and checkpoint disc into the browser, and took `MP_PinballPaddle` out of the game altogether: maps that use it won't load. `BP_KillZone` is not an item class and not in the registry. `MP_PlayerStart` is placed by the editor, not the browser. The registry's per-class recipe data needs the game's own usmap and is still unread ([DRIVER.md](DRIVER.md) § The decompile question has how to get one).

## 0.4.1: surfaces, mirroring, physics props

The 0.4.1 patch ("Fixed-Step Physics & New Track Editor Features", 2026-10-31, plus the 2026-11-01 magnet fixes) added these to the in-game editor. Confirmed against `samples/UserSavedMaps/...new pieces probe...`, a draft saved in game on 2026-11-02 with one probe per feature in a row along +X: an untouched cube; cubes set to magnet, ice, grippy, and magnet then back to none; a cube painted glossy red, then set to ice; a `Bevel_Full_ShortUScoop_L` untouched, with Mirror X, Mirror Y, both, and Mirror X plus grippy; a cube with Mirror X; elevators on each speed (the last with travel height 800); a spinning cylinder untouched and one with Mirror X and spin speed 180; a paddle untouched and one with Mirror X and paddle speed 5; a laser; a Bend F 25 tube; a point light.

- **Item surface.** Saved as an item property, `intProperties` `SurfaceAssignment` (`Integer`): 0 none, 1 magnet, 2 ice, 3 grippy (`EBallestSurfaceAssignment`; its Grass and GrippyCards values aren't in cooked builds). Every item a 0.4.1 game saves carries it, the player start and goal included, after the class's own ints; setting a surface back to none writes 0. A surface doesn't change the item's saved materials (the red cube set to ice still saves `MI_Env_Glossy_Red`); the game draws it with the surface's material (`materials.json` `surfaces`), and so does the editor.
- **Mirroring.** Mirror X and Mirror Y flip an item's geometry along its local x (red) and y (green) axes. They're saved as `boolProperties` `bMirrorX` and `bMirror` (in that list's order: `bMirror`, then `bMirrorX`, after the class's own bools), and the item's transform is saved unchanged. The game bakes mirrored geometry: an item mirrored on one axis saves its `meshAssetPath` as a baked copy under `/Game/LevelEditor/Mirror/Meshes/SM_Mirror_<hash>`, the same copy for Mirror X and Mirror Y; mirrored on both (a half turn about local z) it saves the original mesh. `DA_ItemMirrorCatalog`, which maps meshes to bakes, is a native class the extractor can't read, so `catalog.json` `mirrors` pairs them by geometry (186 of the 193 bakes; most negate local y). Physics props with their own `PhysicsFlip` carry only `bMirrorX`; the probe's mirrored paddle saved a bake with `PhysicsFlip` still false, while the spinning cylinder kept its mesh and swapped its cap to `MI_SpinningCylinderCap_Flipped`. The player start and goal carry neither flag. In the game's panel the two are buttons, Flip X and Flip Y, under the transform: each click toggles every selected item from its own state and shows no state itself. Measured with the driver: Flip Y does nothing to a physics prop, and a checkpoint (`bSupportsMirror` false) keeps the buttons but neither does anything; the player start has no buttons.
- **Draft without `editorState`.** 0.4.0 wrote an empty one. In the game driver's slots 0.4.1 writes none at all, even with pivots set or a group made in that session, so an in-game save deletes them ([docs/qa/save-roundtrip.md](qa/save-roundtrip.md); not confirmed outside a sandboxed copy). The game still loads and uses an `editorState`, and the editor writes one.
- **Physics props** (Special category). Each has CDO-exposed properties (`catalog.json`): Elevator `PhysicsElevatorExtensionLength` (float, 400, "Travel height") and `PhysicsElevatorSpeedTier` (int: 1 Slow (the default), 2 Normal, 3 Fast); Spinning Cylinder `PhysicsFlip` (bool; what the panel's Flip Y button sets on the cylinder and paddle, which have no `bMirror`) and `PhysicsCylinderSpinSpeed` (float, 90, "Spin speed"); Paddle `PhysicsPaddleSpeedMultiplier` (float, 1, "Paddle speed", a slider up to 5) and `PhysicsFlip`. The hidden `BP_SpinningPaddles` has `PhysicsVariantCount` (int, 1, "Paddles / doors"). `BP_PhysicsPaddle` replaces `MP_PinballPaddle`, which the game no longer ships.
- **Lasers** (Hazards). `MP_LaserTerminal`, now drawn with `SM_LaserTerminal_Orbital`, saved with no laser properties of its own.
- **Lights.** The point light now also saves `LightAttenuationRadius` (1000, after `LightBrightness`), and a new one saves `bLightCastsShadows` false. That is a placement rule, not a class default: `BallestUGCLightComponent`'s `bDisableShadowsOnNewPlacement` is set on all five classes with the property (Point, Spot and Rect Lights, and both fixtures), so a light placed from the palette starts with shadows off. A pasted light, or one loaded from a file that leaves the property out, has the class's true, and a loaded value is kept. The catalog holds true; the app's placement (`itemFromPiece`) writes false. The light cards have no such property.

**Which classes carry the native properties.** A class a 0.4.1 save shows keeps exactly the layout the game wrote (`tools/extract/build-catalog.mjs`). Since the palette and hidden probes (`samples/UserSavedMaps`, saved in game on 2026-11-04) that is every class but `MP_PinballPaddle`. On every other class the catalog lists `SurfaceAssignment`, and the mirror flags by the rule above, as `optional`: the game rejects an item with a property its class doesn't have ("Item %d has an invalid transform, unknown property, or incorrect property value type"), and then discards the whole map, while every 0.4.0 map shows it loads items without them. So the editor leaves optional properties out of new items and writes one only when it's set. The dialog that names a map on save warns about items that carry one; Export to game on a map that already has a file doesn't warn. Saves through the game driver confirmed the rule for a ramp, the air vent and the circuit decal. A probe with one of each remaining palette kind (checkpoint disc, shape decal, spot and rect lights, light cards, a track, pipe and bowl) would confirm it for the rest of the palette.

## The level (`Map_LevelEditorMain`)

Maps are edited in `/Game/Maps/LevelEditor/Map_LevelEditorMain`. Published files name `Map_TrackUGCPlayback` as their `systemLevelName`, and we haven't checked how that level differs. The values below are read from the editor level's cooked assets with `BallestExtract probe` (UE cm, world space). The editor's copies of the start, goal, water and kill-zone height are in `apps/web/src/domain/level.ts`, with the start's scale and the goal's rotation and scale in `factory.ts`.

| What                          | Where it comes from                                           | Value                                                |
| ----------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| Player start of a new map     | the level's `MP_PlayerStart` (Main)                           | (−3955, −1785, 8615), scale 0.276538                 |
| Goal of a new map             | the level's `BP_Checkpoint` (Main)                            | (−2790, −1863, 8896), pitch 90°, scale 1.5           |
| Water surface                 | `BP_ArenaPieces.Water_Plane`: flat `SM_WaterTile` × 200       | z = 126.71326, 2 km square centred on (173, −2569)   |
| Kill zone                     | `BP_KillZone`: box extent 32 × (1000, 1000, 0.25)             | z = 92 to 108, 640 m square centred on (−260, −4100) |
| Item placement bounds         | `BP_ItemPlacementBounds` (× 615) with ±50/±150 boundaries     | x −31062…30438, y −34598…26902, z −6569…177931       |
| Arena (stands, seats, floors) | `BP_ArenaPieces` `ArenaBase`/`ArenaFloor*` at z −4232 × 6.875 | a stadium bowl around the water, far from the start  |

There is no floor near the start: the player start floats about 85 m above the water, and the ball spawns on it. Maps built near z = 0 sit under the water (opaque in game, so they look missing) and under the kill zone. Workshop maps do both: most build around the default start, some (Giga Tree, Ballest Of The Mall, Elevation Fight) build at water level. The editor draws the water and puts its grid at the map's player-start height.

On load the game does not move items below the water: the `asdf new not loaded` and `asdf loaded and saved` drafts (an in-game load and save, in the game's `UserSavedMaps`, not in `samples/`) kept all 25 transforms unchanged, down to z = −1213. The `props probe` draft (written with everything near z = 0) came back from the game with its non-floor items 170 to 400 cm higher. Every offset is a multiple of 10 cm, which looks more like moves with the in-game editor's 10 cm snap than physics settling, but that is unconfirmed.

## Load-time validation

Measured on 0.4.1, case by case, in [docs/qa/limits-validation.md](qa/limits-validation.md). A file the game refuses opens a blank map (the level's start and goal under the map's name) with no message, and pressing Save there and accepting the overwrite prompt replaces the file with that blank map. A file it can't list is missing from the Create page.

- Blank map: a rotation outside `abs(1 - abs(q)^2) < 0.01`; a non-finite transform, light value (time, brightness, angle), float property, camera or pivot position; a class that doesn't exist, isn't an actor or is gone from the build; a property its class lacks, in the wrong list, set twice or with no name; a second mesh component on a piece with one; any mesh component on `BP_TwoCubeOneColor`, `BP_TwoCubeTwoColor` or `MP_OrangeSign`, including the two the game saves for each ([docs/qa/exposed-properties.md](qa/exposed-properties.md)); a mesh or material that isn't cooked; a material slot that is negative, repeated or at or past the mesh's slot count (see Materials), or more material paths than slots; `editorState` without `version` 1; a pivot repeated, past the items or with an unknown choice; a group with no members, a member past the items or in two groups, no frame, a non-normalised frame, a frame with a scale axis of 0 or a name that isn't empty or 1 to 64 letters and digits; any limit above.
- Off the Create page: invalid JSON, no `worldSettings`, or a `levelDifficulty` that isn't one of the five names (any case, `EBallgameDifficulty::` allowed; a missing one loads).
- Lost on the next save: an actor class that isn't an editor item (`BP_KillZone`, `StaticMeshActor`). The game spawns it, the editor doesn't list it, and Save leaves it out.
- Loads: a missing field takes its default, including `meshComponents`, property lists, `editorState` and every `worldSettings` field except `levelData.userLevelName`, without which the Create entry opens another map. Unknown keys load and Save drops them. Scale, position, `SurfaceAssignment` and `propertyType` aren't checked, and nothing is clamped to the placement bounds. A group of one and a group with no `name` load ([docs/qa/save-roundtrip.md](qa/save-roundtrip.md)).
- `BP_TwoCubeOneColor`, `BP_TwoCubeTwoColor` and `MP_OrangeSign` load only with `meshComponents: []`, so that is what the app writes for them and any component is refused at Save, Export and Play. The game builds them from the class: they draw, flip and take a surface, and the panel doesn't paint them. Its own Save writes two components back, so a map holding one is discarded the next time it opens after an in-game save. The app can't stop that, so `assets/verified.json` keeps them `rejected`: the palette disables them and the Save dialog refuses them. They are the only classes that save two components, but that isn't shown to be the cause.
- Start and goal: the editor loads a map with any number of either. On its Play button no start gives a timed run with no ball, two starts use the later one, no goal does nothing, and two goals work.
- `bIsBaseItem`: true on every item of a `.ballmap`, false in every draft. A flagged item in a draft is in the world and survives Save, but the editor's piece list leaves it out, so the editor writes false.
- `levelName and username must be strings` is from the exe, about leaderboards or ghosts by its neighbours, and wasn't reached by any probe.
- Prefab: see § Prefab file.

## Game assets

Pak: `Ballest/Content/Paks/Ballest-Windows.{pak,utoc,ucas}`, an IoStore TOC v8 container, Oodle-compressed, signed, indexed, **not encrypted**, 6689 entries. `Paks/~Mods/` exists, so mod paks are loadable. Meshes are extracted with CUE4Parse (`GAME_UE5_8`); see [tools/extract/README.md](../tools/extract/README.md). Even static meshes need a `.usmap` (unversioned properties). The extractor borrows Fortnite's public one, which matches UE 5.8 engine-class layouts. Blueprint component templates and the classes' Blueprint variables parse with it. The game's own C++ components and native classes need the game's own `.usmap`. The plugin manager's `dumptypes` writes one ([DRIVER.md](DRIVER.md) § The decompile question), but the extractor doesn't use it yet.

Note: `itemTransform` in a map file is the piece's **Main component** world transform, not the actor transform (e.g. every AirVent item carries Main's scale 0.75,0.75,1).

In-game console (`ballest.editor.*`): `saveprefab`, `spawnprefab`, `listprefabs`, `deleteprefab`, `pivot`, `surface`.

## Groups (`editorState.groups`)

Measured on 0.4.1 in [docs/qa/groups-prefabs.md](qa/groups-prefabs.md). A group is flat: one list of item indices, no nesting, and an item in one group at most. Selecting any member selects them all, and no route selects one alone.

`frame` is the group's gizmo. Its translation is where the gizmo sits and what the group rotates and scales about, and its rotation and scale are what the details panel shows. Members' transforms stay as saved: loading never applies the frame to them, and an edit moves them by the change from the frame's current value. A frame can sit anywhere and any scale loads, except that a 0 on any axis opens a blank map. `{}` is a frame at the world origin. A scale moves each member along that member's own axes, so it never shears ([docs/qa/gizmo-scale.md](qa/gizmo-scale.md)).

Ctrl+G makes rotation identity, scale 1 and a translation at the centre of the world-aligned box around the members' bounds, which is what the editor should write. A new group's name is empty. Grouping a selection that spans groups makes one flat group with a new frame and no name.

### The editor's projection

The load-time rules are under [Load-time validation](#load-time-validation). The editor keeps its groups in the map's sidecar, nested to any depth ([PROJECTS.md § The files](PROJECTS.md#the-files)), which the game never reads. It makes `groups` from them each time it encodes a `.balledit` (`domain/gameGroups.ts`):

- One game group per outermost tree group with at least one item anywhere under it. A nested group has no game group of its own.
- `members` is every item index under it, flattened and sorted.
- `name` is the group's name, or the prefab's for a prefab instance, reduced to letters and digits, at most 64 of them, or empty when none are left.
- `frame` is what Ctrl+G makes (above), with each member's bounds being its pivot bounds (§ Pivots) under its transform (`domain/itemBounds.ts`). A member with no known bounds counts as its translation, and so does every member while the catalog hasn't loaded.

Going the other way, a map with no sidecar gets one tree group per game group, where its first member is. An unnamed one is called `Group`, and a member the game would refuse is left out.

## Prefab file

`Saved/SaveGames/Prefabs/<name>.json`, written by `saveprefab` from 2 to 4096 selected items. `<name>` is 1 to 64 letters, digits, `_` and `-`. The layout is the map file's: tabs, CRLF, no BOM. Measured on 0.4.1 in [docs/qa/groups-prefabs.md](qa/groups-prefabs.md).

```
{
  format: "BallestPrefab",
  version: 1,
  group: { rotation: [pitch, yaw, roll], scale: [x, y, z], name? },  // the frame's, less its position; name only if the group has one
  items: [ {
    class: "/Game/.../BP_X.BP_X_C",                       // bare class path; the map's wrapped form also loads
    transform: { location: [x, y, z], rotation: [pitch, yaw, roll], scale: [x, y, z] },  // degrees
    properties: { bMirror: false, "Field Magnitude": 750000, SurfaceAssignment: 0 },     // name -> bool or number, one map for every type
    meshes: [ { tag: "SKGMapEditor", mesh: "/Game/.../Box.Box", materials: [ "/Game/.../MI_X.MI_X" ] } ],  // mesh "" where a map writes ""
    paint: { categories: [ "/Game/.../MaterialCategory_Glossy.MaterialCategory_Glossy" | null ], colors: [ 3 ] }  // per slot
  } ]
}
```

Against a map's `Item`: `rotation` is Euler degrees, not a quaternion. `location` is relative, while `rotation` and `scale` stay world values. `materials` are bare paths in slot order, like `materialAssetPaths`, and `paint` has no map field. There is no `bIsBaseItem`, and no join: a joined item saves and spawns free.

`location` is the offset from a point the file doesn't record, in world axes: the frame's translation when the selection is one whole group, otherwise the centre of the selection's bounds. `spawnprefab` picks that point anew, in front of the camera, and the items arrive selected, as one group with `group`'s rotation, scale and name. The game has no record that they came from a prefab, and a save in the game drops the group as it drops every group.

A hand-written file needs `group` with `rotation` and a `scale` with no 0 in it, and `properties` and `meshes` on each item, both of which can be empty. `paint` is optional and wins over `meshes` where it names a category. The game refuses a property the class lacks, a value of the wrong type, a scale of 0, a class that isn't an item, and `MP_PlayerStart`. Unknown keys are ignored.

## Pivots (`editorState.pivots`)

The in-game inspector sets a per-item pivot: Default, Center, Bottom, Top, Left, Right, Back or Front. The gizmo sits on it and rotates and scales the item about it, and the in-game editor's Location field shows it rather than the item's origin. With several items selected, the active item's pivot is the one that counts, for all of them ([docs/qa/gizmo-scale.md](qa/gizmo-scale.md)). `localPosition` is that point in the item's local frame (the Main component, unscaled cm): the centre of the item's local bounds, or the centre of one face of them. Back is +X, Front −X, Right +Y, Left −Y, Top +Z, Bottom −Z. Every pivot in `samples/` matches the catalog's bounds this way (`apps/web/src/domain/pivot.test.ts`). Items without an entry use Default (the origin), and no sample has a Default entry, so the editor drops the entry when a pivot goes back to Default. Entries are sorted by `itemIndex`. A map without `editorState` (an imported `.ballmap`) gets one when a pivot is set or pasted.

Default is the item's origin on every piece: on all 140 palette pieces (0.4.1), loaded or newly placed, the game's gizmo sits on `itemTransform.translation` and turns with the item. Where that origin falls on the mesh varies by piece, but the mesh carries it, so nothing per piece is needed.

The bounds are the Main mesh's, measured through the game's own gizmo, with these exceptions (`MEASURED_BOUNDS` in `pivot.ts`):

| Pieces                                                   | Bounds the game uses                                                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No Main mesh (air vent, checkpoint disc and strip)       | The box around the visible components. A sample's air vent saves Top at z 372.375, the top of its `WindCube`.                                                                      |
| `MP_RawPointLight`, `MP_RawSpotLight`, `MP_RawRectLight` | None: every pivot is the origin.                                                                                                                                                   |
| `BP_UGCCircuitDecal`, `BP_UGCShapeDecal`                 | A unit box, ±0.5, scaled by the decal's size (§ Decals), so a pivot of 50 lands 50 m away.                                                                                         |
| `MP_LaserTerminal`                                       | X −4.6541 to 113, reaching along the beam, whatever blocks it. Measured at scale 1: at other scales the game's box doesn't follow the item's scale (scale 2: Back 213, Top 18.71). |
| `BP_Elevator`                                            | Z −8.9917 to 8.9602, taller than the Main mesh, whatever its travel height.                                                                                                        |
| `BP_Checkpoint`                                          | Moves as the goal animates (Center drifts about 20 cm in X), so no value is exact; the editor keeps the ring's box.                                                                |

Flip X and Flip Y flip these bounds with the mesh, along the same axes (`mirrorScaleOf`).

The game accepts a file's `localPosition` for all of these and puts the gizmo there.

## Decals

A decal (`BP_UGCCircuitDecal`, `BP_UGCShapeDecal`) has no scale of its own. Its `scale3D` stays 1, and the game ignores any other value in a file. Its size is three float properties, in cm, and the game's inspector and gizmo show and change them as the Scale:

| Scale axis | Property      | Default | Limits     |
| ---------- | ------------- | ------- | ---------- |
| X          | `DecalHeight` | 200     | 10 to 2000 |
| Y          | `DecalWidth`  | 200     | 10 to 2000 |
| Z          | `DecalDepth`  | 100     | 10 to 1000 |

An edit outside the limits stops at them, and a negative one at 10. Resizing keeps the pivot in place and moves the item, as scaling any item does: with a Top pivot, a depth of 60 made 160 moves the item 50 cm down. The editor works the same way (`apps/web/src/domain/editTransform.ts`): its gizmo and inspector use the size as the scale, and `setTransforms` writes it back to the properties.

## Elevators

`BP_Elevator`'s scale is the platform's size and nothing else: it doesn't touch `PhysicsElevatorExtensionLength`. The game holds it to these rules, on load and on every edit, and the editor does the same (`apps/web/src/domain/editTransform.ts`):

- X and Y are one size. The edited axis sets it; if both changed, or on load, X does. So (2, 3, 1) from (2, 2, 1) gives (3, 3, 1), and a file's (1, 3, 1) loads as (1, 1, 1).
- Each axis keeps its sign: (−3, 1, 1) gives (−3, 3, 1).
- Z is always 1.
- The size stops at 0.01 and has no upper limit (10⁶ works).

The game keeps the pivot in place for the scale asked for, after the 0.01 limit, and links the axes afterwards without moving the item. So the pivot slides whenever Y follows X, X follows Y or a Z is dropped: with a Right pivot, X 1 to 3 leaves the item where it is and takes the pivot from 150 to 450, and with a Top pivot a Z of 3 moves the item down 17.92 cm though Z stays 1. The editor copies this too. A decal is different: its limits apply before the pivot is kept, so its pivot never slides.
