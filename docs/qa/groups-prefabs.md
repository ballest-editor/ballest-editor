# QA: groups and prefabs in the game

Run on 2026-11-05 against Ballest of Them All 0.4.1, through the game driver (`tools/driver`, slot 2, sandbox complete, host 0.33.2). Headless, until the key tests moved it to a window.

The question: what do a group's `frame` and a prefab file mean, so the editor can turn its own nested groups and prefab instances into the game's flat format?

The short answer: `frame` is the group's gizmo and nothing else. Loading never moves a member because of it. The game's groups are flat and all-or-nothing: one group per item, no nesting, and no way to pick a single member. A prefab file stores each item relative to a point it doesn't record, and spawning one gives a single selected group.

The formats themselves are in [FORMAT.md](../FORMAT.md) § Groups and § Prefab file. This page holds the measurements behind them.

## How it was measured

Each case is the slot's probe map with a hand-written `editorState.groups`, opened through `open Map_MainMenu` and `openmap probe_driver`.

| What                | Read or done with                                                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection and gizmo | The test channel's `editor` status, and `GetSelectionTransform` on `SKGMLEHandlerComponent`                                                                                   |
| The panel's values  | `GetSelectionTransformPropertyValue` with 0 location, 1 rotation, 2 scale                                                                                                     |
| Group name, can-do  | `GetSelectionGroupName`, `CanRenameSelectionGroup`, `CanSetSelectionPivot`                                                                                                    |
| Moving a group      | `ApplyTransformUITextEdit`, the function behind the details panel's transform fields. I didn't drag the gizmo with a mouse (§ What I could not measure)                       |
| Grouping            | `editor call GroupSelection` and `UngroupSelection`, the handler's own functions. Ctrl+G was then confirmed with the real key on a windowed slot                              |
| Prefabs             | The test channel's `prefab <line>`, one line through the game's console (`ballest.editor.saveprefab qaprefab`). Files read from the slot's `UserDir/Saved/SaveGames/Prefabs/` |

## What `frame` means

Three `BP_Prim_Cube` at (0, 0, 5000), (1000, 0, 5000) and (200, 900, 5600), all in one group. Their origins' centroid is (400, 300, 5200). The cube's origin is the middle of its base, and it is 1000 cm on each side.

| Case | `frame` in the file                     | Gizmo after selecting a member | Panel shows                         | Members on load |
| ---- | --------------------------------------- | ------------------------------ | ----------------------------------- | --------------- |
| a    | At the centroid, identity               | (400, 300, 5200)               | Location there, rotation 0, scale 1 | Unmoved         |
| b    | (5400, 300, 5200), 5000 cm away         | (5400, 300, 5200)              | Location there                      | Unmoved         |
| c    | At the centroid, yaw 90                 | (400, 300, 5200), turned 90    | Rotation 90, members still read 0   | Unmoved         |
| d    | At the centroid, scale 2                | (400, 300, 5200)               | Scale 2, members still read 1       | Unmoved         |
| e    | (5400, 1300, 6200), yaw 90, scale 2,3,4 | (5400, 1300, 6200), turned 90  | All three values from the frame     | Unmoved         |

A render of case b shows the gizmo drawn alone over the water, with the cubes outlined 5000 cm away.

Each transform below ran on a freshly opened map.

| Case | Location +1000 in x                       | Rotation +90 yaw                                       | Scale ×2                                                |
| ---- | ----------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| a    | Members +1000, gizmo to (1400, 300, 5200) | First member to (700, −100, 5000), members at yaw 90   | First member to (−400, −300, 4800), members at scale 2  |
| b    | Members +1000, gizmo to (6400, 300, 5200) | First member to (5700, −5100, 5000), members at yaw 90 | First member to (−5400, −300, 4800), members at scale 2 |
| c    | As a; panel still reads 90                | As a: frame 90 to 180, members 0 to 90                 | As a                                                    |
| d    | As a; panel still reads 2                 | As a                                                   | Panel 2 to 4, members 1 to 2, positions as a            |

So every edit is a change from the frame's current value, applied about its translation, and the frame moves with the group. Reselecting later shows the frame as it was left. The frame's rotation and scale change what the panel reads and nothing else. Case c and case a land the members in the same place.

One detail for anyone copying the panel: scale 2, 1, 1 on a group whose frame has yaw 90 stretched the members along world X, exactly as an identity frame did. That was with the coordinate mode the map opens in. I didn't try the other mode.

## The frame the game makes

`GroupSelection` writes rotation identity, scale 1, and a translation at the centre of the world-aligned box around all the members' bounds. It isn't the centroid of their origins.

