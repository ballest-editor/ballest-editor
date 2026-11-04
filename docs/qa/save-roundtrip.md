# QA: the save round-trip against the game

Run on 2026-11-04 against Ballest of Them All 0.4.1, through the game driver (`tools/driver`, slot 2, headless, sandbox complete, host 0.33.2).

The question: write a draft with our app, open it in the game's editor, change one thing, save with the game, and compare what it wrote with what we write.

The short answer: our file format is right. Key order, number formatting and tabs/CRLF match the game byte for byte, and mirrored pieces and exposed properties come back unchanged. The trouble was elsewhere. Two app bugs mattered to players, and both are fixed here. Two game behaviours matter to players and we can't fix them.

## Results

| Case                                 | Result                                                                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh draft                          | Loads. Values change as listed below, none of them harmful.                                                                                                                                     |
| Draft with pivots                    | Loads with the pivots live in the editor. The save deletes them (difference 3).                                                                                                                 |
| Draft with a group                   | A group made in game is not saved at all. A hand-written one loads and works (differences 2 and 3).                                                                                             |
| Draft with a mirrored piece          | No difference. The game's own Flip X writes an item identical to ours, baked mesh included.                                                                                                     |
| Draft with exposed properties        | Every value comes back exact, `0.10000000000000001` included. The game adds native properties (11).                                                                                             |
| Fields the game doesn't know         | Accepted at every level, dropped on save (12).                                                                                                                                                  |
| Key order, number format, whitespace | Identical. Two of the game's saves are now samples (`qa mirror save`, `qa props save`, with only their name fields changed to match the file names), and the app re-encodes them byte for byte. |
| `itemTransform` is Main's transform  | Confirmed. The air vent's scale `0.75, 0.75, 1` and the goal's rotation came back unchanged.                                                                                                    |
| Default pivot entry dropped?         | Could not be answered, see "What I could not verify". The game does load a file that has one.                                                                                                   |

## Differences that matter to a player

### 1. The app put the afternoon sun on the wrong side (app bug, fixed)

`sunOf` used a plain rotator forward vector, so past noon the sun crossed overhead to the far side of the sky. In a race it doesn't. It climbs, then comes back down the side it rose on, and 13:00 lights a map exactly as 11:00 does. Every map set after noon or after dark drew its shadows the wrong way round in our editor.

The light's forward vector in a race (`GetActorForwardVector` on the light in `Map_TrackUGCPlayback`), for a map with `directionalLightAngle` 37:

| Hour | Game                 | App before the fix     |
| ---- | -------------------- | ---------------------- |
| 3    | 0.565, 0.426, 0.707  | 0.565, 0.426, 0.707    |
| 5    | 0.771, 0.581, 0.259  | 0.771, 0.581, 0.259    |
| 8    | 0.692, 0.521, -0.5   | 0.692, 0.521, -0.5     |
| 11   | 0.207, 0.156, -0.966 | 0.207, 0.156, -0.966   |
| 13   | 0.207, 0.156, -0.966 | -0.207, -0.156, -0.966 |
| 15   | 0.565, 0.426, -0.707 | -0.565, -0.426, -0.707 |
| 17   | 0.771, 0.581, -0.259 | -0.771, -0.581, -0.259 |
| 19   | 0.771, 0.581, 0.259  | -0.771, -0.581, 0.259  |
| 22   | 0.399, 0.301, 0.866  | -0.399, -0.301, 0.866  |

The fix is `Math.abs(Math.cos(pitch))` for the horizontal part. `sunlight.test.ts` now holds these nine rows, and five of them fail without the fix. The old test "crosses the sky along the light's yaw" asserted the wrong model, so I replaced it.

### 2. Deleting a grouped piece made a draft the game throws away (app bug, fixed)

`removeItems` left `editorState.groups` alone. Group members are item indices, so deleting a piece left a stale index, and the game then opens a blank map with no message. The player sees their map gone.

The game read this as a group, and selecting one member selected all three:

```json
"groups": [{ "members": [2, 3, 4], "name": "qagroup", "frame": { "rotation": {...}, "translation": {...}, "scale3D": {...} } }]
```

With `"members": [2, 3, 99]` in a six-item map, it opened the level's default start and goal instead. What the game did with each shape:

| `editorState`             | Game      |
| ------------------------- | --------- |
| Group of two, or of one   | Opens     |
| Group with no `name`      | Opens     |
| Member past the last item | Blank map |
| Empty group               | Blank map |
| Item in two groups        | Blank map |
| Group with no `frame`     | Blank map |
| Pivot past the last item  | Blank map |

