# QA: hard limits and validation against the game

Run on 2026-11-04 against Ballest of Them All 0.4.1 (build d6cc29a405d8), through the game driver (`tools/driver`, slot 3, headless, sandbox complete, host 0.33.2).

The question: hit each limit and rejection rule in `docs/FORMAT.md` with a probe map, see what the game does, and compare that with what our validation does for the same bytes.

The short answer: our validation was missing most of the game's rules, and a bigger hole sat in front of them. An imported `.balledit` with no edits went to the game without being checked at all. Both are fixed here, apart from the rules listed under "Open gaps". FORMAT.md also had the player start wrong: the game loads a map with none, or with two.

## What the game does with a file

There are five outcomes, and only the first is what the player wanted. None of the others shows a message, and the host log says nothing either.

| Outcome                | What the player sees                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Loads                  | Their map.                                                                                                                              |
| Blank map              | The level's default start and goal, under their map's name.                                                                             |
| Not on the Create page | The map is gone from the list. The game reads the folder each time the menu opens, so fixing the file brings it back without a restart. |
| Opens a different map  | With no `userLevelName`, the Create entry opens some other map of the player's. The name is what the game looks up (docs/DRIVER.md).    |
| Item lost on save      | The map loads and the actor is in the world, but the editor doesn't count it as a piece, so the next save writes the file without it.   |

No case repaired a bad value in a way I could see. A missing field gets its default and everything else loads as written or is refused. A scale of 0 and a piece 100 km outside the placement bounds stay as written. A quaternion inside the tolerance loads, but the driver reads rotations back as angles, so I can't say whether the game normalises it.

## A blank map can destroy the file

This is the worst case I found, and it's the game's behaviour, so we can't fix it there. The blank map keeps the map's name in the header. If the player presses Save, the game asks "A level with the name ... already exists - do you want to overwrite it?". That reads as routine, since it's their map's name. I said yes on a 24-item scratch map with one bad quaternion, and the file came back with 2 items, the default start and goal. The other 22 were gone.

The prompt only appears when the map's creator is the player. Save writes `<map>_<player>`, so a map with another creator gets a new file beside the original instead.

This is why a file the game refuses is worse than an error. Blocking those files in our app is the only protection the player has.

## What changed in the app

- **Export and Play check the map first.** A map with no edits skipped `MapExporter`, and an imported `.balledit` is copied byte for byte, so neither passed any rule, including the ones we already had. `writeOpenMapToGame` now runs `gameLoadProblems` before anything is written. The test for it fails without the change.
- **Main checks the character limit on the file it copies.** `MapExports.exportMap` runs `fileTextProblems` on the bytes it is about to write, before it asks about anything. The map the page decoded can't show this limit, since whitespace counts, and an open tab can be older than the file. Play goes through the same export. Main also refuses to open or import a file this long (§ Characters, not bytes), so what got through was a file that grew on disk while its tab sat open with no edits.
- **`domain/gameRules.ts` holds the new rules**, each measured below: classes the catalog lacks or the game no longer ships, unknown, misplaced, repeated and nameless properties, extra mesh components, uncooked meshes, negative and repeated material slots, too many materials or paths, unknown difficulties, `editorState.version`, repeated pivots, unknown pivot choices, group names and frames, and the parser's limits on strings, field names, containers and nesting.
- **Writing a `.balledit` clears `bIsBaseItem`**, see below.

The rules ran over all 30 samples and 10,017 items. They flag four items, and each is correct. One is the `MP_PinballPaddle` in the 0.4.0 props probe: the class is gone from 0.4.1 and a map with one opens blank. The other three are in `hidden probe 2`, a `BP_TwoCubeOneColor`, a `BP_TwoCubeTwoColor` and an `MP_OrangeSign`. The game saved each with two components under one tag and won't reopen them (`docs/qa/exposed-properties.md`), and the rule against any component on those classes catches them. `gameRules.test.ts` keeps this check, plus a case the game accepts for each kind of rule, so a rule that goes too far fails a test.

## Limits

Constants read from the shipping exe at the `cmp` beside each error string, then measured at the limit and one past it, unless the table says otherwise.

