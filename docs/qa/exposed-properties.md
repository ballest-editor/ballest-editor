# Exposed piece properties: game, catalog and app

Measured on Ballest of Them All 0.4.1 with the game driver (slot 5) on 2026-11-04. "Before" means `main` at #177, the state this work started from. The tables are generated from the measurements. `tools/extract/panel.json` holds the same data for the extractor.

## Result

The game's details panel offers far less than the catalog listed, and the app offered all of it. Before this work:

- Labels were wrong on most rows of the lights and decals. The app said "Light Inner Cone Angle" where the game says "Inner Cone", and "Entry Assist Min Speed" where it says "Entry Boost Speed".
- No number had a range. The game gives every number but its two dropdowns a slider, and stops typed values at limits the app didn't know.
- The app offered a Surface dropdown on all 238 classes. The panel has none on 41 of them, among them the glass, the rubber, the air vent, every light and the physics props.
- The app called `LightAttenuationRadius`, the point light's reach, an ordinary property. The panel has no row for it, and four light classes saved it without the catalog knowing.
- Flip Y was disabled on the spinning cylinder and the paddle. #177 took them to flip on X only, but the game's Flip Y button works on both. It sets `PhysicsFlip`, which the app showed as a separate switch that didn't touch the mesh.

Now the catalog carries the panel, and the inspector offers what the game does. A map built through the app's own factory with 233 classes loaded in the game and saved back with no property differences at all. The three classes left out of that map are the open problem below.

## How it was measured

For each class I placed one piece in the slot's probe map, selected it, and read the panel with `widgets W_ItemsDatas_C`. A read only counted when `TB_Actor` named the selected class. Each slider's `MinValue`, `MaxValue` and `StepSize` came from `props Slider <row>`.

Then, for each thing the panel couldn't say:

- Which property a row edits. I set every row to a distinct value, saved, and read which property moved in the file. Every row is proven this way except the colour channels and the two dropdowns, whose properties the probes below prove by loading values.
- What a typed value does. I called each row's own `OnTextCommitted` handler with a value past each end, 50 rows on 15 classes, then repeated the rows that didn't stop with 10000000 and saved.
- What a file value does. I loaded maps with values past the ends, then saved.
- What the game saves for each class. All 237 classes that still exist were saved by the game, which gives `samples/UserSavedMaps/*palette probe*` and `*hidden probe*`.
- Labels on rows the tree can't read. The colour row is native, so I read "Color" off a render.

The first sweep had a bug worth knowing about. `ui_widgets W_ItemPropertyData_C` takes the first instance and stale ones stay alive, so 38 reads returned another piece's rows. It made the point light look like it had cone angles and the laser look like a light card. I threw those reads away and redid them through `W_ItemsDatas_C`. docs/DRIVER.md records this and an `openmap` trap.

## What the game does

Ranges are fixed per property. A vent at 10000 has the same 1000 to 2250000 slider as one at 750000.

The panel's order is colour, then floats, ints and bools, which isn't the order of the file's lists.

A slider's ends are also the typed limits, with five exceptions that go further, found by committing 10000000 and saving.

| Row                        | Slider max | Typed max |
| -------------------------- | ---------- | --------- |
| Travel height              | 2000       | 10000     |
| Light card Brightness      | 10         | 100       |
| Near Fade Distance         | 2000       | 100000    |
| Intersection Fade Distance | 1000       | 100000    |
| Density                    | 0.01       | 0.02      |

Typing and loading behave differently, and the difference depends on the class. Every row stops a typed value. The air vent keeps whatever the file says (100, 5000000 and -1 all survived a load and a save). The elevator's speed, the decal style, and the paddle's and cylinder's speeds clamp on load and save the clamped value. The app clamps edits and leaves loaded values alone, so it never rewrites a value the player didn't touch.

Two edits move a second property. A spot light's inner cone stops at its outer, and lowering the outer pulls the inner down. Setting a shape decal's Emissive turned `bDecalUseEmissive` on.

Flip Y writes `PhysicsFlip` on the cylinder and paddle. On one axis the paddle saves its baked mirror and the cylinder its flipped cap. On both axes each saves its original.