`removeItems` now takes removed members out, shifts later ones down, and removes a group left empty. `gameLoadProblems` refuses all five blank-map shapes, so Export reports them instead of writing a file the game drops. `groups` was `Schema.Unknown`, and is now `EditorGroup`, with only `members` required.

The bug has a quieter form too. If the shifted index still lands inside the map, the game opens it and groups the wrong piece. I checked both ends in the game. From a six-item draft with group `[3, 4, 5]`, deleting item 3 with the fixed `removeItems` gives `[3, 4]`, which opens with all five pieces. The same file with the old untouched `[3, 4, 5]` opens blank.

How often a player hits this is unclear. No sample has a group, 0.4.1 doesn't save them (difference 3), and the app has no way to make one yet (#78). A draft would need groups from an older game version, if one saved them, or from a hand edit. The fix matters most once #78 lands.

### 3. Saving in 0.4.1 deletes every pivot and group (game behaviour, can't fix)

Ours, as written:

```json
"editorState":
{
	"version": 1,
	"groups": [],
	"pivots": [
		{ "itemIndex": 2, "pivot": { "choice": "Center", ... } },
		{ "itemIndex": 3, "pivot": { "choice": "Bottom", ... } }
	],
	...
}
```

The game: no `editorState` key at all.

The game did load them. The cube reported `Center` and the ramp `Bottom`, with the gizmo in the right place. The save still wrote nothing. I got the same result with the real save button and popup, with a pivot set through the game's own panel in the same session, with a named group, and with a map whose creator is the player saving over its own file.

So FORMAT.md's explanation, that a 0.4.1 draft omits `editorState` because it has nothing in it, was wrong, or at least not the whole story. A player who sets pivots in our app and then saves in the game loses them. Nothing here tells me whether that is a game bug or a change of mind, so it's worth reporting upstream. #112 (a sidecar for editor-only data) would protect our own data from it.

See "What I could not verify" for the sandbox caveat, which matters here.

### 4. Opening a morning map in the game's editor turns its sun around (game behaviour, can't fix)

The game's editor sets the light's yaw to the file's value plus 180. A race uses the file's value. Each row below is a fresh game process, with a marker in the file proving which map opened:

| File angle, time | Editor: pitch, yaw, roll | Race: pitch, yaw, roll |
| ---------------- | ------------------------ | ---------------------- |
| 37, 7.3 h        | -19.5, -143, 28.1        | -19.5, 37, 155.5       |
| -20.647, 7.3 h   | -19.5, 159.35, 28.1      | -19.5, -20.647, 155.5  |
| 37, 10 h         | -60, -143, 28.1          | -60, 37, 155.5         |
| 120, 15 h        | -45, 120, -151.9         | -45, 120, -24.5        |

The save writes the editor's live yaw. So before noon a plain open and save moves the number by 180:

```json
ours:  "directionalLightAngle": -20.647455215454102
game:  "directionalLightAngle": 159.3525390625
```

A second open and save gave `-20.6474609375`. Since a race reads the file, each open and save in the game moves the race's sun to the opposite side. After noon the value stays put (Waterfront, 16.97 h, keeps -162.587), because past vertical UE normalises the rotator with yaw and roll shifted 180, which cancels the offset. The slider itself is honest: setting 100 gave live 100 and saved 100.

`159.3525390625` is already in `props probe` and the Workshop map Bevel Up, so this isn't new. The app keeps the file's value and draws what a race shows, which is right. It means the game's editor preview disagrees with the game's race before noon, and the app will disagree with that preview. I didn't change the app for this.

## Differences that don't matter to a player

None of these needs a fix. The game normalises each one, and it loads our version without complaint.

**5. The file and creator become the player's.** Saving a map from creator `driver` wrote a new file instead of overwriting.

```json
ours:  "userLevelName": "driver probe_driver",                        "creatorName": "driver"
game:  "userLevelName": "driver probe_spigipplespigipplespigipple",   "creatorName": "spigipplespigipplespigipple"
```

The original stays beside it. The app defaults the creator to the Steam name (`creator.ts`), so this only bites a player who typed a different creator in Settings. They would end up with two files.

**6. `createdAt` is the time the map was opened, in UTC.** The app writes local time at export. The game replaces it on open anyway. It matched `openmap` to the second, and two saves in one session kept the same value.

```json
ours:  "createdAt": "2026.11.04-15.05.15"
game:  "createdAt": "2026.11.04-20.05.42"
```

**7. `metaData` is emptied.**

```json
ours:  "metaData": [{ "title": "Foo", "descriptor": "Bar" }]
game:  "metaData": []
```

**8. `medalTimesByIndex` is emptied on an unvalidated map.**

```json
ours:  "medalTimesByIndex": [0]
game:  "medalTimesByIndex": []
```

