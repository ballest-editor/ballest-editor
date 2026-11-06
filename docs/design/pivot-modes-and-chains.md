# Design: Together and Each, group pivots, and chains

Written 2026-11-06, after PR #220 (`c9fb0853c`) made every scale follow the game's rule. Nothing here is built.

The problem that started it: two pieces side by side can't be scaled up without closing the gap between them, because #220 scales every selection about one shared point, as the game does. The fix the user settled on is a setting for what a selection pivots about, Together or Each, across Move, Rotate and Scale, and pivots that can be put where the gap is. On top of that, a chain: a group whose outline order is a hierarchy, so a turn runs down it as 3ds Max's "Rotating Multiple Linked Objects" shows.

What this document rests on: [qa/gizmo-scale.md](../qa/gizmo-scale.md) for the game's scale and coordinate modes, [qa/groups-prefabs.md](../qa/groups-prefabs.md) for frames, and [qa/joins-and-typed-rotation.md](../qa/joins-and-typed-rotation.md), measured for this design. The game only ever does Together. Everything under Each, the group pivot, and chains has no game equivalent, and § No game equivalent lists them.

## Decided by the user

1. One setting across the tools, Together or Each. Together is the default and the game's behaviour.
2. Each is for multi-selections. With one whole group selected, Each isn't available.
3. With several groups selected, Each works about each group's own pivot, which becomes configurable.
4. Gaps come from pivots. Two pieces keep their gap in Each when each pivot sits on the face next to the gap. Centred pivots make them overlap.
5. Chains are in scope, as a group whose order in the outline is the hierarchy.

## What other apps do

Checked against their manuals on 2026-11-06, not from memory.