With several pieces selected the game lists each item's rows separately, and hides Surfaces unless every selected class has them.

## Open problem: three classes the game won't reload

`BP_TwoCubeOneColor`, `BP_TwoCubeTwoColor` and `MP_OrangeSign` load with `meshComponents: []` and full properties, but not with any mesh components, including the ones the game itself saved for them. One such item discards the whole map, which then opens with just a start and a goal. I tested these one at a time.

These are the only three classes whose saves have two mesh components. That matches exactly, but I didn't prove it's the cause.

None are in the palette. The app can still place them from its Hidden section, and it writes mesh components, so a map using one won't load. This PR doesn't fix that. It isn't a property problem, and the right fix needs a decision on what the app should write for them. `hidden probe 2` contains all three, so it's a fixture and won't reopen in the game.

## Not verified

- Colour channels. The picker is native and the driver can't operate it, so no save proves which property each channel writes. The names come from the catalog, and the samples show them saved. The "Color" label was read on the spot light and the shape decal only. The light cards use the same row class.
- A point light's default shadows when placed from the palette. The driver can't place from the palette. Loaded or pasted, it saves shadows on. The catalog keeps off, from the piece placed by hand in the "new pieces probe" of 2026-11-02, and `bDisableShadowsOnNewPlacement` agrees.
- The text box's own validation. I called the commit handler directly because `tap` lands on the panel's deselect guard, so what the box does with something that isn't a number is unknown.
- Emissive back at 0. I only saw it turn `bDecalUseEmissive` on, so the app only turns it on.
- Load behaviour on the lights. Only the rows named above were tried past their ends in a file.
- The inspector in a running app. The slider has been through typecheck, the build and the domain tests, and nobody has dragged it. The repo has no component tests.

## Differences left on purpose

- Multi-select. The app merges what the selection shares and edits it together, where the game lists each item. That's more useful, and each edit still follows the game's rules.
- Properties the catalog doesn't know stay editable, because the game refuses a map carrying one and the player needs a way to see it.
- A dropdown shows a value outside its choices with what the game will load it as.

## Also found

- `MP_Airvents` spawns a child `BP_AirVent`, and the game saves that child as its own item, so a load and a save adds one item.
- `MP_PinballPaddle` is gone from the game, so it has no row in `panel.json` and keeps `optional` on its native properties.
- No class uses the text, name or string lists.
- The new saves add `SM_ProvisionalSpinningPaddles_1` to the catalog's `meshes`. No piece draws it, so the asset pack doesn't need republishing.
- `assets/keybinds.json` doesn't match the game. A clean extraction moves the two gamepad bindings under section 3 from `Gamepad_LeftShoulder` and `Gamepad_RightShoulder` to `Gamepad_DPad_Left` and `Gamepad_DPad_Right`. This PR leaves the file alone.

## Measuring again after a patch

Start a slot, load every class, and repeat the reads above. Use `W_ItemsDatas_C`, check `TB_Actor`, and treat a failed read as unread, never as "no rows". `src/panel.test.ts` in tools/extract fails if a palette piece has no entry.

## Every palette piece