Nothing in the app reads either of these two fields' contents.

**9. An empty `editorState` is left out.** We write the empty block. The game omits it, and loads ours. The comment in `MapExporter` claimed every `.balledit` has one, which is false, so I corrected it.

**10. Decals get a placeholder mesh.** All five decals in `samples/` have it too. Our factory writes the empty component it uses for the air vent.

```json
ours:  "meshAssetPath": "", "materials": []
game:  "meshAssetPath": "/Engine/BasicShapes/Sphere.Sphere", "materials": [{ "material": "/Script/Engine.Material'/Engine/EngineMaterials/DefaultMaterial.DefaultMaterial'", "materialIndex": 0 }]
```

**11. Native properties appear on classes where the catalog calls them optional.** The ramp `BP_Ramp_Curve_Short1`, the air vent and the circuit decal all came back with `bMirror`, `bMirrorX` and `SurfaceAssignment`, which answers part of FORMAT.md's open question. The game loads items without them, so the app's rule of leaving them out stays safe.

```json
ours:  "boolProperties": [], "intProperties": []
game:  "boolProperties": [{ "currentValue": false, "propertyName": "bMirror", ... }, { "currentValue": false, "propertyName": "bMirrorX", ... }],
       "intProperties": [{ "currentValue": 0, "propertyName": "SurfaceAssignment", ... }]
```

**12. Unknown JSON fields are dropped.** I put extra fields at the file root, in `worldSettings`, `levelData`, an item, `itemTransform`, a mesh component and `editorState`. All three files loaded with every piece, and none of the fields survived a save. The app keeps them on export, which does no harm. This is about JSON keys. An unknown item _property_ is a different matter, and FORMAT.md records that the game rejects it. I didn't retest that.

## What I could not verify

- **Whether the sandbox causes difference 3.** Every save here ran in a sandboxed slot. I can't test the player's real game, and shouldn't. The evidence against the sandbox is thin but real: `new pieces probe`, the one real 0.4.1 save we have, also has no `editorState`, but I don't know whether any pivot was set in it. One in-game test would settle it: set a pivot in the real game, save, and read the file.
- **What the game writes for a group.** It never wrote one, so the `{ members, name, frame }` shape comes from `SKGMLEEditorGroupSave` and from what the game accepted. `frame` is typed `Unknown` for that reason. I don't know what its values mean, and I made mine up.
- **Whether a Default pivot entry gets dropped.** No pivot survives a save, so this can't be observed. A file with one opens fine, and the game reported nothing wrong.
- **`bHasCamera` and the saved camera.** Never written, same cause.
- **Races from a published `.ballmap`.** All race readings used `Tracks::OpenLocal` on a `.balledit`, the route our Play button uses.
- **The sky.** I measured the light actor, not the sky sphere, so I don't know that its sun disc follows the same path. The app's sky now uses the corrected direction.
- **Exact hours.** Nine hours at yaw 37, plus one at 120. Nothing at exactly 6, 12, 18 or 0, and no render comparison of shadows.
- **The fixes in the app's UI.** Unit tests cover `sunOf`, `removeItems` and `gameLoadProblems`, and the game loaded a file made by the fixed `removeItems`. I didn't run the app and look at its rendered sun or its Export message.
- **Other pieces.** Native properties were checked on three kinds, not the rest of the palette. A group with a repeated member or a negative index is untested. FORMAT.md's note about items near z = 0 rising 170 to 400 cm wasn't tested either; everything here sat near z = 8000 and didn't move.

## Traps for the next person

These cost me most of the session, and each gave a wrong answer that looked right.

- `openmap` matches only the first word of its argument and takes the first entry containing it. `openmap driver probe_spig` means `driver`, and `openmap rt 37_spig` opened Waterfront. For a while this produced an apparent rule break and then an apparent state leak between maps. Neither was real. Use one distinctive word, and check the piece count or a marker. `probe_map` had the same problem and now searches for `probe_driver`.
- `-> ok` means the call ran. The first save reported ok, and `cmp` then said byte-identical, because the game had written a different file and left mine untouched. Check the mtime.
- The game saves to `<name>_<player>`, not to the file it opened.
- A rejected map opens as a blank one. Pieces named `MP_PlayerStart_00_C_0` are the level's own.
- `editor_transform` writes 0 for any of x, y, z you leave out.
- `BeginTrackValidation` through `callx` starts a stock arena track, not your map. For a race, use `Tracks::OpenLocal`.
- Rotators past vertical come back with yaw and roll shifted 180. Read `GetActorForwardVector` instead.
- The editor and a race are different levels with different light actors, so a reading in one says nothing about the other. Had I fixed the app from the editor's readings, I would have put the sun on the wrong side in races.