| Limit                     | Value      | Measured                                                                                  |
| ------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| Characters per file       | 67,108,864 | Yes. UTF-16 code units, not bytes, and a BOM isn't one (§ Characters, not bytes)          |
| JSON values per file      | 2,000,000  | Yes. Every object, array and scalar counts, the root included                             |
| String length             | 1,048,576  | Yes, on any field, modelled or not                                                        |
| Field name length         | 4,096      | Yes                                                                                       |
| Array or object entries   | 100,000    | Yes                                                                                       |
| Nesting                   | 64         | Yes, with the root at depth 0: 63 arrays under the root load and 64 don't                 |
| Items per level           | 100,000    | Refused at 100,001, but the value cap refuses 100,000 bare items too (2.4 million values) |
| Mesh components per item  | 64         | No. A second component on a cube is already refused                                       |
| Materials per mesh        | 256        | No. No mesh has that many slots, so 257 entries fails on the slots first                  |
| Mesh or material path     | 4,096      | No. A path that long is also uncooked, which is refused anyway                            |
| Properties per typed list | 4,096      | No. No class has that many, so 4,097 fails as unknown properties first                    |

The first two decide how big a map can be, and they land far below 100,000 items. A sample item is about 35 values and 1,400 characters, which puts the cap near 48,000 items. Both caps are checked since #181 (`docs/qa/budget.md`).

## Characters, not bytes

Measured on 2026-11-09 through the game driver (slot 4, headless), for #203. Each probe is the driver's probe map padded with spaces before its closing brace, with a marker coordinate on one cube, and counts as loaded only if the marker shows in the editor.

| Probe                                    | Bytes      | UTF-16 code units        | Game      |
| ---------------------------------------- | ---------- | ------------------------ | --------- |
| ASCII, at the limit                      | 67,108,864 | 67,108,864               | Loads     |
| ASCII, one over                          | 67,108,865 | 67,108,865               | Blank map |
| A BOM, then the limit                    | 67,108,867 | 67,108,864 after the BOM | Loads     |
| One U+1F600 in `levelDescription`, at it | 67,108,866 | 67,108,864               | Loads     |
| The same, one over                       | 67,108,867 | 67,108,865               | Blank map |

So the game counts the UTF-16 code units of the text it decodes. A character outside the BMP is two, and the last probe has only 67,108,864 code points, so the count isn't of code points. A BOM is none. That is JavaScript's `length` of what `TextDecoder` returns, which is what `fileTextProblems` counts.

The app counted bytes in one place. Main refused to read any map file over 64 MiB, so a file the game loads, such as 40 million `é`, couldn't be opened, imported, listed under File › Import map, or read back by the in-game editor's sync. Main now rules out by size only a file past `FileLimit`'s `maxFileBytes`, the most a file within the limit can take (three bytes per code unit, and a BOM), and counts the characters of the rest once it has read them. A file over the limit gets "has more characters than the game loads". `mapExports.ipc.test.ts` covers each of those paths with a file at the limit in characters but past it in bytes, with and without a BOM, under a 64-character `FileLimit`; `fileLimit.ipc.test.ts` is the one test at the game's own limit.

## Cases

"Blocks it" means Save, Export and Play refuse with a message. "Stricter" marks a file the game takes and we don't. I left those alone, because refusing is safe and they only come from hand-edited files.

### Non-normalised quaternions

| Case                                                          | Game      | Ours      |
| ------------------------------------------------------------- | --------- | --------- |
| `w` 2 or 0, on a piece, the start or the goal                 | Blank map | Blocks it |
| `w` 1.0051 or 0.9949, just outside `abs(1 - abs(q)^2) < 0.01` | Blank map | Blocks it |
| `w` 1.0049 or 0.9951, just inside                             | Loads     | Exports   |

### NaN and Infinity

| Case                                                  | Game                                     | Ours           |
| ----------------------------------------------------- | ---------------------------------------- | -------------- |
| `NaN` token in a rotation, translation or scale       | Blank map                                | Refuses import |
| `Infinity` or `-Infinity` token in the same           | Not on the Create page                   | Refuses import |
| `1e999` in the same                                   | Blank map                                | Refuses import |
| `1e999` in the light's time, brightness or angle      | Blank map                                | Refuses import |
| `1e999` in a float property, camera or pivot position | Blank map                                | Refuses import |
| `1e999` in `skylightIntensity` or a medal time        | Loads                                    | Refuses import |
| `null` in a transform field                           | Loads: treated as absent, so the default | Refuses import |
| A string `"1"` in a transform field                   | Loads: reads it as the number 1          | Refuses import |

### Transforms in range

| Case                                                       | Game                           | Ours           |
| ---------------------------------------------------------- | ------------------------------ | -------------- |
| Scale 0, negative or 1,000,000                             | Loads, as written              | Exports        |
| Piece or start outside the placement bounds                | Loads, as written, not clamped | Exports        |
| No `itemTransform`, `rotation`, `translation` or `scale3D` | Loads with the default         | Refuses import |