| Piece                  | Class                                         | Flip X/Y in game | Surfaces in game | Own rows in game | Own properties in catalog | App offered, before       |
| ---------------------- | --------------------------------------------- | ---------------- | ---------------- | ---------------- | ------------------------- | ------------------------- |
| Curve1 S               | `BP_Ramp_Curve_Short1`                        | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve1 M               | `BP_Ramp_Curve1`                              | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve1 L               | `BP_Ramp_Curve_Long1`                         | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve2 M               | `BP_Ramp_Curve2`                              | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve2 S               | `BP_Ramp_Curve_Short2`                        | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve2 L               | `BP_Ramp_Curve_Long2`                         | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Kicker1 S              | `BP_Ramp_Kicker1_Short`                       | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Kicker1 M              | `BP_Ramp_Kicker1`                             | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Kicker2 S              | `BP_Ramp_Kicker2_Short`                       | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Kicker2 M              | `BP_Ramp_Kicker2`                             | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_C Hump S         | `Bevel_Half_ShallowCornerHump`                | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_C Hump D         | `Bevel_Half_SteepCornerHump`                  | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_C Scoop D        | `Bevel_Half_DeepCornerScoop`                  | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_C Scoop S        | `Bevel_Half_ShallowCornerScoop`               | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F Kicker Stub    | `Bevel_Full_StubKicker`                       | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F Kicker S       | `Bevel_Full_ShallowKicker`                    | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F Kicker M       | `Bevel_Full_Kicker`                           | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F Scoop M        | `Bevel_Full_ShortScoop`                       | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F Scoop L        | `Bevel_Full_MediumScoop`                      | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F Scoop S1       | `Bevel_Full_ShallowScoop`                     | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F Scoop S2       | `Bevel_Full_ShallowShortScoop`                | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F SideRamp L     | `Bevel_Full_ShallowSideKicker_R`              | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F SideRamp R     | `Bevel_Full_ShallowSideKicker_L`              | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F RingScoop      | `Bevel_Full_RingScoop`                        | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F CScoop L       | `Bevel_Full_ShortUScoop_L`                    | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F CScoop R       | `Bevel_Full_ShortUScoop_R`                    | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F RingKicker     | `Bevel_Full_HalfRingKicker`                   | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Round Curve Up         | `BP_Ramp_Round_CurveUp`                       | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Round Curve Down       | `BP_Ramp_Round_CurveDown`                     | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| CornerRamp             | `MP_SM_CornerScoop`                           | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Track S                | `BP_Track_Short1`                             | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Track L                | `BP_Track_Long1`                              | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve S                | `BP_Track_Curve_Tiny1`                        | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve M                | `BP_Track_Curve1`                             | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve L                | `BP_Track_Curve_Large1`                       | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Track M                | `BP_Track_Mid1`                               | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F Straight       | `Bevel_Full_Straight`                         | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F Cap            | `BP_Bevel_Full_Cap`                           | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F Turn           | `Bevel_Full_Turn`                             | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_H Cap            | `Bevel_Half_Cap`                              | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F Branch         | `Bevel_Full_Branch`                           | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_C Concave Flat S | `Bevel_Half_ConcaveCornerCurveFlat`           | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_C Concave Flat L | `Bevel_Half_TightConcaveCornerCurveFlat`      | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_C Convex Flat    | `Bevel_Half_ConvexCornerCurveFlat`            | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_C Straight       | `Bevel_Half_CornerStraight`                   | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_H Platform       | `Bevel_Half_Platform`                         | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_H Straight       | `Bevel_Half_Straight`                         | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_H Turn           | `Bevel_Half_Turn`                             | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_T Branch         | `Bevel_Tall_Branch`                           | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_T Cap            | `Bevel_Tall_Cap`                              | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_TC Concave       | `Bevel_Tall_CornerConcave`                    | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_TC Straight      | `Bevel_Tall_CornerStraight`                   | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_T Podium         | `Bevel_Tall_Podium`                           | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_T Platform       | `Bevel_Tall_StraightPlatform`                 | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_T Sheer          | `Bevel_Tall_SheerStraight`                    | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_T Wall           | `Bevel_Tall_StraightWall`                     | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_T Ring           | `Bevel_Tall_Ring`                             | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_H SCurveL        | `Bevel_Half_SSurveL`                          | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_H SCurveR        | `Bevel_Half_SSurveR`                          | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Round Straight         | `BP_Track_Round_Straight`                     | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Round Curve            | `BP_Track_Round_Curve`                        | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_F FlatRing       | `Bevel_Full_Ring`                             | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Half Tiny1             | `BP_Pipe_Half_Tiny1`                          | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Half1                  | `BP_Pipe_Half1`                               | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Half Large1            | `BP_Pipe_Half_Large1`                         | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Quarter Straight       | `BP_Pipe_Quarter_Straight`                    | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Quarter Curve Small    | `BP_Pipe_Quarter_Small`                       | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Quarter Curve Large    | `BP_Pipe_Quarter_Large`                       | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Pipe                   | `BP_Pipe_Tube1`                               | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Half tunnel            | `MP_TunnelHalf`                               | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel Bumper           | `Bevel_Bumper`                                | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel Bumper M         | `Bevel_BumperLongSingle`                      | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel Bumper L         | `Bevel_BumperLongDouble`                      | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_P Rail           | `Bevel_Rail`                                  | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Rounded Bumper         | `MP_RoundedBumper`                            | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bevel_S Arch T         | `Bevel_Arch`                                  | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Pinched Bridge         | `BP_Misc_Pinched1`                            | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Flat Ring              | `MP_FlatRing`                                 | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Rounded Torus          | `MP_RoundedTorus`                             | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Hole                   | `MP_SM_Hole`                                  | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Cube                   | `BP_Prim_Cube`                                | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Cylinder               | `BP_Prim_Cylinder`                            | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Cone                   | `MP_Cone`                                     | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Pyramid                | `MP_Pyramid`                                  | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Capsule                | `BP_GlossyRed_Capsule`                        | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Capsule Flat Bottom    | `BP_GlossyRed_Capsule_FlatBottom`             | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Eighth Sphere          | `BP_GlossyRed_EighthSphere`                   | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| H Capsule              | `BP_GlossyRed_HalfCapsule`                    | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| H Capsule Flat Base    | `BP_GlossyRed_HalfCapsule_FlatBottom`         | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| H Sphere               | `BP_GlossyRed_HalfSphere`                     | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Q Capsule              | `BP_GlossyRed_QuarterCapsule`                 | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Q Capsule Flat Base    | `BP_GlossyRed_QuarterCapsule_FlatBottom`      | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Q Sphere               | `BP_GlossyRed_QuarterSphere`                  | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Sphere                 | `BP_GlossyRed_WholeSphere`                    | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Rubber Block           | `RubberBlock2_M_PlasticBase`                  | yes              | no               | 0                | 0                         | Flip X/Y, Surface         |
| Rubber Cylinder        | `RubberCylinder`                              | yes              | no               | 0                | 0                         | Flip X/Y, Surface         |
| Air Vent               | `MP_AirVent`                                  | yes              | no               | 4                | 4                         | Flip X/Y, Surface, 4 own  |
| Glass Flat             | `MP_FlatGlassPlane`                           | yes              | no               | 0                | 0                         | Flip X/Y, Surface         |
| Glass Curved           | `MP_RoundedGlassPlane1`                       | yes              | no               | 0                | 0                         | Flip X/Y, Surface         |
| Elevator               | `BP_Elevator`                                 | yes              | no               | 2                | 2                         | Flip X/Y, Surface, 2 own  |
| Spinning Cylinder      | `BP_SpinningCylinder`                         | yes              | no               | 1                | 2                         | Flip X/Y, Surface, 2 own  |
| Paddle                 | `BP_PhysicsPaddle`                            | yes              | no               | 1                | 2                         | Flip X/Y, Surface, 2 own  |
| Shallow Bowl           | `MP_ShallowBowlV2`                            | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Hole Bowl              | `BP_Bowl_RingScoop`                           | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Cone Bowl              | `MP_SM_ConeBowl`                              | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| M Full Bowl            | `MP_SM_FullMediumBowl`                        | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Quarter Hole Bowl      | `MP_SM_QuarterShallowHoleBowl`                | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Half Hole Bowl         | `MP_SM_HalfShallowHoleBowl`                   | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| M Quarter Bowl         | `MP_SM_QuarterMediumBowl`                     | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Checkpoint Strip       | `MP_ActualCheckpoint_Strip`                   | no               | no               | 0                | 0                         | Surface                   |
| Goal                   | `BP_Checkpoint`                               | no               | no               | 0                | 0                         | Surface                   |
| Checkpoint Disc        | `MP_ActualCheckpoint_Disc`                    | no               | no               | 0                | 0                         | Surface                   |
| Decal Picker           | `BP_UGCCircuitDecal`                          | yes              | no               | 2                | 5                         | Flip X/Y, Surface, 5 own  |
| Bend H 25              | `BP_GlossyRed_Half_TubeLong_Straight_Bend_25` | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bend H 45              | `BP_GlossyRed_Half_TubeLong_Bend_45`          | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bend H 90              | `BP_GlossyRed_Half_TubeLong_Bend_90`          | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve H 25             | `BP_GlossyRed_Half_TubeLong_Curve_25`         | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve H 45             | `BP_GlossyRed_Half_TubeLong_Curve_45`         | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve H 90             | `BP_GlossyRed_Half_TubeLong_Curve_90`         | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| H Straight             | `BP_GlossyRed_Half_TubeLong_Straight`         | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bend F 25              | `BP_GlossyRed_TubeLong_Bend_25`               | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bend F 45              | `BP_GlossyRed_TubeLong_Bend_45`               | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Bend F 90              | `BP_GlossyRed_TubeLong_Bend_90`               | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve F 25             | `BP_GlossyRed_TubeLong_Curve_25`              | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve F 45             | `BP_GlossyRed_TubeLong_Straight_Curve_45`     | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Curve F 90             | `BP_GlossyRed_TubeLong_Curve_90`              | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| F Straight Long        | `BP_GlossyRed_TubeLong_Straight`              | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Corner F 25            | `BP_GlossyRed_Tube_Bend_25`                   | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Corner F 45            | `BP_GlossyRed_Tube_Bend_45`                   | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Corner F 90            | `BP_GlossyRed_Tube_Bend_90`                   | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Funnel                 | `BP_GlossyRed_Tube_Funnel`                    | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| F Straight Short       | `BP_GlossyRed_Tube_Straight`                  | yes              | yes              | 0                | 0                         | Flip X/Y, Surface         |
| Point Light            | `MP_RawPointLight`                            | yes              | no               | 3                | 6                         | Flip X/Y, Surface, 6 own  |
| Spot Light             | `MP_RawSpotLight`                             | yes              | no               | 5                | 7                         | Flip X/Y, Surface, 7 own  |
| Rect Light             | `MP_RawRectLight`                             | yes              | no               | 3                | 7                         | Flip X/Y, Surface, 7 own  |
| Fake Spotlight 1       | `MP_LightCard_01`                             | yes              | no               | 7                | 9                         | Flip X/Y, Surface, 9 own  |
| Fake Spotlight 2       | `MP_LightCard_02`                             | yes              | no               | 7                | 9                         | Flip X/Y, Surface, 9 own  |
| Fake Point Light       | `MP_LightCard_03`                             | yes              | no               | 7                | 9                         | Flip X/Y, Surface, 9 own  |
| Fake Rect Light        | `MP_LightCard_04`                             | yes              | no               | 8                | 10                        | Flip X/Y, Surface, 10 own |
| Laser                  | `MP_LaserTerminal`                            | yes              | no               | 0                | 0                         | Flip X/Y, Surface         |
| Player start           | `MP_PlayerStart`                              | no               | no               | 0                | 0                         | Surface                   |

