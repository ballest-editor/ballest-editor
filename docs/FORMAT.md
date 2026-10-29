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
      levelDifficulty: "Beginner",
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

## Catalog (from 22 sample maps, 9.9k items)

91 distinct `actorToSpawn` classes so far — families: `BP_Prim_*` (cube/cylinder/sphere), `BP_Track_*`, `BP_Ramp_*`, `BP_Pipe_*`, `Bevel_*` (~40 pieces), `MP_*` (glass planes, bowls, air vent, cone, torus…), `BP_Checkpoint`, `MP_ActualCheckpoint_Strip`, `MP_PlayerStart` (required, forbidden in prefabs), `BP_UGCCircuitDecal`.
Mesh assets referenced from `/Game/Maps/_GENERATED/PC/*` (79 in the pak), materials from `/Game/Art/Materials/*` (`MI_Env_*`, `M_GlassV2`, …).
Exposed item properties seen: `Field Magnitude`, `EntryAssistMinSpeed`, `QualifiedAirflowTargetSpeed`, `UpperAirflowMultiplier` (air vent), `DecalWidth/Height/Depth`, `DecalStyle`, `bFacingOnly` (decal).
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
