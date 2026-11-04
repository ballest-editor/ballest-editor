# QA: the piece budget

Measured 2026-11-04 on game 0.4.1 with the game driver (host 0.33.2, slot 4). Everything below comes from a running copy unless it says otherwise.

## Result

The game has no piece budget. Every piece still carries a `BudgetCost` and the header still shows a budget bar, but nothing counts the cost, nothing compares it to the limit, and nothing is refused. The bar stays empty.

So the app should not charge a budget, and it doesn't. It has no budget code at all, and this report adds none: a limit the game doesn't have would refuse maps that load, and five published maps in `samples/` would fail it.

While testing what happens to a very large map, I hit two real limits the app missed. The game's loader stops at 2,000,000 JSON values or 67,108,864 characters per file, and past either it opens a blank map with no message. The app now refuses to export past them (§ The real limits).

## What the game does

| Question               | Measured                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The limit              | `SKGMLEDeveloperSettings.MaximumMapBudget` is 300 (the settings constructor writes `0x12c` at `0x144f9f624`). Nothing that reads it stops anything.                                                       |
| The game's counter     | `AllocatedBudget` stayed 0 in every test: on load, after palette placement, paste and prefab spawn, and at 100,000 cost. `GetCurrentlySpentBudget` returns that field, so it is 0 too.                    |
| The header's bar       | `BudgetBar.Percent` stayed 0, an empty grey bar. The word "budget" is always there.                                                                                                                       |
| At the limit           | Nothing happens. With the host's `editor budget 1` setting the limit to 1, palette clicks and a paste all placed at 483 of 1. No message, and the frame shows no warning.                                 |
| Over budget on open    | Maps at 325, 2,400 and 100,000 cost opened normally (the last is 5,000 Rect Lights, in 9 s). No message.                                                                                                  |
| Over budget in play    | A map at 2,401 starts a test run exactly as a map at 1 does. The first attempt failed only because the probe map had no Goal.                                                                             |
| Over budget on save    | A map at 2,400 saved all 501 items. The file has no budget field.                                                                                                                                         |
| Over budget on publish | Not a blocker. See below.                                                                                                                                                                                 |
| Scale                  | No effect. Cube at 0.05 and 20, Rect Light and Decal Picker at 10: `BudgetCost` and `GetItemBudgetCost` unchanged.                                                                                        |
| Mirroring              | No effect. Bevel with Mirror X, Bevel with Mirror Y, Paddle with Mirror X: cost unchanged, map total still 36.                                                                                            |
| Properties             | No effect, shadows included. See § Properties.                                                                                                                                                            |
| Groups and joins       | No effect. A named group of three cubes and a join (two pieces parented) left the total alone. The group lived in the editor only: a group made in game isn't saved at all (`docs/qa/save-roundtrip.md`). |
| Prefabs                | A prefab is the sum of its pieces. One holding a Rect Light, a Decal Picker and a bevel added 31 on each spawn, and the prefab itself adds nothing.                                                       |

The cost totals above come from adding up each piece's `BudgetCost` (the host's `editor budget`), because the game's own total is always 0.

### Why nothing happens

Disassembly of `Ballest-Win64-Shipping.exe`, from the addresses `fnbytes` reports:

- `IsUnderBudgetAfterChange` decodes its argument and writes a constant: `mov BYTE PTR [rsi],0x1`. It answered true for +1,000 and +2,147,483,647.
- `UpdateBudget` decodes `BudgetDelta`, ignores it, and returns `AllocatedBudget` without writing it.
- `InitializeBudget` returns `AllocatedBudget` (or -1 without a world). It counts nothing.
- The only 4-byte write to `AllocatedBudget` (`+0x3b8`) in the 1 MB of code around the handler is the constructor zeroing it. Nothing there broadcasts `OnAttemptToExceedMaxBudget`.

The header's Blueprint is still connected. Calling its handlers by hand sets the bar to value / 300 (150 gives 0.5, 300 gives 1), and the bar turns solid blue. `OnAttemptToExceedMaxBudget_Handler` shows no text. So this is a feature switched off in native code, and an update could switch it back on. If that happens, this report's table is the place to start, and the limit and costs need measuring again.