## Pieces with rows of their own

### Elevator (`BP_Elevator`)

| Game panel                                      | Catalog, before                      | App, before                      |
| ----------------------------------------------- | ------------------------------------ | -------------------------------- |
| Travel height, slider 0 to 2000, typed to 10000 | `PhysicsElevatorExtensionLength` 400 | Travel Height (number, no range) |
| Speed (Slow, Normal, Fast)                      | `PhysicsElevatorSpeedTier` 1         | Speed (number, no range)         |

### Paddle (`BP_PhysicsPaddle`)

| Game panel                  | Catalog, before                  | App, before                               |
| --------------------------- | -------------------------------- | ----------------------------------------- |
| Paddle speed, slider 1 to 5 | `PhysicsPaddleSpeedMultiplier` 1 | Paddle Speed (number, no range)           |
| Flip Y button               | `PhysicsFlip` false              | Physics Flip (switch), not tied to Flip Y |

### Spinning Cylinder (`BP_SpinningCylinder`)

| Game panel                   | Catalog, before               | App, before                               |
| ---------------------------- | ----------------------------- | ----------------------------------------- |
| Spin speed, slider 30 to 180 | `PhysicsCylinderSpinSpeed` 90 | Spin Speed (number, no range)             |
| Flip Y button                | `PhysicsFlip` false           | Physics Flip (switch), not tied to Flip Y |

