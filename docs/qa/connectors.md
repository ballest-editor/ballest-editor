# Connector ends

What `tools/extract/connectors.json` holds and how it was measured, on 0.4.1 (2026-11-06). [SNAPPING.md](../SNAPPING.md) § Connector data is the design this feeds.

## What an end is

Every piece in these families is a closed mesh with a flat cap at each end, so the caps show where the ends are.

- **Position** is the cap's top, in the middle of its width, not its centre. A cap's centre sits at a different height on pieces that join level: Bevel_F Straight's is at 0, its Turn's at -55, its Cap's at -62.5. Their running surfaces meet, and that's what has to line up. The width is the whole cap's and not its top edge's, as a lopsided top's middle moves with the bevel.
- **Forward** is the cap's outward normal. **Up** is +Z made square to it.
- **Profile** is the family. A cap's area tells the families apart (Track 50,000 cm², Bevel_F 109,079 cm², Bevel_H 58,290 cm², Bevel_C 29,145 cm²), except Bevel_F Cap, whose own cap is taller (116,579 cm², 250 cm) and still sits on the same running surface.
- **Hand** is which way a lopsided cap's top leans, looking out of the end with the game's +Y to the right of its +X. Only Bevel_C has one: its top is 188 cm of a 250 cm base. Two ends fit when their hands differ, as facing each other turns one's left into the other's right.
- Track S is square, so all four sides have a cap of the Track profile. Its ends are the two on X, as on Track M and L: turning the piece gives the other two.

## How it was measured

1. Caps were read off the meshes in the asset pack: flat faces of the family's area, grouped by plane.
2. A chain of each family was joined by those ends and placed in a sandboxed copy with `editor_spawn`, 9000 cm up so nothing else was in the frame: Track M, Curve M, Track S, Curve L, Track L, Curve S, Track M; Bevel_F Straight, Turn, Branch, Straight, Cap; Bevel_H Straight, Turn, SCurveL, SCurveR, Straight, Cap; and Bevel_C Straight, Concave Flat S, Straight, Concave Flat L, Straight, Convex Flat, Straight.
3. The game read every transform back as it was placed.
4. `piece_measure` gave the game's own bounds. Bevel_F Straight, Turn, Branch and Cap all have their top face at 9117.5. The Turn's +Y face is at 4636.6198 and the Branch's -Y face at 4636.6201, so they meet to 0.0003 cm. Track M's and L's face centres are the ends' X and Y.
5. Renders from above show each chain as one ribbon, with no gap, step or kink at a join, and the Bevel_F chain from low down as well.
6. Bevel_C was also joined the wrong way round first, right hand to right hand: its bevel jumps to the other side at every join. Joined left to right, it runs on one side through every curve. That is the case Flip to fit is for.

The meshes come through the asset pack's quantisation, so a position is good to about 0.01 cm. Directions in the plane are read to 0.01°.

## What is covered

| Family  | Pieces                                             |
| ------- | -------------------------------------------------- |
| Track   | Track S, M, L; Curve S, M, L                       |
| Bevel_F | Straight, Turn, Branch (three ends), Cap (one end) |
| Bevel_H | Straight, Turn, SCurveL, SCurveR, Cap (one end)    |
| Bevel_C | Straight, Concave Flat S and L, Convex Flat        |

Not measured yet, and so without ends: Round, Bevel_T, the ramps, Tubes, Pipes, the Bevel_C humps and scoops, Bevel_H Platform, the player start and the goal. The survey found flat caps on most of these, which is where to go next.

## After a game patch

Compare the meshes' caps with `connectors.json`, then repeat steps 2 to 5 for any piece that changed. `tools/extract/src/connectors.test.ts` keeps the file and the catalog in step.