| Members                                                                                                         | Centroid of origins     | Frame the game made           |
| --------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------- |
| The three cubes above                                                                                           | (400, 300, 5200)        | (500, 450, 5800)              |
| The same, turned yaw 30, 60, 0 and scaled 2,2,2; 1,1,1; 1,3,1                                                   | (400, 300, 5200)        | (158.494, 516.987, 6000)      |
| Cube (yaw 30, scale 2,1,1), air vent, ramp (yaw −90) at (100, 200, 5000), (3100, 200, 5100), (1100, 2200, 6000) | (1433.3, 866.7, 5366.7) | (1092.612, 864.873, 5572.327) |

The box uses each member's turned bounds, so a turned cube counts its corners. The third row checks exactly: x −1016.03 (the cube) to 3201.25 (the vent), y −733.01 (the cube) to 2462.76 (the ramp), z 5000 to 6144.65. The vent's bounds here match its pivot bounds (`FORMAT.md` § Pivots). That row was run again on 2026-11-05 and matched the catalog's box to every digit. Its first run recorded x 1079.956 and a box to 3175.94, and nothing here explains why, so that number shouldn't be relied on.

A flipped member counts its flipped bounds. `piece_measure` on `Bevel_Full_ShortUScoop_R` at the origin gave x −909.81 to 863.81 and y −1122.03 to 594.03; Flip Y negated y, Flip X negated x, and both negated both. Selecting in reverse order made the same frame.

For comparison, a selection of several pieces with no group puts the gizmo on the piece picked last, with that piece's rotation and scale in the panel and the origins' centroid as the panel's location. Grouping them moves the gizmo.

## What the editor should write

Rotation identity, scale 1, translation at the centre of the members' world bounds: what Ctrl+G would have made. If the app has no bounds for a piece, any point near the members works, because the only cost of a wrong frame is where the gizmo appears. Keep it close: a player who rotates or scales the group does so about that point.

If the group moves in our editor, move its frame by the same amount so the gizmo stays with it. Keep the frame's own rotation and scale only if the app wants the game's panel to show them. Nothing about the members depends on them.

A nested group has to flatten to one game group holding every item beneath it. The file has no parent field, and an item in two groups opens a blank map.

## Frame values

| `frame`                                         | Game                                                     |
| ----------------------------------------------- | -------------------------------------------------------- |
| Scale 0, 0, 0, or only one axis 0               | Blank map                                                |
| Scale −1, 1, 1, or 0.001 on each axis           | Loads, panel shows it as written                         |
| Translation 10,000,000 or 1,000,000,000 in x    | Loads, gizmo there                                       |
| `{}`                                            | Loads, gizmo at the world origin, identity, scale 1      |
| No `scale3D`                                    | Loads, scale 1                                           |
| No `rotation`                                   | Loads, identity                                          |
| No `translation`                                | Loads, gizmo at the world origin                         |
| No `frame` at all, or a non-normalised rotation | Blank map ([limits-validation.md](limits-validation.md)) |

`gameRules.ts` refuses a frame with a 0 on a scale axis.

## Selecting, ungrouping and the rest