### BP_SpinningPaddles (`BP_SpinningPaddles`)

| Game panel                     | Catalog, before         | App, before                        |
| ------------------------------ | ----------------------- | ---------------------------------- |
| Paddles / doors, slider 1 to 4 | `PhysicsVariantCount` 1 | Paddles / Doors (number, no range) |

### Decal Picker (`BP_UGCCircuitDecal`)

| Game panel                            | Catalog, before           | App, before                      |
| ------------------------------------- | ------------------------- | -------------------------------- |
| Style (Arrow, Scratch marks, Stripes) | `DecalStyle` 0            | Decal Style (number, no range)   |
| Facing Only (On/Off)                  | `bFacingOnly` true        | Facing Only (switch)             |
| no row                                | `DecalWidth` 200, hidden  | Decal Width* (number, no range)  |
| no row                                | `DecalHeight` 200, hidden | Decal Height* (number, no range) |
| no row                                | `DecalDepth` 100, hidden  | Decal Depth* (number, no range)  |

### BP_UGCShapeDecal (`BP_UGCShapeDecal`)

| Game panel                   | Catalog, before                       | App, before                                 |
| ---------------------------- | ------------------------------------- | ------------------------------------------- |
| Color (swatch)               | `DecalRed`, `DecalGreen`, `DecalBlue` | Decal Color (swatch)                        |
| Tile Spacing, slider -4 to 4 | `DecalTileSpacing` 0                  | Decal Tile Spacing (number, no range)       |
| SDF Size, slider 0.01 to 2   | `DecalSDFSize` 1                      | Decal SDFSize (number, no range)            |
| Edge Softness, slider 0 to 1 | `DecalFillEdgeSoftness` 0             | Decal Fill Edge Softness (number, no range) |
| Emissive, slider 0 to 1000   | `DecalEmissiveIntensity` 0            | Decal Emissive Intensity (number, no range) |
| Shape Type, slider 0 to 4    | `DecalShapeType` 0                    | Decal Shape Type (number, no range)         |
| Fill Type, slider 0 to 2     | `DecalFillType` 0                     | Decal Fill Type (number, no range)          |
| Tile Count, slider 1 to 32   | `DecalTileCount` 1                    | Decal Tile Count (number, no range)         |
| Enabled (On/Off)             | `bDecalEnabled` true                  | Decal Enabled (switch)                      |
| no row                       | `bDecalUseEmissive` false, hidden     | Decal Use Emissive* (number, no range)      |
| no row                       | `DecalWidth` 200, hidden              | Decal Width* (number, no range)             |
| no row                       | `DecalHeight` 200, hidden             | Decal Height* (number, no range)            |
| no row                       | `DecalDepth` 100, hidden              | Decal Depth* (number, no range)             |
| no row                       | `DecalRoughness` 1, hidden            | Decal Roughness* (number, no range)         |
| no row                       | `DecalSpecular` 0, hidden             | Decal Specular* (number, no range)          |

