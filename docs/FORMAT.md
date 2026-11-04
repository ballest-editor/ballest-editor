# Ballest of Them All — custom map format (findings, 2026-10-26)

Game: Steam app 3339810, Unreal Engine 5.8 (`++UE5+Release-5.8-CL-56702186`), build 0.4.0-playtest; the assets and the 0.4.1 section below are from 0.4.1 (2026-11-02).
Install: `~/.local/share/Steam/steamapps/common/Ballest of Them All` (read-only for us; samples copied into `samples/`).

## Where maps live

| What                 | Path                                                                              | Ext                           |
| -------------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| Local drafts         | `<proton pfx>/drive_c/users/steamuser/AppData/Local/Ballest/Saved/UserSavedMaps/` | `.balledit`                   |
| Published (Workshop) | `~/.local/share/Steam/steamapps/workshop/content/3339810/<id>/`                   | `.ballmap` + `.jpg` thumbnail |
| Prefabs              | `.../Saved/SaveGames/Prefabs/`                                                    | JSON (`BallestPrefab` v1)     |

Proton prefix: `~/.local/share/Steam/steamapps/compatdata/3339810/pfx`.
File name convention: `Map_LevelEditorMain&<displayName>_<creatorName>.balledit`.
The exe has `ListUserSavedMapSubfolders`, so subfolders under `UserSavedMaps` are scanned.

## File format

Plain UTF-8 JSON, tab-indented, CRLF line endings, no BOM. `.balledit` and `.ballmap` are the same schema; `.ballmap` lacks `editorState`.

```
{
  worldSettings: {
    directionalLight: { timeOfDay: float, brightness: float },
    metaData: [ { title, descriptor } ],            // always "Foo"/"Bar" — unused placeholder
    levelData: {
      systemLevelName: "Map_LevelEditorMain",
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
    groups: [ { members: [ itemIndex ], name, frame: { rotation, translation, scale3D } } ],  // the shape the game loads; no sample has one
    pivots: [ { itemIndex, pivot: { choice: Default|Center|Bottom|Top|Left|Right|Back|Front, localPosition: {x,y,z} } } ],
    bHasCamera, cameraLocation: {x,y,z}, cameraRotation: {pitch,yaw,roll}
  }
}

Item = {
  actorToSpawn: "/Script/Engine.BlueprintGeneratedClass'/Game/.../BP_X.BP_X_C'",
  itemTransform: { rotation: {x,y,z,w} (unit quat), translation: {x,y,z} (cm), scale3D: {x,y,z} },
  meshComponents: [ { meshComponentTag: "SKGMapEditor", meshAssetPath, materials: [ { material, materialIndex } ], materialAssetPaths: [] } ],
  bIsBaseItem: false,
  boolProperties / floatProperties / intProperties / textProperties / nameProperties / stringProperties:
      [ { propertyName, propertyType, currentValue } ]
}
```

Round-trip: `json.dumps(d, indent='\t', ensure_ascii=False)` with `\n` → `\r\n` is semantically identical but not byte-identical — UE's writer puts the opening `{`/`[` of nested values on its own line (Allman style). The game parses with a generic JSON reader, so whitespace is irrelevant; a custom writer can match it exactly if we ever want clean diffs against in-game saves.

## Lighting (`worldSettings.directionalLight`, `directionalLightAngle`)

Recovered from the pak's Blueprint bytecode (`W_WorldSettings`, `BP_Sky_Sphere_Stylized`, `BP_BallgameGameInstance.InitUGCSkylight`) and the light actors in `Map_LevelEditorMain`. The in-game World Settings panel has a "lighting" section with three sliders, all on one `SKGMapEditorDirectionalLight`:

| Slider (in-game label) | Field                          | Slider range | What it does                                                                            |
| ---------------------- | ------------------------------ | ------------ | --------------------------------------------------------------------------------------- |
| time of day            | `directionalLight.timeOfDay`   | 0–24         | Light pitch = −(t − 6) × 15°: sunrise at 6, overhead at 12, sunset at 18, below at 0/24 |
| sunlight               | `directionalLight.brightness`  | 1.25–7       | The light's intensity. New maps save 12, the editor map's light intensity               |
| light rotation         | `directionalLightAngle` (opt.) | −360–360     | The light's yaw in degrees (default −20.6474552154541)                                  |

The pitch formula is the native `SetWorldTimeOfDay`, which we can't read; it is confirmed by the editor map's light, which sits at pitch −19.495638 for the default time 7.2997093 (and yaw −20.647455, the default angle). The light is 6000 K.

In a race the sun doesn't cross overhead: the light's forward vector keeps its horizontal part on the yaw's side at every hour measured, so 13:00 lights a map as 11:00 does. The game's editor differs: loading a map there sets the yaw to the file's value plus 180, and a save writes that live yaw back, normalised. Before noon each open and save in the game moves `directionalLightAngle` by 180, which is where the `159.3525390625` in some samples comes from; a race reads the file's value as it is, so the race's sun moves too. The slider is direct (set 100, saves 100). Measurements are in [docs/qa/save-roundtrip.md](qa/save-roundtrip.md). The number fields accept values outside the slider ranges, and samples contain brightness 0, 2, 8 and 12.

The sky light is not a control. On load and on every time change the game sets it from the time of day alone: `clamp(t < 12 ? lerp(MinimumFillLight, 3, t/12) : t ≥ 24 ? MinimumFillLight : lerp(3, MinimumFillLight, (t − 12)/12), 1, 3)`. `MinimumFillLight` is a game-instance default we couldn't read. `skylightIntensity` (always 1 in samples) isn't used for this. The stylized sky sphere switches to a night look before 4:00 and after 20:00.

The sky is `BP_Sky_Sphere_Stylized`, a sphere drawn with the unlit `M_Sky_Panning_Clouds_Stylized`. Its `RefreshMaterial` sets the material from the sun: by day (4:00 to 20:00) the horizon and zenith colours are the engine's `C_Sky_Horizon_Color` / `C_Sky_Zenith_Color` curves (each channel clamped to 0–1) at the sun height elevation / 90, the horizon falloff is lerp(3, 7, |height|) and the sun brightness 20 (it sets the light to 12 first, so 10 × sky light × 12 always passes the clamp); at night the colours are fixed dark blues, the falloff 0.2 and the stars 25. The material's compiled pixel shader (dumped with `BallestExtract shaders`, read with `dxc -dumpbin`) then outputs `1.5 × (lerp(zenith + stars × "Sun height", horizon, pow(1 − saturate(view.z), falloff)) + sunColor × brightness × saturate(1 − |view · toSun − 1| / 0.0003))`, with panning cloud textures blended over by `saturate(cloud²)`. "Sun height" is |height| below the horizon and 0 above, so stars only show at night. The level's sky light is a real-time capture of this sky.