### Properties

A piece's properties don't change its cost on 0.4.1, and that includes lights that cast shadows. The first version of this report didn't test this. It was added after the question came up in review.

- **Shadows from a file.** All five light classes, with `bLightCastsShadows` true and false: the live flag followed the file and the cost didn't move (Point Light 10, Spot Light 10, Rect Light 20, `MP_PointLightFixture` 15, `MP_SpotLightFixture` 20).
- **Shadows from the panel.** "Casts Shadows" through the checkbox's own event on a Rect Light, off to on: the flag flipped and `BudgetCost`, `GetItemBudgetCost` and `AllocatedBudget` didn't change. I ran this on that one light, in that direction.
- **Every other property.** All 16 classes with properties of their own, each with every one of them changed from its default: no cost differs.
- **The bytecode.** `BudgetCost` is a Blueprint variable, and `GetItemBudgetCost` is 38 bytes that return it. I scanned the scripts of `BP_BaseItem_C`, those 16 classes and the four property widgets for the variable's address. The only reference is `GetItemBudgetCost` itself, so no property handler, construction script or event graph there writes the cost.

Shadows do matter to the game in another way: `BallestUGCLightComponent` has `bDisableShadowsOnNewPlacement`, and a Point, Spot or Rect Light placed from the palette starts with shadows off. That looks like a rendering decision. It doesn't touch the budget number.

This was also a difference from the app: `catalog.json` gives the Spot and Rect Lights `bLightCastsShadows` true, their Blueprint default, so a new one in the app cast shadows and the game's didn't. The app's placement now writes false for every light (docs/FORMAT.md § 0.4.1).

### Publishing

`WBP_LevelSubmission_C.IsLevelDataSubmittable` on the 2,400 map returned five blockers: no screenshot, not validated, no route tag, no difficulty tag, track under 3 seconds. Its message table (the string constants in `BlockerEnumsToErrorMessages`) has eight messages, none about budget:

- You must choose exactly 1 Difficulty Tag
- You must choose exactly 1 Routes Tag
- You must be connected to steam to upload a track!
- You need to take a screenshot for your track
- Your track must be longer than 3 seconds!
- Please give your track a valid name!
- Please add at least 2 tags!
- Please validate your track!

The published maps agree. Priced with the table below, 5 of the 24 sample maps are over 300, and all five are Workshop `.ballmap` files:

| Map                 | Items |  Cost |
| ------------------- | ----: | ----: |
| Ballest Of The Mall | 3,750 | 3,757 |
| Giga Tree           | 2,755 | 2,753 |
| Cube Void           | 1,223 | 1,221 |
| Elevation Fight     |   468 |   466 |
| A08 Lover 3         |   427 |   381 |

## The real limits

Past either limit the game drops the whole map. The Create page opens the editor on the default new map (`MP_PlayerStart_00` and a Goal) with no error on screen.

| Limit                |      Loads |  Blank map | The exe's string                                                 |
| -------------------- | ---------: | ---------: | ---------------------------------------------------------------- |
| JSON values per file |  2,000,000 |  2,000,001 | `Serialized level JSON exceeds the maximum value count of %lld.` |
| Characters per file  | 67,108,864 | 67,108,865 | `Serialized level JSON exceeds the %d-character safety limit.`   |

Those exact boundaries are from the hard-limits QA (thread fc38b35a, slot 3), which read the constants from the exe and tested each one with padded files. It also found that the character limit counts characters, not bytes. I reached the value limit separately, from the other direction, by bisecting real item counts:

| Item                              | Values each | Largest accepted | Values in the file | Smallest rejected | Values in the file |
| --------------------------------- | ----------: | ---------------: | -----------------: | ----------------: | -----------------: |
| Bare (no mesh components)         |          24 |           83,331 |          1,999,984 |            83,332 |          2,000,008 |
| A cube copied from a Workshop map |          33 |           60,605 |          1,999,996 |            60,606 |          2,000,029 |