### Air Vent (`MP_AirVent`)

| Game panel                                       | Catalog, before                    | App, before                                       |
| ------------------------------------------------ | ---------------------------------- | ------------------------------------------------- |
| Field Magnitude, slider 1000 to 2250000          | `Field Magnitude` 750000           | Field Magnitude (number, no range)                |
| Entry Boost Speed, slider 0 to 5000              | `EntryAssistMinSpeed` 800          | Entry Assist Min Speed (number, no range)         |
| Upper Airflow Multiplier, slider 0 to 0.5        | `UpperAirflowMultiplier` 0.25      | Upper Airflow Multiplier (number, no range)       |
| Qualified Airflow Target Speed, slider 0 to 5000 | `QualifiedAirflowTargetSpeed` 2000 | Qualified Airflow Target Speed (number, no range) |

### Fake Spotlight 1 (`MP_LightCard_01`), Fake Spotlight 2 (`MP_LightCard_02`), Fake Point Light (`MP_LightCard_03`)

| Game panel                                                    | Catalog, before                             | App, before                                         |
| ------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| Color (swatch)                                                | `LightColorR`, `LightColorG`, `LightColorB` | Light Color (swatch)                                |
| Brightness, slider 0 to 10, typed to 100                      | `LightBrightness` 1                         | Light Brightness (number, no range)                 |
| Opacity, slider 0 to 1                                        | `LightOpacity` 0.25                         | Light Opacity (number, no range)                    |
| Near Fade Distance, slider 1 to 2000, typed to 100000         | `LightNearFadeDistance` 400                 | Light Near Fade Distance (number, no range)         |
| Falloff Power, slider 0.1 to 8                                | `LightFalloffPower` 1                       | Light Falloff Power (number, no range)              |
| Intersection Fade Distance, slider 1 to 1000, typed to 100000 | `LightIntersectionFadeDistance` 100         | Light Intersection Fade Distance (number, no range) |
| Intersection Fade Strength, slider 0 to 1                     | `LightIntersectionFadeStrength` 0           | Light Intersection Fade Strength (number, no range) |