### Class paths

| Case                                                                                  | Game                                                                    | Ours                                     |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| Unknown path, empty or garbage                                                        | Blank map                                                               | Blocks it                                |
| No `actorToSpawn` key                                                                 | Blank map                                                               | Refuses import                           |
| Exists but isn't an actor (a widget, a mesh)                                          | Blank map                                                               | Blocks it                                |
| `MP_PinballPaddle`, gone in 0.4.1                                                     | Blank map                                                               | Blocks it                                |
| Exists, is an actor, isn't an item: `BP_KillZone`, the editor pawn, `StaticMeshActor` | Spawns it outside the editor. No piece, and the next save leaves it out | Blocks it                                |
| Native `SKGMLEEditorItem`                                                             | Rest of the map loads, no piece for it. World and save not checked      | Blocks it                                |
| Hidden item class `BP_Prim_Sphere`, or a path without its wrapper                     | Loads                                                                   | Exports                                  |
| `BP_BaseItem`, the parent class                                                       | Loads                                                                   | Blocks it (stricter: not in the catalog) |
| `BP_CinematicLaserTerminal`, in the catalog but hidden                                | Loads                                                                   | Exports                                  |

### `editorState`

| Case                                             | Game      | Ours                      |
| ------------------------------------------------ | --------- | ------------------------- |
| Missing                                          | Loads     | Exports                   |
| `null`, a string, `{}`, or no `version`          | Blank map | Refuses import            |
| `version` 0 or 2                                 | Blank map | Blocks it                 |
| Present without `groups`, `pivots` or the camera | Loads     | Refuses import (stricter) |

### Pivots

| Case                                                                          | Game                                                            | Ours      |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------- | --------- |
| Valid entry, or on the start, or out of order, or `Default`, or `WorldOrigin` | Loads: live after load (choice read back). Save then deletes it | Exports   |
| Two entries for one item, same or different                                   | Blank map                                                       | Blocks it |
| Index past the end, equal to the length, or negative                          | Blank map                                                       | Blocks it |
| Unknown `choice`                                                              | Blank map                                                       | Blocks it |

### Groups

| Case                                                                  | Game                        | Ours           |
| --------------------------------------------------------------------- | --------------------------- | -------------- |
| Valid, one member, no name, a 64-character name, or holding the start | Loads. Save then deletes it | Exports        |
| Member past the end, equal to the length, or negative                 | Blank map                   | Blocks it      |
| Member twice, shared by two groups, an empty group, or no frame       | Blank map                   | Blocks it      |
| Name of 65 characters, or with a space                                | Blank map                   | Blocks it      |
| Frame with a non-normalised rotation                                  | Blank map                   | Blocks it      |
| Frame with a scale axis of 0 ([groups-prefabs.md](groups-prefabs.md)) | Blank map                   | Blocks it      |
| An entry that isn't an object                                         | Blank map                   | Refuses import |

### `worldSettings` and the file's shape

