# Ballest of Them All — custom map format (findings, 2026-10-26)

Game: Steam app 3339810, Unreal Engine 5.8 (`++UE5+Release-5.8-CL-56702186`), build 0.4.0-playtest.
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
      createdAt: "YYYY.MM.DD-HH.MM.SS",
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
    groups: [...],
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

Each `meshComponents[].materials[]` entry is one UE material slot (`materialIndex`, contiguous from 0, in index order), and `materialAssetPaths` repeats the same materials as bare object paths in the same order. Every slot can be repainted independently, including outline strips such as `M_OutlineEdges`. The in-game Paint panel offers 7 finishes (smooth, rough, glossy, concrete, tiled, emissive, special) × colours, which come to 66 material instances, listed in `assets/materials.json` under `paint` (see `tools/extract/README.md`). Maps also carry materials outside that list: catalog defaults (`MI_ArenaOrange2`, `M_BaseSurface_Metal`, …) and older instances (`MI_Env_Smooth_Lime_OLD`).

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

The in-game item browser is one table of 11 categories → data assets listing **100** item classes. `DA_UGCPlaybackRecipeRegistry` (the load-time allowlist) references **200** item classes. So ~100 classes are spawnable from a map file but hidden from the in-game browser: raw/fixture point, spot and rect lights, light cards 01–04, laser terminal, orange sign, boost platform/ring/volume, pinball launcher/paddle, circular flexible platform, shape decal, checkpoint strip/disc, shallow bowl, extra bevels. `BP_KillZone` is not an item class and not in the registry. `MP_PlayerStart` is placed by the editor, not the browser. The registry's per-class recipe data needs the game's own usmap and is unread.

## The level (`Map_LevelEditorMain`)

Every map is spawned into `/Game/Maps/LevelEditor/Map_LevelEditorMain`. Read from its cooked assets with `BallestExtract probe` (UE cm, world space). The editor's copies are in `apps/editor/src/domain/level.ts`.

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
- per-mesh material slot safety limit
- `Serialized level JSON contains an invalid or oversized object`
- `levelName and username must be strings`; display-name text limit 4096
- editor metadata (groups, pivots) validated separately; invalid → rejected
- prefab: 2–4096 items, no `MP_PlayerStart`

## Game assets

Pak: `Ballest/Content/Paks/Ballest-Windows.{pak,utoc,ucas}` — IoStore TOC v8, Oodle-compressed, signed, indexed, **not encrypted**, 6689 entries. `Paks/~Mods/` exists (mod paks are loadable). Meshes are extracted with CUE4Parse (`GAME_UE5_8`) via `nix run .#extract` — see `tools/extract/README.md`. Even static meshes need a `.usmap` (unversioned properties); we borrow Fortnite's public one, which matches UE 5.8 engine-class layouts. Blueprint component templates parse; class-level defaults and the game's own C++ components need the game's own `.usmap` (Dumper-7, Windows) — that's the only remaining RE gap.

Note: `itemTransform` in a map file is the piece's **Main component** world transform, not the actor transform (e.g. every AirVent item carries Main's scale 0.75,0.75,1).

In-game console (`ballest.editor.*`): `saveprefab`, `spawnprefab`, `listprefabs`, `deleteprefab`, `pivot`.
