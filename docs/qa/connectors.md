# Connector ends

What `tools/extract/connectors.json` holds and where it comes from. [SNAPPING.md](../SNAPPING.md) § Connector data is the design this feeds.

Every end is read off the piece meshes by the cap survey (2026-11-08, game 0.4.1). The first 19 pieces were then joined in a sandboxed copy of the game and looked at (2026-11-06). The rest are from the meshes only and wait for the same check (§ Not confirmed in the game).

## What an end is

A directional piece is a closed mesh cut off flat at each open end, so the caps show where the ends are.

- **Position** depends on the profile:
  - For a profile ridden on top (a track, a bevel, a round track, a quarter pipe, a half tube), it is the middle of the cap's top edge, not the cap's centre. Pieces that join level have caps centred at different heights: Bevel_F Straight's centre is at 0, its Turn's at -55, its Cap's at -62.5. Their running surfaces meet, and that's what has to line up. The middle is the middle of the whole cap's width, not of its top edge, because on a lopsided cap the top's middle moves with the bevel. A half tube's top edge is the tube's axis, so a Tube H end stands where a Tube F end does.
  - For a closed section ridden through, or not ridden at all (a full tube, the funnel's mouth, the pipe, the half tunnel, the rail), it is the cap's centre.
- **Forward** is the cap's outward normal.
- **Up** is +Z made square to forward. A cap rolled about its forward takes the roll of its own sides: square to the longest straight run of its rim, when that run is within 30° of +Z's square. Bevel_F SideRamp's raised end and the Bevel_C humps' and scoops' ends are rolled. For an end facing straight up or down, +Z gives nothing, so:
  - An oriented cap takes the side the running surface reaches from one of the piece's other ends. That surface is everything that leaves that end's top edge across edges that don't turn sharply.
  - A round cap takes that end's up, turned the shortest way round to it. Roll doesn't change how a ring fits.
  - A piece with no other kind of end takes the side toward the middle of the piece. The half pipes and Bevel_S Arch T have both ends vertical, and both face in.
  - The Pipe, whose long axis is its forward, takes +X.
- **Profile** is the family of cross-sections (§ What is covered). Two ends fit when their profiles are the same.
- **Hand** is which way a lopsided cap's top leans, looking out of the end with the game's +Y to the right of its +X. Bevel_C and Bevel_TC lean (a 185 cm top on a 250 cm base), and so do the quarter pipes (the wall is on one side). Two ends fit when their hands differ, as facing each other turns one's left into the other's right.
- **Cap** is the shape of the cut, for later work that picks other places to join. `shape` is `rect`, `polygon` (with `width` across the end, along forward × up, and `height` along up), `circle` (`radius`) or `annulus` (`radius`, `innerRadius`). `centre` is the cap's middle (the middle of its box in its plane) when that isn't the position.
- Track S is square, so all four of its sides are Track caps. Its ends are the two on X, as on Track M and L: turning the piece gives the other two.

## The survey

```sh
pnpm --filter @ballest/extract connectors           # print each piece's ends
pnpm --filter @ballest/extract connectors --write   # and write connectors.json and the catalog's copy
```

It reads `assets/pieces/` when the game was extracted here, and otherwise the asset pack in `web-assets/` (`pnpm assets`). The meshes are the same either way (the pack is lossless). It surveys the palette pieces in Tracks, Ramps, Pipes and Tubes, plus Pinched Bridge, Bevel_S Arch T, Bevel_P Rail and the Elevator (`src/connectorSurvey.ts`). For each piece:

1. It welds the mesh and groups its triangles into flat faces: triangles joined edge to edge, within 0.5° and 0.05 cm of one plane.
2. A flat face is a cap when it is at least 100 cm², at least three quarters of its rim is sharp (the face beyond turns by more than 30°, as the Mesh target's edges do), and nothing of the mesh stands more than 0.5 cm in front of it within its outline. A facet of a curved surface has smooth neighbours along its length, so it fails. A cap facing back into its own piece is covered, so it fails too.
3. It frames each cap (§ What an end is), measures it, and finds its profile in `src/profiles.ts`: area within 0.1%, sizes and radii within 0.5 cm. A cap no profile takes isn't an end. A piece with no ends lists those caps, in case one is an end of a new family.
4. It writes positions to 0.001 cm and directions to six places. A piece that already had ends keeps their order, since a joint in a sidecar names an end by its number. New pieces' ends are in order of position.

The meshes come through the extractor's float32 vertices, so a position is good to about 0.01 cm.

## Checks without the game

`src/connectorMeshes.test.ts` holds the file against the meshes. Its turbo task waits for the asset pack.

- **The survey reads the same ends off the meshes as the file has.** A patch that moves a cap fails this test.
- **Each end is the front of its piece.** Nothing of the mesh stands more than 0.05 cm ahead of the end's cap, over the cap. A U-shaped piece's arm can reach past an end beside it (Bevel_F CScoop's), so "the front" means over the cap, not of the whole piece.
- **Two ends of one profile meet cap to cap.** Each end is joined to its profile's first end (for a lopsided profile, the first of the other hand). The join uses the editor's own `meetingTurn` and `endsOf`, and the two ends must meet by `endsMeet`. Then the two caps' rims, read off the meshes, must lie on each other to 0.05 cm: all of them when the caps are as deep, and the shallower one's top half when they aren't. Bevel_F Cap's own end is 15 cm deeper than other Bevel_F ends, and the tall bevels' depths all differ. A wrong forward, up or hand fails this. Flipping Kicker2's top end's up, the Bend H 90's top end's up or a Bevel_C end's hand each fails it by 46 to 207 cm.

Quarter Curve Small is skipped (§ Not confirmed in the game).

## What is covered

Cap sizes are width × height in cm. ✓ marks the pieces joined in the game on 0.4.1.

| Profile       | Cap                                         | Pieces                                                                                                                                                                                       |
| ------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Track         | rect 500 × 100                              | Track S ✓, M ✓, L ✓; Curve S ✓, M ✓, L ✓; Pinched Bridge; ramps Curve1 S, M, L, Curve2 S, M, L, Kicker1 S, M, Kicker2 S, M; pipes Half Tiny1, Half1, Half Large1                             |
| Bevel_F       | polygon 500 × 235 (Bevel_F Cap's 500 × 250) | Straight ✓, Turn ✓, Branch ✓ (three ends), Cap ✓ (one end); Kicker Stub (one end), Kicker S, M; Scoop M, L, S1, S2; SideRamp L, R; CScoop L, R; RingKicker; Bevel_T Platform; Bevel_S Arch T |
| Bevel_H       | polygon 500 × 125                           | Straight ✓, Turn ✓, SCurveL ✓, SCurveR ✓, Cap ✓ (one end)                                                                                                                                    |
| Bevel_C       | polygon 250 × 125, handed                   | Straight ✓, Concave Flat S ✓, L ✓, Convex Flat ✓; Hump S, D; Scoop S, D                                                                                                                      |
| Bevel_T       | polygon 500 wide, 5042 to 6981 deep         | Bevel_T Branch (three ends), Wall: a Bevel_F slab on a narrower stem                                                                                                                         |
| Bevel_T Sheer | polygon 500 wide, 5119 to 5213 deep         | Bevel_T Sheer, Cap (one end): a wall the full width down, under a Bevel_H top                                                                                                                |
| Bevel_TC      | polygon 250 wide, 5119 to 5122 deep, handed | Bevel_TC Straight, Concave                                                                                                                                                                   |
| Round         | polygon 500 × 198.25                        | Round Curve, Round Curve Up, Round Curve Down                                                                                                                                                |
| Round Low     | polygon 500 × 149.57                        | Round Straight                                                                                                                                                                               |
| Pipe Q        | polygon 368.31 × 368.31, handed             | Quarter Straight, Quarter Curve Large                                                                                                                                                        |
| Pipe Q Small  | polygon 390.4 × 268.49, handed              | Quarter Curve Small                                                                                                                                                                          |
| Tube F        | annulus 150, 142.5                          | F Straight Short, Long; Corner F 25, 45, 90; Bend F 25, 45, 90; Curve F 25, 45, 90; Funnel's narrow end                                                                                      |
| Tube H        | polygon 300 × 150 (a half ring)             | H Straight; Bend H 25, 45, 90; Curve H 25, 45, 90                                                                                                                                            |
| Funnel        | annulus 238.79, 226.85                      | Funnel's mouth                                                                                                                                                                               |
| Pipe          | circle 50                                   | Pipe                                                                                                                                                                                         |
| Tunnel        | annulus 48, 46                              | Half tunnel                                                                                                                                                                                  |
| Rail          | polygon 140.63 × 66.09                      | Bevel_P Rail                                                                                                                                                                                 |

The ramps' ends are Track caps, so they are the Track profile. Some profiles line up without fitting:

- A half tube and a full tube have the same radius and axis, but their caps differ, so they don't fit. With Profiles: Warn they snap level, with the chip.
- Bevel_T Platform's ends are Bevel_F caps. The other tall bevels share Bevel_F's or Bevel_H's top but not its depth, so they are profiles of their own.

These pieces have no ends:

- Bevel_H Platform and Bevel_T Podium: closed on every side.
- Bevel_F FlatRing, Bevel_F RingScoop and Bevel_T Ring: closed rings.
- CornerRamp: its two side faces differ, 257,714 and 258,500 cm². It is a corner fill, not a run.
- The Elevator: a platform, with no cap but its underside.
- The player start and the goal, the bowls and the shapes: not surveyed. The bowls' cut faces join bowl to bowl, which is a different kind of joint.

## Not confirmed in the game

Every piece without a ✓ above. These ones need the game to settle them:

- **Quarter Curve Small.** Its +X end faces 5° off the X axis (forward 0.996, -0.087), and its two caps differ: 42,375 and 42,396 cm², 390.4 and 390.9 cm wide, with rims 2.6 cm apart at the wall's foot. The mesh also stands 0.06 cm in front of that end. The checks skip it (`UNEVEN` in the test).
- **Bevel_F Scoop L's lower end** faces 5.7° below level (forward -0.995, 0, -0.1) and sits 4.9 cm off the piece's centre line. Its upper end is square.
- **The round pieces' meshes are 1.87 cm off centre along X.** Round Curve's ends are at x = -896.45 and 900.19, and the other two are the same. Round Straight's section is 50 cm lower than the curves' (149.57 against 198.25), so Round Straight and Round Curve don't fit. Whether the game joins them with a step is the question.
- **Vertical ends whose up comes from the running surface:** Kicker2 S and M, Bevel_F Kicker M, Scoop S1 and S2, CScoop L and R, Bend H 90 and Curve H 90. Bevel_F is the same top and bottom, so only the surface from the piece's other end says which face is ridden.
- **Both ends vertical:** the three half pipes and Bevel_S Arch T face in, toward the middle. The arch could as well be ridden over the top.
- **Bevel_F Scoop M** turns back on itself: both its ends face -X and take +Z as up. A piece joined to the upper end therefore continues the upper arm's outer face. For the Bevel_F slab that is the same placement either way.

To confirm a family, repeat what the first 19 pieces had (§ How the first families were confirmed), then add ✓ to the table.

## How the first families were confirmed

On 0.4.1 (2026-11-06), with the game driver:

1. Caps were read off the meshes in the asset pack, which is what the survey now does.
2. A chain of each family was joined by those ends and placed in a sandboxed copy with `editor_spawn`, 9000 cm up so nothing else was in the frame: Track M, Curve M, Track S, Curve L, Track L, Curve S, Track M; Bevel_F Straight, Turn, Branch, Straight, Cap; Bevel_H Straight, Turn, SCurveL, SCurveR, Straight, Cap; and Bevel_C Straight, Concave Flat S, Straight, Concave Flat L, Straight, Convex Flat, Straight.
3. The game read every transform back as it was placed.
4. `piece_measure` gave the game's own bounds. Bevel_F Straight, Turn, Branch and Cap all have their top face at 9117.5. The Turn's +Y face is at 4636.6198 and the Branch's -Y face at 4636.6201, so they meet to 0.0003 cm. Track M's and L's face centres are the ends' X and Y.
5. Renders from above show each chain as one ribbon, with no gap, step or kink at a join, and the Bevel_F chain from low down as well.
6. Bevel_C was also joined the wrong way round first, right hand to right hand: its bevel jumps to the other side at every join. Joined left to right, it runs on one side through every curve. That is the case Flip to fit is for.

The survey reproduces those 19 pieces' ends exactly.

## After a game patch

Run the survey. If a mesh changed, the first check fails: look at what moved, `--write`, and repeat the steps above for the pieces that changed. `src/connectors.test.ts` keeps the file and the catalog in step.
