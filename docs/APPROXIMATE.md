# Approximate 3D model

Tools › Approximate 3D model… builds a prefab of Cube, Sphere, Half Sphere, Capsule, Cylinder, Cone and Pyramid pieces shaped like a 3D file. It is a beta: the menu item is there only with Settings › Beta › Approximate 3D models on (`settings.beta.approximate`, off by default), and it may change or go away. Nothing has been checked in the real game yet: coplanar faces of overlapping plates may flicker there.

## The dialog

`components/approximate/` holds the dialog, fetched the first time it opens (`LazyApproximateDialog`); it keeps its model and result while the app runs.

- **Model.** A GLB, a glTF with embedded buffers, an STL, OBJ, PLY, 3MF or FBX file, chosen or dropped on the preview (`editor/approximate/loadModel.ts`, the one place a model's frame turns into the game's). Up axis says which way is up in the file (Y for glTF, OBJ and FBX; Z for STL, PLY and 3MF), and Longest side is its size in cm.
- **Method.** Pieces and plates (the default), Plates only, Pieces only, and two voxel baselines, Merged boxes and Voxel cubes (`domain/approximate/settings.ts`). § Methods says what each does.
- **Piece budget.** The most pieces the result may use, up to what a prefab holds. The plates methods fit a whole low-poly model to it. Pieces only and Merged boxes order their pieces, so a lower budget shows the first of them at once (`KeptOrder` in `approximate.ts`), and only Pieces only refines them again.
- **Mesh search** (plates) or **Polish** (Pieces only). 0 to 20 seconds, 20 by default; Off shows the first fit.
- **Symmetry.** Ties the result to the model's mirror plane (plates) or its mirror planes and turn symmetry (Pieces only), where that looks no worse.
- **Primitives** (Pieces and plates). How readily a primitive stands in for a stretch of the surface.
- **Fewer pieces** (Pieces only). Off, Some or More: how much likeness a shorter run of the fit may give up.
- **Advanced.** Resolution (the voxel methods show it first, since it is all that sets their detail), Flatness and Thickness for plates, the greedy fit's Shapes, Outside penalty, Tolerance, Smallest piece, Refinement, No spill, Turn pieces and Seed, and Fill thin parts.

The preview (`editor/approximate/ApproximatePreview.tsx`) draws the pieces' own meshes over the model, beside it, alone, or the voxels the method saw, in the prefab's paint or coloured by shape. Over it are the piece counts by shape, the seconds the run has taken and, once it is done, its measures (§ Measures). Open as prefab puts the result, every piece painted smooth White, in a new unsaved prefab tab named after the file; it is off, with the reason beside it, while a run is under way, when the result has fewer pieces than a prefab needs or more than it holds, or when the catalog lacks one of the pieces.

In the viewport, Pyramids draw flat-shaded (`FLAT_FACED_MESHES` in `editor/visuals.ts`): the mesh's own vertex normals turn its flat sides into false folds at the scales plates use.

The fit runs in a Web Worker (`editor/approximate/approximate.worker.ts`), started 250 ms after the last change (`useApproximation.ts`). A worker's loop can't be interrupted, so a change while one runs replaces the worker (`runner.ts`). Between runs the worker keeps the model's reference grid and pictures.

## Code

`apps/web/src/domain/approximate/` holds the fitters, with no renderer or UI in them:

| Folder    | Holds                                                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (root)    | `approximate.ts`, the one entry point over the methods; `settings.ts`; `shapes.ts`, the pieces and where each is solid; `items.ts`, placements as map items; `clock.ts`                            |
| `grid/`   | The voxel grid: reading a model into one (a ray counts signed crossings, so shells pushed through each other fill as their union), distances, drawing pieces into it, Merged boxes and Voxel cubes |
| `look/`   | The twelve-view pictures and the look they give (`views.ts`), and the measures (`evaluate.ts`)                                                                                                     |
| `mesh/`   | Indexed meshes: welding, simplifying, remeshing, the surface samples                                                                                                                               |
| `parts/`  | What a model is made of: separate parts, thin parts, stretches of surface that follow a primitive, symmetries                                                                                      |
| `pieces/` | Pieces only: the greedy fit, its refinement and the polish                                                                                                                                         |
| `plates/` | The plates methods: `plates.ts` on top, `platesWhole.ts` for one model fitted whole, and one file a stage or representation                                                                        |