- **3ds Max** has the three-way transform centre: [Use Pivot Point Center](https://help.autodesk.com/cloudhelp/2015/ENU/3DSMax/files/GUID-AB1A114E-8381-4DD6-87AB-1D880DFB6032.htm) "lets you enable rotation or scaling of one or more objects around their respective pivot points", Use Selection Center, and Use Transform Coordinate Center. The "Rotating Multiple Linked Objects" example the user remembered is on that page, not in Maya: "When rotating a chain of linked objects (that is, a hierarchy) with Use Pivot Point Center active, the rotation is applied equally to each object in the chain. This results in accumulated rotations, which makes it easy to animate such effects as fingers curling."
- **Maya**'s [Rotate Tool](https://help.autodesk.com/cloudhelp/ENU/MayaCRE-Basics/files/GUID-C2D0F80C-812B-465D-A634-DB6ECFABFCB3.htm) and [Scale Tool](https://help.autodesk.com/cloudhelp/ENU/MayaCRE-Basics/files/GUID-487B6A23-E135-45E2-94F1-B0D59D6B6F33.htm) each have a Center setting: Default or Object "lets you rotate the selected objects about each object's individual pivot point", Manip uses the manipulator, Selection "the selection's common center point". Scale's Axis Orientation "Object" says "If several objects are selected, each object scales the same amount relative to its own object space coordinate system." Both tools have Preserve Children: "moving a parent object does not move its children." Maya has no page on rotating linked objects.
- **Blender**'s [Individual Origins](https://docs.blender.org/manual/en/latest/editors/3dview/controls/pivot_point/individual_origins.html): "While the other pivot point modes transform the whole selection around one point, Individual Origins transforms each item around itself." The page shows rotate and scale, says nothing about move, and nothing about which axis a turn uses when objects face different ways.
- **Unity**'s [gizmo toggles](https://docs.unity.com/en-us/engine/current/manual/working-with-scenes/scenes-manage-gameobjects/positioning-game-objects) are Pivot or Center for position and Local, Global or Grid for rotation. The page doesn't say whether several objects turn about one point or each about its own.
- **Illustrator**'s Transform Each couldn't be read: Adobe's help refuses automated fetches.

So "each about its own pivot" is a per-transform centre setting in all three 3D apps, and only 3ds Max documents what it does to a hierarchy. The Move in Local row below is my own; no manual confirmed or denied it.

## Units

The selection stays a list of item keys. A **unit** is what Each treats as one thing: the nodes the selection makes up (`selectionNodeIds` in `domain/groupSelection.ts`), so an item at the click level, or a group whole in the selection. A prefab instance is a group, so a unit. Each needs two or more units; with fewer the setting reads Together whatever it holds.

Every unit has a pivot point and axes:

| Unit            | Pivot                                                                  | Axes in Local                                  |
| --------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| Item            | Its own pivot (`editorState.pivots`), as today                         | Its own rotation                               |
| Group           | Its group pivot (§ Group pivot); Centre, the bounds centre, by default | Identity, or the anchor item's (§ Group pivot) |
| Prefab instance | The definition origin (`instanceOrigin`), always                       | Identity                                       |
| Chain           | Its first link's pivot                                                 | Its first link's axes                          |

Together uses one pivot, the active unit's, which is what `selectionPivot` returns now. The gizmo sits there in both modes.

## The maths, per tool

Notation: a drag gives one delta. An item is `(p, R, s)`, position, rotation, scale. A unit `u` has pivot `c_u` and axes `F_u`. In Together every unit uses `c = c_active` and `F = F_active`.

**Move.** The handle gives a distance along a gizmo axis, in world axes or local ones.

| Axes  | Together                                  | Each                                                             |
| ----- | ----------------------------------------- | ---------------------------------------------------------------- |
| World | Every item moves by the same world offset | The same. No difference, and the toggle says so in its tooltip   |
| Local | Offset along the active unit's axes       | Each unit moves the distance along its own axes: `o_u = F_u · d` |

Grid snapping as today: in World the active pivot lands on the grid and the others take the same offset; in Local the distance snaps to whole grid steps, which in Each is along each unit's own axes.

**Rotate.** The ring gives an angle `θ` about a gizmo axis.

| Axes  | Together                                                 | Each                                                                              |
| ----- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| World | `q = (world axis, θ)`; every item turns about `c` by `q` | Same `q`, each unit about its own `c_u`                                           |
| Local | `q = (F_active · axis, θ)`, every item about `c`         | `q_u = (F_u · axis, θ)`: each unit turns about its own axis through its own pivot |

The items of a group unit turn rigidly with it. Rotation snapping snaps `θ`, once, for every unit. In Local Each, pieces turned differently turn about different world directions; Blender's manual doesn't say whether Individual Origins with Local orientation does this, so the claim is mine.

**Scale.** The handle gives a factor `f` along an axis, or uniform. Scale is always along each item's own axes, which is the game's rule and why the Local/World toggle is held under Scale. The pivot is the only thing the setting changes:

```
p' = c_u + R S R⁻¹ (p − c_u)
```

Together with `c_u = c` is `applyGroupDelta` as it stands. In Each an item unit scales in place about its own pivot (`keepPoint`), and a group unit's members spread about the group's pivot by the same rule. The gap case: two cubes with Front and Back pivots on the facing sides stay apart, because the pivot faces don't move.

## The setting

`pivotMode: "together" | "each"` in the store, beside `gizmoSpace`, not persisted, Together at launch. A keybind `togglePivotMode` in Settings › Keybinds; I'd default it to period, Blender's pivot key, if nothing has it. The effective mode is `pivotMode` when the selection has two or more units, else Together: one selector, `shownPivotMode(s)`, the way `shownGizmoSpace` holds Local under Scale.

**Where.** The view controls' second pill, top right over every pane, holds the axes toggle then the two snap groups (`ViewportControls`, #218). The pivot toggle goes first in that pill: `[Together] | [Local] | grid | angle`. It's a `Toggle` like `AxesToggle`, icon plus a word, the word dropping below 42rem as the others do. Two icons: one dot in a frame for Together, a dot in each of two frames for Each. The tool bar at the foot stays as it is: this is a global setting of the gizmo, so it belongs with the axes toggle and not with the tools. The pane label is untouched.

**When Each isn't available** the toggle is disabled and reads Together, the way the axes toggle is disabled and reads Local under Scale, and its tooltip says why: "Each needs two or more pieces or groups selected" or, with one group, "One group is one piece to Each: enter it to work on its members". The stored choice is kept, so a selection that grows gets it back. Under Move in World both modes do the same thing; the toggle stays live and its tooltip adds "Same as Together for a move along world axes".

## Inspector

Today a scrub is a delta about the shared pivot, and a typed rotation or location sets the axis on every item about its own pivot. The game has only typed values and treats all three as a change from the panel's value, applied as a drag would be, rigid for a turn ([qa/joins-and-typed-rotation.md](../qa/joins-and-typed-rotation.md)). That measurement makes the choice: **typed and scrubbed edits are both deltas from the active unit's value, applied by the setting**, so `selectionAxisEdit` loses its "set" branch for rotation and location. A pasted row (`setSelectionField`) still sets every item, which keeps the one job "set" did.

| Field    | Together                                                             | Each                                            |
| -------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| Location | Every item moves by the change (the game)                            | The same; a typed location is a world move      |
| Rotation | The change about the active rotator axis, rigid about `c` (the game) | The change about each unit's own axis and pivot |
| Scale    | The ratio, about `c` (the game, as now)                              | The ratio, about each unit's pivot              |

This changes behaviour for anyone who typed "90" to set every piece's yaw to 90. I think that's right: the game doesn't do it, and Each makes "turn each by 90" one typed value away.

**What the rows show.** The unit's value, which is the active piece's, with a Mixed mark on the row when the other pieces differ on an axis. A blank Mixed field gave nothing to type a change from; the active piece's value does, and it is where the gizmo sits. The Pivot section's Position row (#225) shows the pivot point itself, the game's Location, and an edit there is the same move.

**Groups and instances.** A whole group is one unit, so it has Transform rows of its own, over its frame: Location is the pivot, editable as a move; Rotation and Scale read 0 and 1, since a group holds neither, and a value typed there is a change about the pivot, the way the game's panel treats a joined set. With an Item pivot (below) the rows read that item's values. The group's items keep their editor under "Edit all N items", without Transform rows, since the group's rows already do that job, and a pasted row there is what sets every member to one value. On an instance that editor says that an edit in it changes the instance away from its definition, which the unit rows never do: every edit of theirs is about the instance's origin.

These two paragraphs are done on this branch, ahead of the setting; the rest of this section waits for Each.

## Showing it

In Each the gizmo sits on the active unit's pivot with the active unit's axes, so the drag reads as it does for a single piece. Every other unit's pivot gets a dot. That dot is #82: a disc in perspective at the pivot, dotted when it is inside the selection's box. Build it once for the selection pivot, then draw it at every unit pivot in Each. The dots don't show axes; a short three-axis tick at each pivot in Local Each is a possible later addition, not part of this.

The numbers for the gizmo's point are the Pivot section's Position row from #225, and in Each they stay the active unit's. For a group with an Item or Point pivot, `shownPivotPoint` returns that pivot rather than nothing, and "Set pivot here" sits beside the row.

How this sits with the open gizmo issues:

- **#82, the origin dot.** Prerequisite. Each draws several of the thing #82 draws one of. Its "inside the bounding box" test uses the unit's box, not the selection's.
- **#83, axis locks and uniform scale.** No conflict. A lock names a gizmo axis, which in Local Each means each unit's own X. Uniform scale is the centre handle already, and Each changes only the pivot.
- **#88, align and distribute.** The companion. Each plus facing pivots keeps the gap between two pieces; a row of three has a middle piece with gaps on both sides and one pivot, and that stays a job for distribute with equal gaps.
- **#109, the combined gizmo.** It must follow the same rules: placed at the active unit's pivot, scale handles along the items' own axes whatever its other handles show. Nothing in this design assumes the separate gizmos.

## Group pivot

The game refuses a pivot on a group (`CanSetSelectionPivot` false) but loads a `frame` anywhere, and the frame is where its gizmo sits and what the group turns and scales about. The editor writes the bounds centre and keeps no frame. The choices here:

| Choice                                | The pivot                                                      | Axes        | After the group turns                          |
| ------------------------------------- | -------------------------------------------------------------- | ----------- | ---------------------------------------------- |
| Centre (default)                      | Centre of the box around the members' bounds, as Ctrl+G makes  | Identity    | Recomputed, so the gizmo moves (today's limit) |
| Bottom, Top, Left, Right, Back, Front | That face of the same box                                      | Identity    | Recomputed                                     |
| Item                                  | One member's own pivot, chosen in the Outline or the Inspector | That item's | Follows the item, so it stays put              |
| Point                                 | A world point, stored                                          | Identity    | Stays put: it's the game's frame               |

#225 disables the Pivot section's choices on a whole group, with a hint that a group turns about its frame, and `setSelectionPivot` refuses one. The choice here replaces that disabled state and lifts the refusal: it is the one Pivot section, with a group's choices in place of a piece's.

**Storage.** A `pivot` field on the sidecar's `GroupNode`, optional, absent for Centre: `{ "choice": "Top" }`, `{ "choice": "item", "key": "<stable key>" }` or `{ "choice": "point", "world": { "x", "y", "z" } }`. Not in `editorState.groups`: the game would drop it on save, and the sidecar already holds everything the game can't. The `.balledit` gets the pivot as the group's `frame` translation on every encode, rotation identity and scale 1, so the in-game gizmo sits where the editor's does. The other way, a map with no sidecar whose frame isn't at the bounds centre gets a Point pivot at the frame's translation, which is the one place a frame the game kept can come back in.

**Should the editor store a frame?** Only as the Point choice, and only when the user asks for it. A frame stored for every group goes stale the moment a member is moved inside the group, and nothing in a re-match after an in-game edit can recover it. Centre stays the default because it follows the members. The gizmo jump after a turn, the known limit from #220, goes away for a group with an Item or Point pivot, and that is the fix I'd offer rather than a hidden frame: "Set pivot here" in the Inspector freezes the current pivot as a Point.

**Moves.** A Point moves with the group's own moves and is left alone by turns and scales, since it is the pivot. A Point on a group whose members are then moved one at a time stays where the user put it.

**Prefab instances** don't get the choice. Their pivot is the definition origin, and the Inspector says so where the choice would be. An instance scaled along one axis about any other point stops being a placement of its definition and reads as modified (`checkInstance`), so the one rule that keeps instances intact is to pivot there. In Each, an instance among the units pivots on its origin and stays unmodified. In Together with anything else selected, the shared pivot isn't its origin and a one-axis scale modifies it, as today.

## Chains

**What a chain is.** A group with `chain: true` in the sidecar. Its children, in outline order, are its links: the first is the root and each link hangs off the one before it. A link is any unit, an item or a nested group, with the unit's pivot and axes. A nested chain is one link from outside and a chain of its own when entered. A chain group's own pivot is its first link's, so the group pivot choice is hidden on it.

**What propagates.** A hierarchy makes a parent's transform carry its children. Rotation is the one that accumulates, which is the 3ds Max example: in Each mode a turn of `θ` on a selected chain turns link 1 by `θ` about its pivot, carries link 2 along with that and turns it `θ` about its own moved pivot, and so on, so link `k` ends up turned `kθ`. Written as a pass down the links with an accumulated transform `A`, identity at the start:

```
for each link k in order:
  apply A to the link (carried by the links before it)
  c  = A(c_k)                       the link's pivot, where it now is
  q  = (A(F_k · axis) or world axis, θ)
  turn the link by q about c
  A  = (turn by q about c) ∘ A
```

Move doesn't accumulate: every link moves by the offset, in World or along its own axes, as any Each selection does. A chain in Together is a plain group and turns rigidly about its first link's pivot.

**Scale in a chain.** An item holds a rotation and a `scale3D`, so a non-uniform scale passed down to a child turned another way would be a shear, which no item can hold and which the game never produces ([qa/gizmo-scale.md](../qa/gizmo-scale.md)). The decision: scale doesn't propagate at all. Each link scales by the factor about its own pivot along its own axes, the ordinary Each rule, and a parent's scale changes nothing about its children. Nothing in the curling-finger example needs scale to accumulate, and this keeps the game's no-shear invariant without a special case.

**Inside a chain.** Double-clicking enters it like any group. A link selected inside it carries the links after it: a move or turn on link 3 of 5 takes 4 and 5 along rigidly, since that is what parenting means, and in Each the accumulation runs through the selected links only. Maya's Preserve Children is the escape from this; here the escape is Unchain, or a modifier held during the drag, and which is an open question.

**Outline.** A chain's row has a chain glyph in place of the folder, and its links are numbered. Dragging a link reorders the chain, which rehangs it; nothing moves in the map, because the map only ever holds world transforms. The menu gets Make chain and Unchain on a group row, Group as chain on a selection, which takes selection order as link order, and Reverse chain. The Inspector of a chain shows the link count and the same actions.

**Export.** Nothing to bake: items hold world transforms already, and the chain's game group is a flat group like any other, with `frame` at the root link's pivot. The chain lives in the sidecar tree, so an in-game save that drops `editorState` loses nothing the re-match doesn't bring back: the links are matched by fingerprint like any item, and their order is the sidecar's.

**The game's joins.** Measured for this design ([qa/joins-and-typed-rotation.md](../qa/joins-and-typed-rotation.md)): Join makes the active piece the parent of the rest, selecting the parent selects the set, the gizmo sits on the parent's origin with its axes, and every transform is rigid, the group rule with the parent as the frame. Joining a joined set to another piece flattens it under the new parent, so joins don't nest, and the map format has no field for them. A join is therefore a group with an Item pivot, and that choice covers it. Chains don't build on joins and don't map to them: the game can't hold a hierarchy, a chain's accumulation, or the join itself past a save. The editor doesn't need a Join command.

## No game equivalent

Everything the game can't do, so nothing here was measured against it:

- Each, in every tool. The game is always Together.
- A pivot on a group other than its frame's translation, and the Item, Point and face choices.
- Typed values that follow a setting. The game's panel is Together.
- Chains, link order, rotation that accumulates, and a link carrying the links after it.
- Pivot dots. The game shows one gizmo and no other pivot.

What the game does and the editor copies: Together's maths, the no-shear scale rule, the frame as the group's pivot, and typed values as deltas.

## Open questions

- **Escaping the carry inside a chain.** A modifier during the drag, or nothing but Unchain? Alt is duplicate and Shift is selection, so a modifier would be new.
- **Instance axes in Local.** An instance's unit axes are identity here. Its placement rotation is known (`checkInstance`), and using it would make an instance in Local turn about its own axes like a piece. I left it at identity to match today's sole-group gizmo; either is defensible.
- **The game's chain of joins on load.** The driver can't read a saved join because there is none; if a later build saves them, a map with no sidecar could become groups with Item pivots.

## Decided here, not by the user

- Typed rotation and location become deltas, matching the game and the scrub. Pasting a row still sets. Rows show the active piece, not a blank Mixed.
- A whole group has Transform rows over its frame; its items' editor loses theirs.
- Chains propagate rotation only. Scale and move act per link.
- A chain's pivot is its first link's; the group pivot choice is hidden on it.
- Group pivots live in the sidecar only and reach the game as the frame. No frame is stored unless the user picks Point.
- Instances always pivot on the definition origin, in every mode.
- The setting is store state, not persisted, with a toggle in the axes pill and a keybind.
- No Join command.

## Issues, in order

1. **feat: draw the selection pivot as a dot in perspective (#82).** The dot, dotted when inside the box, drawn at the selection pivot. Done when every pivot choice shows where it is without turning the camera.
2. **feat: pivot setting, Together or Each, for move, rotate and scale.** `pivotMode`, units, the per-tool maths above for drags with snapping, the toggle in the axes pill with its disabled states, the keybind, a dot per unit pivot in Each. Tests pin Together to the numbers in [qa/gizmo-scale.md](../qa/gizmo-scale.md) and Each to the gap case. Done when two facing-pivot cubes scale apart with their gap intact, and a sole group reads Together.
3. **fix: inspector edits follow the pivot setting and the game's delta rule.** `selectionAxisEdit` as deltas for every field, Together rigid about the shared pivot as measured, Each about each unit's. The Together half, with the group's own rows, is on this branch; Each is the rest. Done when a typed yaw on three loose cubes matches [qa/joins-and-typed-rotation.md](../qa/joins-and-typed-rotation.md).
4. **feat: configurable group pivot.** The sidecar field, the Inspector's choice with Set pivot here, the frame on encode, the Point on import, the instance exception. Done when a turned group's gizmo stays put with an Item or Point pivot, and the in-game gizmo sits where the editor's does.
5. **feat: chains.** The sidecar flag, Outline rows and menu, rotation down the chain in Each, carry inside an entered chain, Reverse. Done when a five-link chain turned 10 degrees in Each reads 10, 20, 30, 40, 50 on its links and exports as one flat group.

Issue 3's Together half is first, since it is done. Issues 2 and the rest of 3 could be one PR; 4 and 5 should not be, since 5 needs 4's Item pivot and the carry rule needs its own review. Issue 1 is small and unblocks 2. Issue 4 builds on #225's Pivot section and Position row.