Every value counts: each object, array, string, number and boolean, anywhere in the file. The second row was a prediction before it was a measurement: 2,000,000 / 33 said the first rejected count would be 60,606, and it was. These files were compact JSON, which is why they stayed under the character limit at 52.7 MB.

The character limit is the one a real map meets first, because it counts whitespace and the game's layout is tabs, CRLF and a line per brace. Workshop items average 1,439 characters and 35 values (9,517 items in 19 maps), so a real map stops near 46,600 items on characters and 57,000 on values. The 100,000 items in docs/FORMAT.md § Hard limits can't be reached by a map the app writes: an item with every field and no mesh components has 24 values, so nothing gets past 83,331 items. (I didn't test whether the game takes items with fields left out.)

The largest sample, Ballest Of The Mall, has 5,640,696 characters and 133,226 values, 8.4 % and 7 % of the limits. No map is close, but a generated one could be, and the failure is silent. The hard-limits QA also found that saving over the file from that blank map replaces the real one, so a player who doesn't notice loses the map.

Before this change the app only counted items, so the app would write such a map without complaint. Now it refuses. Every Save goes through `MapExporter.prepare`, which runs the value check on the map as written, with the `editorState` it adds, and the character check on the encoded text. Export and Play can copy a file that skipped Save, so main runs the character check again on the bytes it copies (`MapExports.exportMap`).

## The app against the game

|                      | Game                              | App                                                  |
| -------------------- | --------------------------------- | ---------------------------------------------------- |
| Per-piece cost       | `BudgetCost`, unused              | Not carried                                          |
| Budget limit         | 300, not enforced                 | None                                                 |
| What the player sees | An empty bar                      | Nothing                                              |
| Items per map        | 83,331 at most, in practice fewer | 100,000 on paste (`store.ts`), and 100,000 on export |
| JSON values per file | About 2,000,000, then a blank map | 2,000,000 on export, with a message (new)            |

The app doesn't carry the costs. Nothing reads them yet, and a table with no reader goes stale while looking authoritative. Issue #98 plans a budget meter for expensive items, and the table below is its starting data if that goes ahead. It would have to be a hint about cost, not a limit, because the game refuses nothing. It may not cover luminous materials, which #98 also names: I didn't test paint.

The paste check still uses the item count, so a paste can take a map past these limits, and the map then fails at export with the message above. Encoding the map on every paste didn't seem worth it for maps nobody has come near.

## Not verified

- **The date.** The host's source says the 2026-10-06 update removed the budget. I can't confirm the date. The samples are consistent with it (no map over 300 has a `createdAt` before then), but that is weak evidence.
- **Upload.** Nothing was published. The sandbox blocks the network, and a slot should never publish. The publish result comes from the game's own checks, so a server-side limit would not show up here, although the five published maps argue against one.
- **The ninth blocker.** `ESubmissionBlocker` has nine values and I found eight messages. The unnamed one could be unused or could have no text.
- **The disassembly's reach.** I scanned the 1 MB around the handler, not the whole exe. The behaviour tests are what back the claim that nothing enforces the budget.
- **Accepted, at the edge.** Above 50,000 items "accepted" means the game went busy spawning instead of showing the blank map. 5,001, 20,000 and 50,000 items were seen fully loaded. The maps at the edge were not, and one run at 80,000 had not finished after 400 s, so whether they are usable is unknown.
- **`.ballmap` and Workshop loading.** The limits were measured on `.balledit` drafts opened from the Create page. Playback of a published map may take another path.
- **A real map at the character limit.** The 46,600 figure is arithmetic from the samples' average. Only padded files have been tested at that limit.
- **Coverage of scale and mirroring.** I tested the pieces listed, not every piece. Every instance of a class read the same, so I expect the rest to match, but I couldn't read the class defaults directly (the host found no `Default__` object). Mirroring on both axes wasn't tried.
- **Paint and surfaces.** No test changed them and read the cost. The bytecode scan found nothing that would, but only a test settles it for #98's luminous materials.
- **Earlier builds.** All of this is 0.4.1. I can't say how a build that still had a working budget priced shadows.
- **The bytecode scan's reach.** It covers the classes named in § Properties. `BP_Elevator_C`, `BP_SpinningCylinder_C` and `BP_PhysicsPaddle_C` declare no functions of their own in the dump, so only the value sweep covers them. A class outside the scan could still write the variable, though no test showed a cost change.

## Corrections to what I was told

- The plugin manager's docs say each piece counts 1 and checkpoints 0. Not so: lights and decals cost 10 or 20, and only the Goal and the player start cost 0. Checkpoint Strip and Checkpoint Disc cost 1.
- The host's `editor.hpp` says it has the handler recount with `InitializeBudget`. That function counts nothing on this build.
- The brief assumed the app charges budget and enforces a limit. It does neither.

## Costs

`BudgetCost` read from a live instance of every class, by exact object name, with `GetItemBudgetCost` agreeing on all of them. Summed, they match the host's total for the map with every class in it (325). The player start costs 0.

### Palette (140 pieces)

Five pieces differ from 1: Goal 0, Decal Picker 10, Point Light 10, Spot Light 10, Rect Light 20. The fake lights cost 1.

| Category   | Piece                  | Class                                         | Cost |
| ---------- | ---------------------- | --------------------------------------------- | ---: |
| Ramps      | Curve1 S               | `BP_Ramp_Curve_Short1`                        |    1 |
| Ramps      | Curve1 M               | `BP_Ramp_Curve1`                              |    1 |
| Ramps      | Curve1 L               | `BP_Ramp_Curve_Long1`                         |    1 |
| Ramps      | Curve2 M               | `BP_Ramp_Curve2`                              |    1 |
| Ramps      | Curve2 S               | `BP_Ramp_Curve_Short2`                        |    1 |
| Ramps      | Curve2 L               | `BP_Ramp_Curve_Long2`                         |    1 |
| Ramps      | Kicker1 S              | `BP_Ramp_Kicker1_Short`                       |    1 |
| Ramps      | Kicker1 M              | `BP_Ramp_Kicker1`                             |    1 |
| Ramps      | Kicker2 S              | `BP_Ramp_Kicker2_Short`                       |    1 |
| Ramps      | Kicker2 M              | `BP_Ramp_Kicker2`                             |    1 |
| Ramps      | Bevel_C Hump S         | `Bevel_Half_ShallowCornerHump`                |    1 |
| Ramps      | Bevel_C Hump D         | `Bevel_Half_SteepCornerHump`                  |    1 |
| Ramps      | Bevel_C Scoop D        | `Bevel_Half_DeepCornerScoop`                  |    1 |
| Ramps      | Bevel_C Scoop S        | `Bevel_Half_ShallowCornerScoop`               |    1 |
| Ramps      | Bevel_F Kicker Stub    | `Bevel_Full_StubKicker`                       |    1 |
| Ramps      | Bevel_F Kicker S       | `Bevel_Full_ShallowKicker`                    |    1 |
| Ramps      | Bevel_F Kicker M       | `Bevel_Full_Kicker`                           |    1 |
| Ramps      | Bevel_F Scoop M        | `Bevel_Full_ShortScoop`                       |    1 |
| Ramps      | Bevel_F Scoop L        | `Bevel_Full_MediumScoop`                      |    1 |
| Ramps      | Bevel_F Scoop S1       | `Bevel_Full_ShallowScoop`                     |    1 |
| Ramps      | Bevel_F Scoop S2       | `Bevel_Full_ShallowShortScoop`                |    1 |
| Ramps      | Bevel_F SideRamp L     | `Bevel_Full_ShallowSideKicker_R`              |    1 |
| Ramps      | Bevel_F SideRamp R     | `Bevel_Full_ShallowSideKicker_L`              |    1 |
| Ramps      | Bevel_F RingScoop      | `Bevel_Full_RingScoop`                        |    1 |
| Ramps      | Bevel_F CScoop L       | `Bevel_Full_ShortUScoop_L`                    |    1 |
| Ramps      | Bevel_F CScoop R       | `Bevel_Full_ShortUScoop_R`                    |    1 |
| Ramps      | Bevel_F RingKicker     | `Bevel_Full_HalfRingKicker`                   |    1 |
| Ramps      | Round Curve Up         | `BP_Ramp_Round_CurveUp`                       |    1 |
| Ramps      | Round Curve Down       | `BP_Ramp_Round_CurveDown`                     |    1 |
| Ramps      | CornerRamp             | `MP_SM_CornerScoop`                           |    1 |
| Tracks     | Track S                | `BP_Track_Short1`                             |    1 |
| Tracks     | Track L                | `BP_Track_Long1`                              |    1 |
| Tracks     | Curve S                | `BP_Track_Curve_Tiny1`                        |    1 |
| Tracks     | Curve M                | `BP_Track_Curve1`                             |    1 |
| Tracks     | Curve L                | `BP_Track_Curve_Large1`                       |    1 |
| Tracks     | Track M                | `BP_Track_Mid1`                               |    1 |
| Tracks     | Bevel_F Straight       | `Bevel_Full_Straight`                         |    1 |
| Tracks     | Bevel_F Cap            | `BP_Bevel_Full_Cap`                           |    1 |
| Tracks     | Bevel_F Turn           | `Bevel_Full_Turn`                             |    1 |
| Tracks     | Bevel_H Cap            | `Bevel_Half_Cap`                              |    1 |
| Tracks     | Bevel_F Branch         | `Bevel_Full_Branch`                           |    1 |
| Tracks     | Bevel_C Concave Flat S | `Bevel_Half_ConcaveCornerCurveFlat`           |    1 |
| Tracks     | Bevel_C Concave Flat L | `Bevel_Half_TightConcaveCornerCurveFlat`      |    1 |
| Tracks     | Bevel_C Convex Flat    | `Bevel_Half_ConvexCornerCurveFlat`            |    1 |
| Tracks     | Bevel_C Straight       | `Bevel_Half_CornerStraight`                   |    1 |
| Tracks     | Bevel_H Platform       | `Bevel_Half_Platform`                         |    1 |
| Tracks     | Bevel_H Straight       | `Bevel_Half_Straight`                         |    1 |
| Tracks     | Bevel_H Turn           | `Bevel_Half_Turn`                             |    1 |
| Tracks     | Bevel_T Branch         | `Bevel_Tall_Branch`                           |    1 |
| Tracks     | Bevel_T Cap            | `Bevel_Tall_Cap`                              |    1 |
| Tracks     | Bevel_TC Concave       | `Bevel_Tall_CornerConcave`                    |    1 |
| Tracks     | Bevel_TC Straight      | `Bevel_Tall_CornerStraight`                   |    1 |
| Tracks     | Bevel_T Podium         | `Bevel_Tall_Podium`                           |    1 |
| Tracks     | Bevel_T Platform       | `Bevel_Tall_StraightPlatform`                 |    1 |
| Tracks     | Bevel_T Sheer          | `Bevel_Tall_SheerStraight`                    |    1 |
| Tracks     | Bevel_T Wall           | `Bevel_Tall_StraightWall`                     |    1 |
| Tracks     | Bevel_T Ring           | `Bevel_Tall_Ring`                             |    1 |
| Tracks     | Bevel_H SCurveL        | `Bevel_Half_SSurveL`                          |    1 |
| Tracks     | Bevel_H SCurveR        | `Bevel_Half_SSurveR`                          |    1 |
| Tracks     | Round Straight         | `BP_Track_Round_Straight`                     |    1 |
| Tracks     | Round Curve            | `BP_Track_Round_Curve`                        |    1 |
| Tracks     | Bevel_F FlatRing       | `Bevel_Full_Ring`                             |    1 |
| Pipes      | Half Tiny1             | `BP_Pipe_Half_Tiny1`                          |    1 |
| Pipes      | Half1                  | `BP_Pipe_Half1`                               |    1 |
| Pipes      | Half Large1            | `BP_Pipe_Half_Large1`                         |    1 |
| Pipes      | Quarter Straight       | `BP_Pipe_Quarter_Straight`                    |    1 |
| Pipes      | Quarter Curve Small    | `BP_Pipe_Quarter_Small`                       |    1 |
| Pipes      | Quarter Curve Large    | `BP_Pipe_Quarter_Large`                       |    1 |
| Pipes      | Pipe                   | `BP_Pipe_Tube1`                               |    1 |
| Pipes      | Half tunnel            | `MP_TunnelHalf`                               |    1 |
| Props      | Bevel Bumper           | `Bevel_Bumper`                                |    1 |
| Props      | Bevel Bumper M         | `Bevel_BumperLongSingle`                      |    1 |
| Props      | Bevel Bumper L         | `Bevel_BumperLongDouble`                      |    1 |
| Props      | Bevel_P Rail           | `Bevel_Rail`                                  |    1 |
| Props      | Rounded Bumper         | `MP_RoundedBumper`                            |    1 |
| Scenery    | Bevel_S Arch T         | `Bevel_Arch`                                  |    1 |
| Misc       | Pinched Bridge         | `BP_Misc_Pinched1`                            |    1 |
| Misc       | Flat Ring              | `MP_FlatRing`                                 |    1 |
| Misc       | Rounded Torus          | `MP_RoundedTorus`                             |    1 |
| Misc       | Hole                   | `MP_SM_Hole`                                  |    1 |
| Shapes     | Cube                   | `BP_Prim_Cube`                                |    1 |
| Shapes     | Cylinder               | `BP_Prim_Cylinder`                            |    1 |
| Shapes     | Cone                   | `MP_Cone`                                     |    1 |
| Shapes     | Pyramid                | `MP_Pyramid`                                  |    1 |
| Shapes     | Capsule                | `BP_GlossyRed_Capsule`                        |    1 |
| Shapes     | Capsule Flat Bottom    | `BP_GlossyRed_Capsule_FlatBottom`             |    1 |
| Shapes     | Eighth Sphere          | `BP_GlossyRed_EighthSphere`                   |    1 |
| Shapes     | H Capsule              | `BP_GlossyRed_HalfCapsule`                    |    1 |
| Shapes     | H Capsule Flat Base    | `BP_GlossyRed_HalfCapsule_FlatBottom`         |    1 |
| Shapes     | H Sphere               | `BP_GlossyRed_HalfSphere`                     |    1 |
| Shapes     | Q Capsule              | `BP_GlossyRed_QuarterCapsule`                 |    1 |
| Shapes     | Q Capsule Flat Base    | `BP_GlossyRed_QuarterCapsule_FlatBottom`      |    1 |
| Shapes     | Q Sphere               | `BP_GlossyRed_QuarterSphere`                  |    1 |
| Shapes     | Sphere                 | `BP_GlossyRed_WholeSphere`                    |    1 |
| Special    | Rubber Block           | `RubberBlock2_M_PlasticBase`                  |    1 |
| Special    | Rubber Cylinder        | `RubberCylinder`                              |    1 |
| Special    | Air Vent               | `MP_AirVent`                                  |    1 |
| Special    | Glass Flat             | `MP_FlatGlassPlane`                           |    1 |
| Special    | Glass Curved           | `MP_RoundedGlassPlane1`                       |    1 |
| Special    | Elevator               | `BP_Elevator`                                 |    1 |
| Special    | Spinning Cylinder      | `BP_SpinningCylinder`                         |    1 |
| Special    | Paddle                 | `BP_PhysicsPaddle`                            |    1 |
| Bowls      | Shallow Bowl           | `MP_ShallowBowlV2`                            |    1 |
| Bowls      | Hole Bowl              | `BP_Bowl_RingScoop`                           |    1 |
| Bowls      | Cone Bowl              | `MP_SM_ConeBowl`                              |    1 |
| Bowls      | M Full Bowl            | `MP_SM_FullMediumBowl`                        |    1 |
| Bowls      | Quarter Hole Bowl      | `MP_SM_QuarterShallowHoleBowl`                |    1 |
| Bowls      | Half Hole Bowl         | `MP_SM_HalfShallowHoleBowl`                   |    1 |
| Bowls      | M Quarter Bowl         | `MP_SM_QuarterMediumBowl`                     |    1 |
| Objectives | Checkpoint Strip       | `MP_ActualCheckpoint_Strip`                   |    1 |
| Objectives | Goal                   | `BP_Checkpoint`                               |    0 |
| Objectives | Checkpoint Disc        | `MP_ActualCheckpoint_Disc`                    |    1 |
| Decals     | Decal Picker           | `BP_UGCCircuitDecal`                          |   10 |
| Tubes      | Bend H 25              | `BP_GlossyRed_Half_TubeLong_Straight_Bend_25` |    1 |
| Tubes      | Bend H 45              | `BP_GlossyRed_Half_TubeLong_Bend_45`          |    1 |
| Tubes      | Bend H 90              | `BP_GlossyRed_Half_TubeLong_Bend_90`          |    1 |
| Tubes      | Curve H 25             | `BP_GlossyRed_Half_TubeLong_Curve_25`         |    1 |
| Tubes      | Curve H 45             | `BP_GlossyRed_Half_TubeLong_Curve_45`         |    1 |
| Tubes      | Curve H 90             | `BP_GlossyRed_Half_TubeLong_Curve_90`         |    1 |
| Tubes      | H Straight             | `BP_GlossyRed_Half_TubeLong_Straight`         |    1 |
| Tubes      | Bend F 25              | `BP_GlossyRed_TubeLong_Bend_25`               |    1 |
| Tubes      | Bend F 45              | `BP_GlossyRed_TubeLong_Bend_45`               |    1 |
| Tubes      | Bend F 90              | `BP_GlossyRed_TubeLong_Bend_90`               |    1 |
| Tubes      | Curve F 25             | `BP_GlossyRed_TubeLong_Curve_25`              |    1 |
| Tubes      | Curve F 45             | `BP_GlossyRed_TubeLong_Straight_Curve_45`     |    1 |
| Tubes      | Curve F 90             | `BP_GlossyRed_TubeLong_Curve_90`              |    1 |
| Tubes      | F Straight Long        | `BP_GlossyRed_TubeLong_Straight`              |    1 |
| Tubes      | Corner F 25            | `BP_GlossyRed_Tube_Bend_25`                   |    1 |
| Tubes      | Corner F 45            | `BP_GlossyRed_Tube_Bend_45`                   |    1 |
| Tubes      | Corner F 90            | `BP_GlossyRed_Tube_Bend_90`                   |    1 |
| Tubes      | Funnel                 | `BP_GlossyRed_Tube_Funnel`                    |    1 |
| Tubes      | F Straight Short       | `BP_GlossyRed_Tube_Straight`                  |    1 |
| Lights     | Point Light            | `MP_RawPointLight`                            |   10 |
| Lights     | Spot Light             | `MP_RawSpotLight`                             |   10 |
| Lights     | Rect Light             | `MP_RawRectLight`                             |   20 |
| Lights     | Fake Spotlight 1       | `MP_LightCard_01`                             |    1 |
| Lights     | Fake Spotlight 2       | `MP_LightCard_02`                             |    1 |
| Lights     | Fake Point Light       | `MP_LightCard_03`                             |    1 |
| Lights     | Fake Rect Light        | `MP_LightCard_04`                             |    1 |
| Hazards    | Laser                  | `MP_LaserTerminal`                            |    1 |

### Hidden classes (96, spawnable from a file)

| Cost | Classes                |
| ---: | ---------------------- |
|   20 | `MP_SpotLightFixture`  |
|   15 | `MP_PointLightFixture` |
|   10 | `BP_UGCShapeDecal`     |
|    2 | `MP_Airvents`          |
|    1 | the other 92           |

`MP_Airvents` also spawns a child `BP_AirVent` that costs 1. `MP_PinballPaddle` isn't in 0.4.1, so it has no cost.

## Reproducing it

`props <Class> PersistentLevel` reads the first instance whose class matches, and subclasses match. `MP_RawPointLight_C` returned an `MP_PointLightFixture` (15, where the real answer is 10), so use `props <Class> <instance name>` and check the reply's first line. docs/DRIVER.md § Reading objects has this and the other traps from this run.