| Action                                                                       | Result                                                                                                                                       |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Pick a member in the viewport (`hover`, then `FindAndGrab`, a click's route) | All members selected                                                                                                                         |
| Click a member in the outliner (`GrabFromOutlinerClick`)                     | All members selected                                                                                                                         |
| `Grab` and `GrabWithNotifications` on a member                               | All members selected                                                                                                                         |
| Toggle a member off (append and toggle, in the viewport or the outliner)     | The whole group leaves the selection. Toggling it again brings the whole group back                                                          |
| Ctrl+G with the real key                                                     | Groups, frame (1000, 0, 5500) for two cubes                                                                                                  |
| `UngroupSelection`                                                           | Group gone, members stay selected and unmoved, gizmo back on a piece. Each member then selects alone                                         |
| Undo after grouping                                                          | Ungrouped                                                                                                                                    |
| A pivot on a group                                                           | `CanSetSelectionPivot` is false, and `SetSelectionPivot` does nothing. The game's text: "Select one ungrouped item to set its editor pivot." |
| Copy and paste a group                                                       | The copies form a new group with the same name and frame                                                                                     |
| A new group's name                                                           | Empty. `RenameSelectionGroup` sets it, and only for one whole group                                                                          |

No route I found selects one member alone. The host's `Editor::SetLocation` moved one member and left the frame where it was, but that isn't something a player can do.

## Group limits

**A group of one is not a plain piece.** It only comes from a file: `GroupSelection` with one piece selected does nothing. With its frame 5000 cm away, the gizmo sat on the frame, a yaw of 90 swung the piece around that point to (7000, −5000, 5000), the group name was available and pivots were not. Ungrouping put the gizmo back on the piece and allowed pivots again. The app shouldn't write one unless it wants that.

**A player can't delete one member.** Delete takes the selection, and the selection is the whole group. Undo brings the group back with its name and frame, under new piece ids.

**Ctrl+G across groups merges them, flat.** Selecting a group and a loose piece, or two groups, then grouping gave one group of all of them. Its frame was new (the bounds rule above) and its name empty, so both old frames and names were lost. Ungrouping that dissolved it completely: the old groups didn't come back. A group left out of the selection was unaffected. Grouping a selection that is exactly one existing group changed nothing, and it kept its name and frame.

**Groups still don't survive an in-game save.** A file saved with one group from `GroupSelection` and one from a prefab spawn (fresh mtime, 6 items) had no `editorState` at all, as [save-roundtrip.md](save-roundtrip.md) found.

## Saving a prefab

The file's shape is in [FORMAT.md](../FORMAT.md) § Prefab file. What the transforms are relative to depends on the selection:

| Selection                  | `location` is relative to                                  | `group` holds                                          |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Loose pieces               | The bounds centre (the rule in § The frame the game makes) | Rotation 0, scale 1                                    |
| One whole group            | Its frame's translation, with world axes                   | The frame's rotation and scale, the name if it has one |
| A group plus a loose piece | The bounds centre of all of them                           | Rotation 0, scale 1, no name                           |

Evidence for the first row: the cube, vent and ramp above saved `location` values that all subtract to the point `GroupSelection` gave for those pieces in that run (1079.956, 864.873, 5572.327; see the note on that row). For the second row, the case e group saved its first cube as (−5400, −1300, −1200): the world offset from the frame, not turned by the frame's yaw and not divided by its scale. `rotation` and `scale` stay the item's world values in every case.

Saving changes nothing in the level. After the mixed save, the group still selected with its own frame and name, as the game's help text says it should. Items keep their selection order in the file. Joins are not saved: a joined pair saved no parent key, and spawned with no parent.

## Spawning a prefab

`spawnprefab` keeps every offset in the file, and every item's rotation and scale. Only the frame's position is new. The items arrive selected, as one group, with `group.rotation` and `group.scale` as the frame's rotation and scale and `group.name` as its name (empty if the file has none). One Undo right after the spawn removes all of it. A re-save of the spawned items matched the original `properties`, `meshes` and `paint` exactly, and locations to 12 digits.

Where it lands, in 16 spawns of two prefabs: the frame sits on the line through the game's camera along the view direction, far enough along that the items' box is 500 cm ahead of the camera at its nearest point along the view. "The game's camera" is `PlayerCameraManager`'s location. It sits 300 cm behind the editor pawn in world x whichever way it looks, and the pawn's location is what `editorcam` reports.

| `qatwo` (two cubes 2000 cm apart), camera at pawn (0, 0, 10000) | Frame                 | Check                                         |
| --------------------------------------------------------------- | --------------------- | --------------------------------------------- |
| Pitch 0, yaw 0                                                  | (1700, 0, 10000)      | −300 + 500 + 1500 (the box's half width)      |
| Pitch 0, yaw 90                                                 | (−300, 1000, 10000)   | 500 + 500 (its half depth)                    |
| Pitch 0, yaw 180                                                | (−2300, 0, 10000)     | −300 − 500 − 1500                             |
| Pitch −20, yaw 0                                                | (1655.08, 0, 9288.41) | 500 + 1500 cos 20 + 500 sin 20 along the view |
| Pitch −60, yaw 0                                                | (541.51, 0, 8542.47)  | 500 + 1500 cos 60 + 500 sin 60 along the view |

Moving the camera moves the frame by the same amount. The box is the items', not the frame's. A file with both items shifted 5000 cm in x put the frame 5000 cm back and the items exactly where they were. A group saved with its frame far from its members spawned with the frame just as far from them.

The game's help text says new items use Default pivots. I didn't check that.

## Hand-written prefabs

Each case started from a real saved file and changed one thing. A refusal changes nothing in the level. The reply is the console's text.

| Change                                                                                                                | Game                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| No `group`, `group` without `rotation` or `scale`, a `group.scale` axis of 0, one item, `version` 2, another `format` | "Expected a BallestPrefab version 1 document with a valid group and 2 to 4096 items."  |
| No `properties` on an item                                                                                            | "Item 0 has an invalid transform, unknown property, or incorrect property value type." |
| A property the class lacks, or a number for a bool                                                                    | The same                                                                               |
| Four numbers in `rotation`, or a scale of 0                                                                           | The same                                                                               |
| No `meshes`                                                                                                           | "A prefab item has invalid meshes."                                                    |
| `MP_PlayerStart` in the file                                                                                          | "MP_PlayerStart is forbidden in prefabs. ..."                                          |
| A class that doesn't exist                                                                                            | "A prefab item must reference a concrete level-editor item class."                     |
| `group.name` with a space                                                                                             | "A prefab group name must contain 1 to 64 letters A-Z or digits 0-9."                  |
| `properties: {}` or `meshes: []`                                                                                      | Spawns; the class's defaults fill in, and a re-save writes them                        |
| No `paint`                                                                                                            | Spawns, with the materials from `meshes`                                               |
| `paint` for one material and `meshes` naming another                                                                  | Spawns with `paint`'s material                                                         |
| `paint` category `null` with a material in `meshes`                                                                   | Spawns with the material from `meshes`                                                 |
| A class path in the `/Script/Engine.BlueprintGeneratedClass'...'` wrapper                                             | Spawns                                                                                 |
| Unknown keys on the root or an item                                                                                   | Spawns                                                                                 |
| `group.rotation` 10, 20, 30, or `group.scale` 2, 2, 2                                                                 | Spawns, frame as written (order pitch, yaw, roll)                                      |

From the console: one selected piece gives "Select 2 to 4096 items before saving a prefab.", the start in the selection gives the `MP_PlayerStart` message, and an existing name asks for `confirm`. `saveprefab <name> confirm` with nothing pending refuses.

## Files written by the app

Run on 2026-11-05, slot 1, against the same build. Each file went through `MapCodec` and `domain/prefab.ts`.

- A prefab of two cubes and an air vent, written by `encodePrefab`, spawned as 3 items with their offsets, rotations, scales and `group.name`.
- `saveprefab` of that group, and of two loose cubes (one at yaw 30, scale 2, 1, 1), decoded and encoded again byte for byte.
- For the loose cubes, `prefabOfItems` gave the same `location` values as the game's file, to every digit: (−1058.0127018922194, −566.5063509461097, −650) and (441.9872981077806, 133.4936490538903, −350).

## What this means for translation

- A top-level group in the editor becomes one entry in `editorState.groups`, with every item below it in `members`. Nesting is ours alone.
- A prefab instance in a map is its items plus, if it should act as a unit, one group. The game has no record that items came from a prefab.
- Frames are cheap to get right: bounds centre, identity, scale 1, never a zero axis.
- Group of one: avoid it. A single item needs no group, and writing one takes pivots away from it.
- Everything in `editorState` is gone after a save in the game, so groups can't be the only copy of the editor's structure. #112 (the sidecar) is where nesting and prefab links would have to live.
- A prefab exported from the editor needs `group`, and `properties` and `meshes` on every item, even empty. It holds 2 to 4096 items and never the start.

## What I could not measure

- **A gizmo drag with the mouse.** Every transform went through the panel's function. A drag may well behave the same, but I didn't see it.
- **Shift+G.** I can't say what key ungroups. Posted Shift+G, Ctrl+Shift+G, Alt+G and G all did nothing, while posted Ctrl+G grouped. I have no proof a posted Shift reaches the game, and there is no xdotool on this Wayland desktop to send a real one. `UngroupSelection` works and `UngroupSelectionShortcut` exists. The shortcut does nothing through `editor call`, with or without a modifier posted, and neither does `GroupSelectionShortcut`. The editor's hint panel lists no group key. One keypress in the real game would settle it.
- **Removing one member behind the game's back.** The host's `ReplacePieces` takes a list of pieces to remove, but the driver plugin doesn't expose it, and no player can do this.
- **The other coordinate mode** on a group.
- **What the game would write for `frame`.** It still writes no groups, so this page reads the frame from the gizmo and panel, and the file shape stays the one the game accepts.
- **Mirrored pieces in a prefab.** A text, name or string property wouldn't show up either, though no class in the catalog has one.
- **Whether a real game's save keeps groups.** Same caveat as [save-roundtrip.md](save-roundtrip.md): every save here ran in a sandboxed slot.

## Traps for the next person

- `GetSelectionTransformPropertyValue 1` returns roll, pitch, yaw, as a vector's x, y, z. `ApplyTransformUITextEdit` takes a rotator: pitch, yaw, roll. A `v:` argument writes the numbers in the order you give.
- `GroupSelectionShortcut` through `editor call` answers `ok` and does nothing. Use `GroupSelection`.
- `tap` only reaches widgets: over the viewport it says "nothing clickable there". For a pick, `hover x y`, then `callx SKGMLEHandlerComponent FindAndGrab PersistentLevel | b:0 | b:0`, then `hover off`.
- Undo takes a selection change first. After `editor select`, one Undo doesn't remove a spawn.
- `piece_measure` builds its box from the six face centres, so on a turned piece it is smaller than the piece's real world box. That cost me a false mismatch against the frame.
- `editor` reports `camera=` for the pawn, and its `spawn=` is the host's own guess. Neither is where a prefab lands.
- A blank map still lists two pieces (`BP_Checkpoint`, `MP_PlayerStart_00`). Check the count.