| Case                                                                                         | Game                                                     | Ours                      |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------- |
| No `worldSettings`                                                                           | Not on the Create page                                   | Refuses import            |
| No `items`                                                                                   | Blank map                                                | Refuses import            |
| `items: []`                                                                                  | Opens with no pieces: no start, no goal                  | Blocks it                 |
| No `directionalLight`, `metaData`, `timeOfDay` or `brightness`                               | Loads with the default                                   | Refuses import (stricter) |
| No `skylightIntensity` or `directionalLightAngle`                                            | Loads with the default                                   | Exports                   |
| No `levelData`, or no `userLevelName`                                                        | Opens a different map (here a 9-piece map of the slot's) | Refuses import            |
| Any other `levelData` field missing                                                          | Loads                                                    | Refuses import (stricter) |
| `levelDifficulty` empty or unknown                                                           | Not on the Create page                                   | Blocks it                 |
| The five names, any case, or with `EBallgameDifficulty::`                                    | Loads                                                    | Exports                   |
| Unknown tag or `systemLevelName`                                                             | Loads                                                    | Exports                   |
| Wrong type: number for `levelDisplayName`, string for `levelPublishedFileId` or `bValidated` | Loads                                                    | Refuses import (stricter) |
| Unknown keys on the root or an item                                                          | Loads; Save drops them (#179)                            | Exports                   |

### Mesh components

| Case                                                                                 | Game      | Ours                      |
| ------------------------------------------------------------------------------------ | --------- | ------------------------- |
| `meshComponents` missing, on one item or all                                         | Loads     | Refuses import (stricter) |
| `meshComponents: []`, on one item or all                                             | Loads     | Exports                   |
| A second component, same tag, other tag or other mesh                                | Blank map | Blocks it                 |
| 64 or 65 components                                                                  | Blank map | Blocks it                 |
| One component with an unknown or empty tag                                           | Loads     | Exports                   |
| No tag key                                                                           | Loads     | Refuses import (stricter) |
| Empty or absent `meshAssetPath`                                                      | Loads     | Exports                   |
| Mesh of another piece                                                                | Loads     | Exports                   |
| Mesh path that isn't cooked, or a material as the mesh, or 4,096 or 4,097 characters | Blank map | Blocks it                 |

### Materials

| Case                                                          | Game      | Ours                             |
| ------------------------------------------------------------- | --------- | -------------------------------- |
| Negative slot, or a slot twice                                | Blank map | Blocks it                        |
| Slot past the mesh's last                                     | Blank map | Blocks it                        |
| Material that isn't cooked, in either list                    | Blank map | **Exports. Open gap, see below** |
| More paths than slots, 257 entries, or a 4,097-character path | Blank map | Blocks it                        |
| No paths, or no materials at all                              | Loads     | Exports                          |

### Properties

| Case                                                           | Game      | Ours                      |
| -------------------------------------------------------------- | --------- | ------------------------- |
| Unknown name, wrong list, set twice, no name, or 4,097 entries | Blank map | Blocks it                 |
| `SurfaceAssignment` 5 or -1                                    | Loads     | Exports                   |
| Wrong `propertyType` label                                     | Loads     | Exports                   |
| `1.5` or `"1"` in an int property                              | Loads     | Refuses import (stricter) |
| A class's properties left out                                  | Loads     | Exports                   |
| A list key missing                                             | Loads     | Refuses import (stricter) |

### `bIsBaseItem`

| Case                      | Game                                                         | Ours                          |
| ------------------------- | ------------------------------------------------------------ | ----------------------------- |
| `true` on a draft's piece | Loads, but the piece is not in the editor's list (see below) | Exports with the flag cleared |
| Key missing               | Loads                                                        | Refuses import (stricter)     |

### Start and goal

| Case                       | Game                                        | Ours                         |
| -------------------------- | ------------------------------------------- | ---------------------------- |
| No player start            | Loads. Play starts a timed run with no ball | Blocks it (stricter)         |
| Two player starts          | Loads. Play uses the later one              | Blocks it (stricter)         |
| Start not first in `items` | Loads                                       | Exports                      |
| No goal                    | Loads. Play does nothing                    | Exports. Open gap, see below |
| Two goals                  | Loads. Play works                           | Exports                      |

### Parser limits, each at the limit and one past it

| Case                                                        | Game      | Ours      |
| ----------------------------------------------------------- | --------- | --------- |
| String of 1,048,576 characters                              | Loads     | Exports   |
| String of 1,048,577, modelled field or not                  | Blank map | Blocks it |
| Field name of 4,095 or 4,096                                | Loads     | Exports   |
| Field name of 4,097                                         | Blank map | Blocks it |
| Array or object of 100,000 entries                          | Loads     | Exports   |
| Array or object of 100,001                                  | Blank map | Blocks it |
| 62 or 63 arrays nested under the root                       | Loads     | Exports   |
| 64 or 65                                                    | Blank map | Blocks it |
| 2,000,000 JSON values or fewer                              | Loads     | Exports   |
| 2,000,001 or more                                           | Blank map | Blocks it |
| 67,108,864 characters or fewer                              | Loads     | Exports   |
| 67,108,865                                                  | Blank map | Blocks it |
| 40 million `é`: 80 MB as UTF-8, under the cap in characters | Loads     | Exports   |
| A BOM, then 67,108,864 characters                           | Loads     | Exports   |
| A character outside the BMP and 67,108,862 others           | Loads     | Exports   |
| A character outside the BMP and 67,108,863 others           | Blank map | Blocks it |
| 100,000 bare items (2.4 million values)                     | Blank map | Blocks it |
| 100,001 bare items                                          | Blank map | Blocks it |

### JSON syntax

| Case                                                       | Game                   | Ours           |
| ---------------------------------------------------------- | ---------------------- | -------------- |
| Empty, `[]`, `{}`, trailing comma, truncated, or a comment | Not on the Create page | Refuses import |
| BOM, the game's own tabs and CRLF, or a repeated key       | Loads                  | Exports        |

## `bIsBaseItem`

All 9,517 items in the published samples have it `true`, and all 250 in drafts have it `false`, so it marks a published item. My first reading was that the game drops such an item, because the editor's piece list didn't show it. That was wrong. The actor is in the world (`instances`) and Save writes it back. In a draft with every item flagged, the piece list is empty, all four actors exist and all four are saved.

It matters because importing a `.ballmap` kept the flag, so every imported Workshop map became a draft whose pieces the editor doesn't list. `prepare` now writes `false`, as every draft the game writes has it. A map published again gets the flag from the game.

## No player start, two starts, no goal

FORMAT.md called the start required, and `gameLoadProblems` says "The game needs exactly one". Neither is true of loading. All of these open in the editor, and the difference only shows on the editor's Play button:

| Map         | Play                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| One of each | Ball on the start.                                                          |
| No start    | A timed run starts with no ball and the camera at the water. Nothing to do. |
| Two starts  | Ball on the later one in `items`.                                           |
| No goal     | Nothing happens. It stays in the editor, with no message at 6 s.            |
| Two goals   | Starts normally.                                                            |

I kept our rule for the start. The wording is loose, but a map with no start can't be raced and two starts is likely a mistake. A rule change is the maintainer's decision.

## Open gaps

These are files we still let through.

- **A material that isn't cooked** opens a blank map and we export it. The known list (`materials.json` plus the catalog) covers all 13,759 material references in the samples, but it isn't the game's full set, so a blocking rule could stop a valid Workshop map from saving. It needs the full list from the pak. The app can't produce such a path, so this takes a hand-edited file.
- **No goal** exports, and Play in the game then does nothing. The map isn't lost, so I didn't block Save, which would stop a player saving mid-edit. A warning at Play would suit it better.
- **A game save of `MP_OrangeSign`, `BP_TwoCubeOneColor` or `BP_TwoCubeTwoColor`.** The app writes these with `meshComponents: []` and `gameRules.ts` refuses any component, so the app's own file loads. Measured on 0.4.1 from a map the factory wrote: all three opened and drew, alone and together, flipped on either axis, with a surface, scaled and turned. Saving that map in the game wrote two components back on each, and the saved file then opened blank. The app refuses such a file at Save, Export and Play, but it can't stop the game saving one, so `verified.json` keeps these classes `rejected` and players can't place them.

## What I could not verify

- **Why each file was refused.** The shipping build writes no log (its `Saved/Logs` is empty) and the host logs nothing about a rejection. I matched outcomes to the exe's error strings, but the game never told me which check fired.
- **A real map near the cap.** The value and character caps were measured with padding on a 4-item map. I didn't load tens of thousands of real pieces: the machine had 5 GB free, with other agents running slots.
- **The limits marked "No" above.** Those constants come from the exe alone.
- **Whether a player can click a base item.** `tap` only reaches UI widgets. My test of it failed on an ordinary cube too, so it says nothing about base items. I know they're missing from `Editor::Pieces`, not that they can't be selected.
- **Any route but the editor.** Every case opened through the Create page. Racing a `.balledit` through our plugin, the published `.ballmap` loader and the Workshop path were not tested, so Play in the tables is the editor's Play button. They may be stricter or looser.
- **The extra-component rule on multi-mesh pieces.** A second component was refused on a cube, and the rule allows one per mesh the catalog lists for the piece. The only samples with two components are the three classes that take none, so no case shows that allowance is right.
- **A message after no-goal Play.** The render 6 s later shows none, but a short toast could have come and gone.

## Method

Each case is a baseline map (start, goal, two cubes, with `meshComponents` as the game saves them) with one change, written raw to the slot's probe file and opened through the Create page. Every case carries a unique marker coordinate on one cube, and a row counts as loaded only if that marker appears in the editor, which separates a load from a stale read or another map. A clean baseline ran every 20 cases and all 14 passed. Our side ran the same bytes through `MapCodec.decode`, `gameLoadProblems` and `MapExporter.prepare`, with the real catalog. 223 cases in all.

The first full run is void and nothing here comes from it. My harness shared property arrays between maps, so one case added `NoSuchProp` to every later map, and 30 cases were refused for that reason alone. It would have reported that the game rejects maps with no start or two, which is false. The game's own format coming back "rejected" gave it away. I rebuilt the harness with isolated maps and the marker and ran everything again.

`probe_map` can't tell a rejection from a load when it places one piece. It waits for pieces + 1 entries in the editor, and the blank map's start and goal are 2. The first probe of this session returned that blank map for a mistyped class path and reported success. Compare the pieces it returns with what was asked for.

`docs/DRIVER.md` and the tools say a written map needs a slot restart to show on the Create page. On this build a new file showed up on the next visit to the menu.