The time-limited searches read `clock.ts`, which the golden check freezes ([tools/approximate](../tools/approximate/README.md#golden-check)).

## Measures

Every method is judged the same way (`evaluate.ts`): against a 96-voxel reference grid as seen from outside (IoU, the share of the model covered and of the pieces outside it, and the surface distances each way, mean and 95th percentile in cm), and by pictures from twelve fixed views drawn by a small software rasterizer (`views.ts`): Outline, the silhouettes' IoU; Face angle, the mean angle between the model's and the pieces' faces where both show; and Clutter, the pieces' edge pixels (where depth or face direction jumps) over the model's own, so 1 is as busy as the model.

The fitters choose by the look (`lookOf` in `views.ts`): the mean of three agreements over the twelve views, each a share of the pixels the model or the pieces cover: the outline's overlap, how near the pieces' surface is to the model's (falling to 1/e at 8% of the view's radius), and how alike the two face. On 73 pairs of results ranked by eye it orders 71 as the eye does; Outline less Face angle and Clutter orders 67 and ranks an eight-lump ship above a detailed one. It still flatters Pieces only on organic shapes.

## Methods

### Voxel cubes and Merged boxes

Voxel cubes is one cube per visible voxel, the naive baseline. Merged boxes covers the voxels with axis-aligned scaled cubes, grown from the deepest voxel first and ranked largest first (`grid/boxMerge.ts`).

### Plates

Plates spends its budget on visible surfaces, with no core fill. It corrects the face count proportionally to the
piece count, then compares complete candidates by silhouette and face direction. At low budgets it also tries a
closed voxel surface, since simplifying fine source topology can lose the main shape. Open or non-manifold inputs
always start from that closed surface. The mesh uses decimation, quality-improving edge flips, projected tangential
relaxation and a fit in both surface-distance directions. It compares free fitting with a corner-preserving candidate, since coarse facets can be artificial on organic
models while keeping them helps mechanical shapes. Acute faces use one inward Pyramid side; other faces try overlapping acute pairs. Rejected faces use one
near-isosceles lens or two overlapping contained isosceles lenses, never three or four. Hidden corners, edges and
interior samples are tested against the filled voxel solid, with tolerance 5% of the mean face edge. Internal raw
mesh faces do not limit pyramid depth. The depth fallback count now means a hidden corner failed containment;
protrusion means an edge or interior sample failed.

Up to four representations compete at every budget, and the look (§ Measures) picks one: the mesh, slab rectangles,
strips and, for a swept shape, an extrusion.
Slab rectangles extend through the voxel solid, clipped to the original bounds. Thin models also try neighbouring
integer resolutions because rectangle counts are not monotone. This uses the two-dimensional rectangle merge as a
helper; it does not change Merged boxes. Manual thickness disables those full-depth rectangles. Strips come from the
original mesh, simplified to 2000 faces: faces grow into flat patches, the smallest patches merge into their nearest
neighbour, and a bisection on flatness finds the coarsest setting whose patch count is at most half the budget.
Each patch gives one or more rectangles on a plane through its lowest corner, so a cylinder becomes a ring of
strips. A rectangle whose outline leaves the model shrinks by a tenth a side, up to three times, and is otherwise
dropped; its depth halves until its inner corners are inside.

A model is an extrusion candidate when at least 85% of its face area lies along an axis or square to it, within 10°
(the slotted disk passes on its own axis at 1.00, pr2 on its barrel's at 0.94; the bunny, teapot and duck read about
0.3). The model is voxelised in that axis's frame, 96 pixels across the profile, and consecutive slices whose
cross-sections differ by at most 6% make one section. A greedy cover then places, one at a time, a rectangle (a box)
or an ellipse (a cylinder along the axis), turned freely in the profile's plane, where it covers the most of the
section with the largest uncovered area times length, counting the profile's edge pixels four times; a shape never
reaches more than a pixel outside the profile, and stretches through neighbouring sections while that still gains.
It stops at the budget, once each section is 99% covered, or once a piece would cover less than a set share of its
section; the shares 0, 2, 4 and 8% give four candidates, so the score may finish well under budget. A slice the
surface passes through counts as full, so each shape gives back half a pixel a side and the end sections stop at the
model's faces.

#### Thin parts

Thin parts (ears, a handle, a spout) can each become a primitive. A hill climb fits a box, ellipsoid, cylinder, capsule,
cone or half sphere (the last two tried both ways) to the part's cells by overlap, where a cell outside the model costs four times a covered
one; a long part may take a chain of up to four segments. A flat part (thickness over width under 0.4, read off the
model's own surface in runs along the part) tries only a flat box and a flat ellipsoid, alone or as a chain of two
of one kind that follows a bend.
A primitive is eligible with coverage at least 0.6 and spill at most 0.15. The mesh is fitted
twice, once with every part left to it and once with every eligible part removed, and each part keeps its primitive
where that scores better over the part's own pixels by 0.02. Two flat parts of about the same size, a pair of ears, take the same kind of piece unless that
costs one of them more than that margin. The whole result must then beat the plain mesh by 0.002 in score, or the parts go back to the mesh.

#### Stretches of surface

A stretch of the surface that follows a primitive can be given to one (`bulk.ts`). Candidates start from the deepest
places inside the solid and from its thin parts, as the box, ellipsoid, cylinder, capsule, cone and half sphere (domed
either way) with the same spread as the cells round them; a hill climb moves, turns and stretches each to explain the most surface samples, a sample counting
when it lies at most 1.2 voxels under the piece's surface and 0.4 over it, while the piece's own surface may not
leave the model by more than 1.2 voxels nor its inside bridge a gap. A greedy cover keeps those that each explain at
least 1.5% of the surface nothing before them did. Each is then drawn over the best plain mesh and kept only where
its region of the views scores at least a margin better (it pays by freeing pieces, not there); the mesh is fitted again with the kept ones as covers, where a
face under a cover takes no pieces and so the mesh can be finer elsewhere, and that fit replaces the plain one only
when it scores better by the same margin. The margin is 0.01 at the dialog's Primitives 50%, 0.03 at 0 (where the
step is skipped) and -0.01 at 100%. On the duck at 100 pieces the head becomes one sphere.

A model whose thickest place is under 7 cells deep (the fox at 48 or 64 cells) is read again on a finer grid, up to
144 cells, so its legs are more than a cell or two through.

#### Separate parts

A model made of separate parts (mesh pieces that share no vertex: a ship's masts, the balls on a star's points) is
split first (`meshParts.ts`). A part that is a rod (three times longer than wide), a thin sheet under 2% of the
surface, or under six cells long is a limb; the largest part and the rest are the body. Each of the 48 largest limbs
gets one primitive: a box, ellipsoid, cylinder, disc, capsule, cone, pyramid, half sphere or flat triangle along the
part's own axes,
whichever looks most like it in the part's own views. The body is fitted quickly alone, on a grid of its own; the
limbs are drawn over it, most gain first, and each is kept if the score rises, up to 40% of the budget. Unless the
kept ones add 0.01 between them the model is fitted whole. Otherwise the body is fitted again with what is left of
the budget. On the pirate ship at 100 pieces the outline goes from 81.6% to 88.5%.

A separate part that one primitive looks like is that primitive, whatever its shape (`wholePiece` in `meshParts.ts`):
a foot that is a squashed ball, a ball on a star's point. The primitive is fitted to the part's own triangles and must
score 0.75 in the part's own views; on the sample models' parts the ones the eye calls a primitive score 0.77 to 0.84
and the rest at most 0.73. Only parts with 1% to 25% of the surface are tried. On the goomba at 100 pieces the feet and
torso become three spheres and the score goes from 0.840 to 0.890.

#### Closed solid

Plates also fits a mesh to the solid closed over its narrow hollows and gaps (`closedGrid`), by half the edge a face
has when the budget's faces share the surface: a hull at 100 pieces is a solid lump, and at 300 only its narrowest
gaps close. It competes with the other meshes on the score. With it the ship at 100 pieces reaches 89.7%.

#### Flat profiles

Plates then tries the model's separate parts that read as flat profiles, an outline with holes swept along any axis
(`profile.ts`). A part is tried along its sweep axes and its own axes, at most three, most surface in caps and sides
first; it is a profile when nearly all of it is caps or sides with some caps and its columns at least partly full
(stepped, like the road ring's towers on lower bars), or when a quarter is caps, over half caps or sides, and its
columns are mostly full and level to a quarter of the depth (bevelled, like the launch star's frames). Its footprint,
128 pixels across, is split into up to four depth layers, and a greedy cover places rotated rectangles (boxes),
ellipses and discs (cylinders) and isosceles triangles at its sharp tips (flat pyramids) on each, a piece spilling at
most 5% of its pixels out of the outline or its layer's depth. A part whose cover leaves more than 10% uncovered, or
that the 3 seconds of work don't reach, stays with the rest of the model, which is fitted alone with what is left of
the budget: one primitive a part when that is all it is (the eight largest refined), otherwise, only where the
profiles hold at least half the model's surface, a whole fit with no mesh search, primitives or closing (9 s on the
gravity room bridge, where the full one takes 59). Each cover is tried with its pieces 85% and 100% as wide on their narrow side and 70% and 100% as thick; the
fewest pieces within 0.01 of the best look (losing at most 0.005 of outline or facing) are kept if they look better
than the fit without profiles. At 300 pieces the launch star goes from 297 pieces at look 0.846 to 31 at 0.859, and
the road ring from 298 at 0.855 to 20 at 0.917; the bunny, duck, fox and teapot read as no profile and are unchanged,
and on the slotted disk and pr2 the fit without profiles still wins.
`without: ["profiles"]` in the settings leaves the stage out.

#### Time and the mesh search

Plates aims to finish in about 24 seconds at 100 pieces: the mesh search gets what is left of that, at least 4 and
at most the slider's 20 seconds. The dialog's Mesh search slider caps local optimisation at 0–20 seconds, default 20. `searchSeconds: 0`
disables it, as `--search-seconds 0` does on the bench. Slides, edge flips, collapses, splits and paired collapse/split transfers are proposed
from two-sided surface samples. Edge targets are the smaller of the current mean edge length and 1.1 times local
solid thickness. Thickness is twice the maximum inside distance along either normal direction until the first exit,
so an arbitrary winding does not turn a thick part into a thin one. The target guides edit proposals; it is not a hard
edge-length limit under a small piece budget. Every accepted edit fits within the piece budget and improves the full
twelve-view score. Search statistics include elapsed time, proposed and accepted
edits, and their positions. The winning rectangle candidate is retained if mesh search does not beat it.

#### Symmetry

Where the model has a mirror plane (`symmetry.ts`, read once on at most 4,000 faces), plates also fits a mesh symmetric
in it (`plateMirror.ts`), from the source of the best free mesh: each side of the model is cut at the plane, simplified
to half the faces with its cut edge kept on the plane, and mirrored, and the side that stays nearer the model is kept.
Points near the plane snap onto it only from the side being kept, so a thin fin across the plane survives. The remesh
then moves each vertex pair to mirror images of their mean after every step, flips an edge only together with its
image and never one lying on the plane, and the mesh search applies every edit together with its mirror image. That
mesh wins when its score is within 0.01 of the best free one's; a model with no plane fits exactly as before.
Detection takes 1.5 to 7 s before the clock starts and the symmetric fit 0.2 to 5 s inside it. The dialog's Symmetry switch turns
it off. Mirror pairs of other pieces are not tied.

### Pieces and plates, Plates only, Pieces only

Pieces and plates is everything above. Plates only turns off every
stand-in primitive (parts, stretches of surface, separate parts and profiles), leaving pyramid sides and cubes. Pieces
only (`pieces.ts`) uses no plates: parts that are one primitive take it, the greedy fit covers the rest with spheres,
half spheres, capsules, cylinders, cones, pyramids and cubes, and the pieces are then polished against the model's pictures (`piecePolish.ts`), each dropped where the whole looks no worse
without it and otherwise moved, stretched and turned. Where the model has mirror planes or a turn symmetry
(`symmetry.ts`), half the polish time ties the pieces in matching images, and that result is kept unless it scores more
than 0.005 under the free one. The polish starts from the shortest of the fit's first eighth, quarter, half and whole
run that scores within the dialog's Fewer pieces of the best: Off 0, Some 0.01 (the default), More 0.03.

The half sphere and the capsule are the catalog's own pieces (`shapes.ts`). The half sphere's flat face is a disc as
wide as the dome is twice tall, and the fitter keeps its dome along its own z (`catalogFrame` turns it to the piece's
x). The capsule is a cylinder over the middle half of its length with a cap on each end; scaled, the caps stay a
quarter of the length each, so a long capsule has long ellipsoidal ends, not round ones.

## Known limits

- Thin triangle shells do not reliably seal in the centre-sampled voxel measures, so judge a plates result by its outline, face angle and the preview.
- Open or non-manifold inputs start from a closed voxel surface, and the thin shell can still leave seams.
- Pieces only ignores most of a large budget, and reads organic models as lumps.
- Coplanar overlap needs an in-game flicker check.