The editor approximates all of this in `apps/web/src/domain/sunlight.ts` and `sky.ts`: the sky is drawn without its clouds (their textures aren't served), with procedural stars, and lights the scene as an environment map captured from it.

## Difficulty and tags

The game's publish screen sets a difficulty and Workshop tags. Both end up in `levelData`.

- **Difficulty:** five levels, from `EBallgameDifficulty` in the exe and the English locres. The names are Beginner, Medium, Advanced, Expert and Baller. Baller shows as a yellow warning sign; the other four show 1–4 bars in white, green, blue and red. The tag is `MapTags.UGCTags.Difficulty.<beginner|medium|advanced|expert|baller>`. Every sample has `levelDifficulty: "Beginner"`, even the published ones tagged medium, advanced or expert, so the tag is what the game uses. The editor writes both.
- **Tags:** `MapTags.UGCTags.<Group>.<tag>`, in the screen's groups:
  - Gameplay: balance, climb, downhill, endurance, flow, mini, ninja, out and back, pathfinding, practice, precision, puzzle, RPG, speed, tech, troll.
  - Mood: day, night, sunrise, sunset.
  - Routes: multiple, single, symmetrical.
  - Props: rubber, vents.
- **Map type tag:** every file with tags lists `UGCTypes.Map` first.
- **Old tags:** older Workshop maps use an ungrouped form, `MapTags.UGCTags.<tag>`, e.g. `MapTags.UGCTags.expert`. The editor keeps those as they are.
- **No limit found:** neither the exe nor the locres has a cap on the number of tags. One sample (A08 Lover 3) has 25 tags, including all 16 gameplay tags.
- **Grid height:** the editor keeps it outside the file, in localStorage keyed by `userLevelName`. The file has no field for it, and the game validates `editorState` and rewrites it on every save.

## Catalog (from 22 sample maps, 9.9k items)

91 distinct `actorToSpawn` classes so far — families: `BP_Prim_*` (cube/cylinder/sphere), `BP_Track_*`, `BP_Ramp_*`, `BP_Pipe_*`, `Bevel_*` (~40 pieces), `MP_*` (glass planes, bowls, air vent, cone, torus…), `BP_Checkpoint`, `MP_ActualCheckpoint_Strip`, `MP_PlayerStart` (required, forbidden in prefabs), `BP_UGCCircuitDecal`.
Mesh assets referenced from `/Game/Maps/_GENERATED/PC/*` (79 in the pak), materials from `/Game/Art/Materials/*` (`MI_Env_*`, `M_GlassV2`, …).
Exposed item properties seen: `Field Magnitude`, `EntryAssistMinSpeed`, `QualifiedAirflowTargetSpeed`, `UpperAirflowMultiplier` (air vent), `DecalWidth/Height/Depth`, `DecalStyle`, `bFacingOnly` (decal).
A class's exposed properties are its CDO's `LevelEditorExposedProperties` (Blueprint variables, so readable from the pak; `catalog.json` `properties`). The game saves every one of them on every item of that class, in that order, split by type into the typed lists (Blueprint `Double`/`Float` → `floatProperties` `"Float"`, `Int` → `intProperties` `"Integer"`, `Bool` → `boolProperties` `"Bool"`). Defaults: air vent 750000 / 800 / 0.25 / 2000; decal 200 × 200 × 100, style 0, `bFacingOnly` true. `LevelEditorHiddenProperties` (the decal's width/height/depth, a rect light's source size) are still saved, just left out of the in-game panel.

Not every class lists them in its CDO. The probe map `samples/UserSavedMaps/...props probe...` (one of each hidden piece with Blueprint variables, loaded and saved in game on 2026-10-28) showed:

- `BP_UGCShapeDecal` (17) and `MP_LightCard_01`–`04` (9, or 10 for card 04) are saved with properties although their CDOs have no exposed list: native code exposes the class's own bool/int/double variables, in declaration order. Their defaults match the CDO values exactly. The shape decal's `LevelEditorHiddenProperties` still applies.
- `MP_LaserTerminal`, `MP_BoostPlatform/Ring/Volume`, `MP_PinballLauncher` and `MP_PinballPaddle` have editable Blueprint variables (laser radii and brightness, `BoostMagnitude`, ...) but are saved with no properties and show none in the in-game panel.
- `DecalStyle` (circuit decal) is a dropdown in game: 0 = Arrow, 1 = scratch marks, 2 = Stripes. A probe with styles 3, 4, 5 and 10 drew all of them as Stripes, and the decal imports exactly three material pairs (`Decal_Arrow`/`M_UGCCircuitArrowFacing`, `MI_DecalTrack_02`/`MI_UGCCircuitTrackFacing`, `D_Strip_Wrap_Straight_Recolor`/`D_Strip_Facing_Straight_Recolor`), so there is no hidden fourth style.
- The shape decal draws one material (`Decal_AnimatedShapes`) whose `ShapeType` and `FillType` are scalar parameters. In game both are sliders. `DecalShapeType` 0–4 = square, circle, hexagon, parallelogram, triangle (the slider stops at 4; 5–7 draw a triangle); `DecalFillType` 0 = filled, 1 = outline (2 and 3 draw an outline). The panel shows `DecalRed/Green/Blue` as one colour swatch and the hidden width/height/depth as the transform's "scale" row. The labels come from native code (`GetStyleDisplayNames`) and aren't in the pak, the locres or the exe's strings; each style is a pair of decal materials (`BallestUGCCircuitDecalMaterialOption`: `NormalMaterial`, `FacingOnlyMaterial`).
- Colours are three float properties holding linear channels (`DecalRed/Green/Blue`, `LightRed/Green/Blue`, `LightColorR/G/B`), shown in game as one swatch. The swatch for (1, 0.1, 0.1) is sRGB (255, 89, 89): 0.1 through the sRGB curve, not 0.1 × 255 = 26.
- In the saved file every item except the two floors sat 170–400 cm higher than written (z only; the player start went from 0 to 170). Not yet explained. The probes also showed that z = 0 is under the default map's water: items placed at z ≈ 0 were hidden in it. That may be why the game raised them.
  Largest sample: 3750 items ("Ballest Of The Mall").

## Materials (the in-game Paint panel)

Each `meshComponents[].materials[]` entry is one UE material slot (`materialIndex`, contiguous from 0, in index order), and `materialAssetPaths` repeats the same materials as bare object paths in the same order. Every slot of a paintable piece can be repainted independently, including outline strips such as `M_OutlineEdges`. The in-game Paint panel offers 7 finishes (smooth, rough, glossy, concrete, tiled, emissive, special) × colours, which come to 65 material instances, listed in `assets/materials.json` under `paint` (see `tools/extract/README.md`). Maps also carry materials outside that list: catalog defaults (`MI_ArenaOrange2`, `M_BaseSurface_Metal`, …) and older instances (`MI_Env_Smooth_Lime_OLD`). The game keeps them on load and save.

What the panel lists, measured on 0.4.1 for every palette piece ([docs/qa/materials.md](qa/materials.md)):

- **Slots:** one row per slot of the item's one mesh component, numbered from 1, each offering the whole library. No piece narrows the choices (`SetMaterialListFiltered` is empty). Items of the same class are listed and painted together.
- **Pieces that take no paint** (`catalog.json` `paintable` false): the 20 palette pieces whose class sets `bCanChangeMaterial` false (rubber, air vent, glass, the three physics props, objectives, decal, lights, light cards and laser), and every piece outside the palette, since the panel builds no row for a class it can't name from `DT_MapItems`. The panel drops them and keeps the rest of the selection. It is the panel's rule, not the loader's: a map file can paint most of them, and the game draws that, saves it and validates the map (`catalog.json` `offPanelPaint` has the slots). The rest are slots the game overwrites or never draws.
- **Surfaces:** a selection with any item on a surface lists no slots at all. A material painted before the surface was set stays saved, and shows again when the surface is cleared.
- **Picking a finish** swaps the slot to the new finish's version of its colour, when there is one, and otherwise paints nothing. A slot not on a picker choice counts as Grey, so `special` paints it `MI_Pipes` and the other finishes leave it.

A material entry at or past the mesh's slot count makes the game discard the whole map, one past the end included, and open an empty one. An empty `materials` list is fine: the game fills in the defaults. The app refuses to save a map with such an entry when the catalog knows the mesh. A physics surface (0.4.1) is separate from the paint: see "0.4.1: surfaces, mirroring, physics props".

## Hard limits (constants recovered from the shipping exe, build 0.4.0-playtest)

Found by locating the `lea` that references each error string and reading the adjacent `cmp` immediate (`/tmp/ballest-re`, objdump).

| Limit                     | Value                                     | Error string                                            | Code addr   |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------- | ----------- |
| Items per level           | **100,000** (0x186A0)                     | `Serialized level contains more than %d items.`         | 0x1447EEB9D |
| Any JSON array length     | 100,000                                   | `...array with more than %d entries.`                   | 0x1447EE993 |
| Mesh components per item  | 64                                        | `Item %d contains more than %d saved mesh components.`  | 0x1447EFAFB |
| Properties per typed list | 4,096                                     | `Item %d contains more than %d saved %s properties.`    | 0x1447B665B |
| JSON field-name length    | 4,096                                     | `...oversized field name.`                              | 0x1447EE8C2 |
| Prefab items              | 2–4,096                                   | string                                                  | —           |
| Workshop `.ballmap` bytes | not recovered (64-bit constant elsewhere) | `...oversized root .ballmap (%lld bytes; maximum %lld)` | 0x144ECBD1C |

Practical ceiling is performance, not the parser: largest Workshop map seen is 3,750 items; the game spawns one actor per item (`Ballest.UGC.Playback.ForceFullActors`, spatial bucketing cvars suggest instancing for big maps).

## Which classes the game will spawn (`assets/registry.json`)

The in-game item browser is one table of 14 categories → data assets listing **140** item classes (0.4.1; 0.4.0 had 11 and 100). `DA_UGCPlaybackRecipeRegistry` (the load-time allowlist) references **237** item classes. So 97 classes are spawnable from a map file but hidden from the in-game browser: point and spot light fixtures, orange sign, boost platform/ring/volume, pinball launcher, circular flexible platform, shape decal, checkpoint strip, shallow bowl, extra bevels, `BP_Prim_Sphere` (in the browser until 0.4.0), and 0.4.1's spinning paddles, surface cubes, moving kill zone and slip platform. 0.4.1 moved the raw lights, light cards, laser and checkpoint disc into the browser, and took `MP_PinballPaddle` out of the game altogether: maps that use it won't load. `BP_KillZone` is not an item class and not in the registry. `MP_PlayerStart` is placed by the editor, not the browser. The registry's per-class recipe data needs the game's own usmap and is unread.

## 0.4.1: surfaces, mirroring, physics props

The 0.4.1 patch ("Fixed-Step Physics & New Track Editor Features", 2026-10-31, plus the 2026-11-01 magnet fixes) added these to the level editor. Confirmed against `samples/UserSavedMaps/...new pieces probe...`, a draft saved in game on 2026-11-02 with one probe per feature in a row along +X: an untouched cube; cubes set to magnet, ice, grippy, and magnet then back to none; a cube painted glossy red, then set to ice; a `Bevel_Full_ShortUScoop_L` untouched, with Mirror X, Mirror Y, both, and Mirror X plus grippy; a cube with Mirror X; elevators on each speed (the last with travel height 800); a spinning cylinder untouched and one with Mirror X and spin speed 180; a paddle untouched and one with Mirror X and paddle speed 5; a laser; a Bend F 25 tube; a point light.

- **Item surface:** saved as an item property, `intProperties` `SurfaceAssignment` (`Integer`): 0 none, 1 magnet, 2 ice, 3 grippy (`EBallestSurfaceAssignment`; its Grass and GrippyCards values aren't in cooked builds). Every item a 0.4.1 game saves carries it, the player start and goal included, after the class's own ints; setting a surface back to none writes 0. A surface doesn't change the item's saved materials (the red cube set to ice still saves `MI_Env_Glossy_Red`); the game draws it with the surface's material (`materials.json` `surfaces`), and so does the editor.
- **Mirroring:** Mirror X and Mirror Y flip an item's geometry along its local x (red) and y (green) axes. They're saved as `boolProperties` `bMirrorX` and `bMirror` (in that list's order: `bMirror`, then `bMirrorX`, after the class's own bools), and the item's transform is saved unchanged. The game bakes mirrored geometry: an item mirrored on one axis saves its `meshAssetPath` as a baked copy under `/Game/LevelEditor/Mirror/Meshes/SM_Mirror_<hash>`, the same copy for Mirror X and Mirror Y; mirrored on both (a half turn about local z) it saves the original mesh. `DA_ItemMirrorCatalog`, which maps meshes to bakes, is a native class the extractor can't read, so `catalog.json` `mirrors` pairs them by geometry (186 of the 193 bakes; most negate local y). Physics props with their own `PhysicsFlip` carry only `bMirrorX`; the probe's mirrored paddle saved a bake with `PhysicsFlip` still false, while the spinning cylinder kept its mesh and swapped its cap to `MI_SpinningCylinderCap_Flipped`. The player start and goal carry neither flag. In the game's panel the two are buttons, Flip X and Flip Y, under the transform: each click toggles every selected item from its own state and shows no state itself. Measured with the driver: Flip Y does nothing to a physics prop, and a checkpoint (`bSupportsMirror` false) keeps the buttons but neither does anything; the player start has no buttons.
- **Draft without `editorState`:** 0.4.0 wrote an empty one. In the game driver's slots 0.4.1 writes none at all, even with pivots set or a group made in that session, so an in-game save deletes them (docs/qa/save-roundtrip.md; not confirmed outside a sandboxed copy). The game still loads and uses an `editorState`, and the editor writes one.
- **Physics props** (Special category), each with CDO-exposed properties (`catalog.json`): Elevator `PhysicsElevatorExtensionLength` (float, 400, "Travel height") and `PhysicsElevatorSpeedTier` (int: 1 Slow (the default), 2 Normal, 3 Fast); Spinning Cylinder `PhysicsFlip` (bool; not shown in the game's panel) and `PhysicsCylinderSpinSpeed` (float, 90, "Spin speed"); Paddle `PhysicsPaddleSpeedMultiplier` (float, 1, "Paddle speed", a slider up to 5) and `PhysicsFlip`. The hidden `BP_SpinningPaddles` has `PhysicsVariantCount` (int, 1, "Paddles / doors"). `BP_PhysicsPaddle` replaces `MP_PinballPaddle`, which the game no longer ships.
- **Lasers** (Hazards): `MP_LaserTerminal`, now drawn with `SM_LaserTerminal_Orbital`, saved with no laser properties of its own.
- **Lights:** the point light now also saves `LightAttenuationRadius` (1000, after `LightBrightness`), and an untouched one saves `bLightCastsShadows` false; its Blueprint still says true. The spot and rect lights haven't been probed in 0.4.1, so the catalog keeps their 0.4.0 layout.

**Which classes carry the native properties.** A class a 0.4.1 save shows keeps exactly the layout the game wrote (`tools/extract/build-catalog.mjs`). On every other class the catalog lists `SurfaceAssignment`, and the mirror flags by the rule above, as `optional`: the game rejects an item with a property its class doesn't have ("Item %d has an invalid transform, unknown property, or incorrect property value type"), and then discards the whole map, while every 0.4.0 map shows it loads items without them. So the editor leaves optional properties out of new items, writes one only when it's set, and Export warns about items that carry one. Saves through the game driver confirmed the rule for a ramp, the air vent and the circuit decal. A probe with one of each remaining palette kind (checkpoint disc, shape decal, spot and rect lights, light cards, a track, pipe and bowl) would confirm it for the rest of the palette.

## The level (`Map_LevelEditorMain`)

Every map is spawned into `/Game/Maps/LevelEditor/Map_LevelEditorMain`. Read from its cooked assets with `BallestExtract probe` (UE cm, world space). The editor's copies are in `apps/web/src/domain/level.ts`.

| What                          | Where it comes from                                           | Value                                               |
| ----------------------------- | ------------------------------------------------------------- | --------------------------------------------------- |
| Player start of a new map     | the level's `MP_PlayerStart` (Main)                           | (−3955, −1785, 8615), scale 0.276538                |
| Goal of a new map             | the level's `BP_Checkpoint` (Main)                            | (−2790, −1863, 8896), pitch 90°, scale 1.5          |
| Water surface                 | `BP_ArenaPieces.Water_Plane`: flat `SM_WaterTile` × 200       | z = 126.71326, 2 km square centred on (173, −2569)  |
| Kill zone                     | `BP_KillZone`: box extent 32 × (1000, 1000, 0.25)             | z = 92–108, 640 m square centred on (−260, −4100)   |
| Item placement bounds         | `BP_ItemPlacementBounds` (× 615) with ±50/±150 boundaries     | x −31062…30438, y −34598…26902, z −6569…177931      |
| Arena (stands, seats, floors) | `BP_ArenaPieces` `ArenaBase`/`ArenaFloor*` at z −4232 × 6.875 | a stadium bowl around the water, far from the start |

There is no floor near the start: the player start floats about 85 m above the water, and the ball spawns on it. Maps built near z = 0 sit under the water (opaque in game, so they look missing) and under the kill zone. Workshop maps do both: most build around the default start, some (Giga Tree, Ballest Of The Mall, Elevation Fight) build at water level. The editor draws the water and puts its grid at the map's player-start height.

On load the game does not move items below the water: the `asdf new not loaded` → `asdf loaded and saved` drafts (an in-game load and save, in the game's `UserSavedMaps`, not in `samples/`) kept all 25 transforms unchanged, down to z = −1213. The `props probe` draft (written with everything near z = 0) came back from the game with its non-floor items 170–400 cm higher. Every offset is a multiple of 10 cm, which looks more like moves with the in-game editor's 10 cm snap than physics settling, but that is unconfirmed.

## Load-time validation (from exe strings)

- transform must be finite, rotation normalized
- unknown property name / wrong type → item rejected
- per-mesh material slot safety limit: a `materialIndex` at or past the mesh's slot count (measured, see Materials)
- `Serialized level JSON contains an invalid or oversized object`
- `levelName and username must be strings`; display-name text limit 4096
- editor metadata (groups, pivots) validated separately. Any of these discards the whole map and opens a blank one with no message: a pivot or group member past the last item, an empty group, an item in two groups, a group with no `frame`. A group of one and a group with no `name` load (measured, docs/qa/save-roundtrip.md)
- prefab: 2–4096 items, no `MP_PlayerStart`

## Game assets

Pak: `Ballest/Content/Paks/Ballest-Windows.{pak,utoc,ucas}` — IoStore TOC v8, Oodle-compressed, signed, indexed, **not encrypted**, 6689 entries. `Paks/~Mods/` exists (mod paks are loadable). Meshes are extracted with CUE4Parse (`GAME_UE5_8`) via `nix run .#extract` — see `tools/extract/README.md`. Even static meshes need a `.usmap` (unversioned properties); we borrow Fortnite's public one, which matches UE 5.8 engine-class layouts. Blueprint component templates parse; class-level defaults and the game's own C++ components need the game's own `.usmap` (Dumper-7, Windows) — that's the only remaining RE gap.

Note: `itemTransform` in a map file is the piece's **Main component** world transform, not the actor transform (e.g. every AirVent item carries Main's scale 0.75,0.75,1).

In-game console (`ballest.editor.*`): `saveprefab`, `spawnprefab`, `listprefabs`, `deleteprefab`, `pivot`.

## Pivots (`editorState.pivots`)

The in-game inspector sets a per-item pivot: Default, Center, Bottom, Top, Left, Right, Back or Front. The gizmo sits on it and rotates and scales the item about it. `localPosition` is that point in the item's local frame (the Main component, unscaled cm): the centre of the Main mesh's local bounds, or the centre of one face of them. Back is +X, Front −X, Right +Y, Left −Y, Top +Z, Bottom −Z. Every pivot in `samples/` matches the catalog's bounds this way (`apps/web/src/domain/pivot.test.ts`). Items without an entry use Default (the origin), and no sample has a Default entry, so the editor drops the entry when a pivot goes back to Default. Entries are sorted by `itemIndex`. A map without `editorState` (an imported `.ballmap`) gets one when a pivot is set or pasted.