### Fake Rect Light (`MP_LightCard_04`)

| Game panel                               | Catalog, before                             | App, before                              |
| ---------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| Color (swatch)                           | `LightColorR`, `LightColorG`, `LightColorB` | Light Color (swatch)                     |
| Brightness, slider 0 to 10, typed to 100 | `LightBrightness` 2                         | Light Brightness (number, no range)      |
| Density, slider 0 to 0.01, typed to 0.02 | `LightDensity` 0.001                        | Light Density (number, no range)         |
| Edge Softness, slider 0 to 0.49          | `LightEdgeSoftness` 0.12                    | Light Edge Softness (number, no range)   |
| Softness Growth, slider 0 to 0.49        | `LightSoftnessGrowth` 0.12                  | Light Softness Growth (number, no range) |
| End Fade Start, slider 0 to 0.99         | `LightEndFadeStart` 0.7                     | Light End Fade Start (number, no range)  |
| Source Width, slider 0.002 to 0.998      | `LightSourceWidth` 0.35                     | Light Source Width (number, no range)    |
| Source Height, slider 0.002 to 0.998     | `LightSourceHeight` 0.2                     | Light Source Height (number, no range)   |

### Point Light (`MP_RawPointLight`), Rect Light (`MP_RawRectLight`), MP_PointLightFixture (`MP_PointLightFixture`)

| Game panel                    | Catalog, before                       | App, before                                 |
| ----------------------------- | ------------------------------------- | ------------------------------------------- |
| Color (swatch)                | `LightRed`, `LightGreen`, `LightBlue` | Light Color (swatch)                        |
| Brightness, slider 0 to 10000 | `LightBrightness` 1000                | Light Brightness (number, no range)         |
| Casts Shadows (On/Off)        | `bLightCastsShadows` false            | Light Casts Shadows (switch)                |
| no row                        | `LightAttenuationRadius` 1000         | Light Attenuation Radius (number, no range) |

### Spot Light (`MP_RawSpotLight`), MP_SpotLightFixture (`MP_SpotLightFixture`)

| Game panel                    | Catalog, before                       | App, before                               |
| ----------------------------- | ------------------------------------- | ----------------------------------------- |
| Color (swatch)                | `LightRed`, `LightGreen`, `LightBlue` | Light Color (swatch)                      |
| Brightness, slider 0 to 10000 | `LightBrightness` 1000                | Light Brightness (number, no range)       |
| Inner Cone, slider 0 to 80    | `LightInnerConeAngle` 20              | Light Inner Cone Angle (number, no range) |
| Outer Cone, slider 1 to 80    | `LightOuterConeAngle` 45              | Light Outer Cone Angle (number, no range) |
| Casts Shadows (On/Off)        | `bLightCastsShadows` true             | Light Casts Shadows (switch)              |
