# Design: Together and Each, group pivots, and chains

Written 2026-11-06, after PR #220 (`c9fb0853c`) made every scale follow the game's rule, and built the same day in one PR. What is true now is in [DESKTOP.md § Pivot setting](../DESKTOP.md#pivot-setting-together-and-each) and [§ Group pivots and chains](../DESKTOP.md#group-pivots-and-chains); this is the reasoning and what was measured.

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

Numeric fields accept arithmetic with `+`, `-`, `*`, `/`, parentheses and scientific notation. A negative number is an absolute value: replacing -100 with -200 sets -200. Relative edits use `+=50`, `-=20`, `*2` or `/2`; the existing `+50` shorthand still adds. Invalid expressions and division by zero leave the value unchanged.

The displayed transform and pivot position use the same unit as the edit, including the first selected link inside a chain in Each. Item pivot presets are available only when every selected unit is an item. A whole group uses its own presets; mixed groups and pieces keep a position row and explain how to enter the group to edit its members. Chains and instances retain their fixed pivot rules. The single-piece position row appears when its pivot differs from its origin; multi-selections show the gizmo pivot.

**Groups and instances.** A whole group is one unit, so it has Transform rows of its own, over its frame: its position is the pivot, editable as a move in the Pivot section's Position row (a group has no stored origin to call Location); Rotation and Scale read 0 and 1, since a group holds neither, and a value typed there is a change about the pivot, the way the game's panel treats a joined set. With an Item pivot (below) the rows read that item's values. The group's items keep their editor under "Edit all N items", without Transform rows, since the group's rows already do that job, and a pasted row there is what sets every member to one value. On an instance that editor says that an edit in it changes the instance away from its definition, which the unit rows never do: every edit of theirs is about the instance's origin.

## Showing it

In Each the gizmo sits on the active unit's pivot with the active unit's axes, so the drag reads as it does for a single piece. Inside an entered chain it sits on the first selected link instead, since every edit in Each runs down the chain from there and takes the drag as that link does (`pivotUnitOf`). Every other unit's pivot gets a dot. That dot is #82: a disc in perspective at the pivot, dotted when it is inside the selection's box. Build it once for the selection pivot, then draw it at every unit pivot in Each. The dots don't show axes; a short three-axis tick at each pivot in Local Each is a possible later addition, not part of this.

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

**Moves.** A Point moves with the group's own moves and is left alone by turns and scales, since it is the pivot. A snapped landing and a mirror are motions of the whole group rather than turns about the Point, so it goes with them, live during a landing's drag. A Point on a group whose members are then moved one at a time stays where the user put it.

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

**Inside a chain.** Double-clicking enters it like any group. A link selected inside it carries the links after it: a move or turn on link 3 of 5 takes 4 and 5 along rigidly, since that is what parenting means, and in Each the accumulation ran through the selected links only (changed after use, § Bending). Maya's Preserve Children is the escape from this; here the escape is Unchain, or a modifier held during the drag, and which is an open question.

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

## Bending, after use (2026-11-08)

Using chains turned up three problems, and the user settled the fixes. What is true now is in [DESKTOP.md § Group pivots and chains](../DESKTOP.md#group-pivots-and-chains).

- **Too many steps.** A bend took: select, group, convert, enter, select all, Each, turn. Each held a chain selected whole at Together, since it is one unit. Now a chain alone is enough for Each, which bends it, and Group as chain has a keybind (Ctrl+Shift+G) and makes one whole group selected a chain itself. A bend is: select in order, Ctrl+Shift+G, period, turn.
- **Selected links only.** Inside an entered chain, Each accumulated through the selected links only, and an unselected link rode rigidly on the one before it. Select one link of each pair and the pairs turned as if still grouped, which read as a bug. Now a turn bends from the first selected link to the end, selected or not, and so do a move and a scale (§ Moving and scaling a chain).
- **World on a second bend.** The pass above turned every link about one world axis. A straight chain bends cleanly that way, but a curved one doesn't: each link's joint to the next is turned another way, so a fixed axis gives every joint a different turn and the curve kinks. Now the first link takes the turn as the gizmo shows it, read in its own axes, and every later link takes that same local turn in its own axes as the links before it left them. Every joint of a curve then turns alike, and a second bend about another axis winds the curve into a helix. The axes toggle still picks the first link's axis. A link that faces another way from its neighbours turns about its own matching axis, which is what keeps a curve of like pieces even.
- **Order.** A chain took its links in outline order, or selection order for Group as chain. A row of pieces built by duplicating blocks has a document order that jumps along the row, so Convert to chain made a chain whose bend broke at every block. Now both order the links along the pieces as they lie, nearest pivot next, starting from the first selected or first child when it is an end. Dragging a link in the Outline still reorders it by hand.
- **Growth.** A chain carries an optional growth in the sidecar. Linear adds a percentage of the first link's turn per link, which makes the curvature grow steadily (a clothoid, what roads use to ease into a bend). Compound multiplies by it per link, which winds a spiral; 3ds Max's Array has the same per-copy percentage as its incremental scale. Growth counts from the first bending link.

## Moving and scaling a chain

A move in Each moved every selected link by the offset, and the links after rode along once, so a chain selected whole moved exactly as in Together. A scale stayed with its link and never reached the next, so a scaled link left a gap or ran into its neighbour. Neither did anything a chain is for. Both now pass down the chain like a bend, from the first selected link to the end, selected or not.

- **A move adds up.** Each link moves by the move from the link before it, so link `k` from the first moves `k + 1` times as far, the way a bend's turns add up. The first link takes the move as the gizmo shows it; every later link takes it in the axes of the link before, read as the first link reads it, so a joint opens along itself and a drag along a chain spaces it evenly, along a curve too. A drag across a row makes a staircase, and a drag up a pile (Duplicate and Paste place copies in place) stacks it. Moving a chain rigidly is Together's job. Selecting from the second link on keeps the first where it is. Growth grows each link's share the way it grows a bend's turn. Nothing reads a direction off the chain: an earlier version split the drag into the part along the first joint, which spaced, and the part across, which moved the chain rigidly, and a pile, whose joints have no direction, only moved.
- **A scale keeps the joints.** Every link takes the scale the edit gives the first, in its own axes about its own pivot, and a link's step to the next, read in its own axes, grows or shrinks with it, so each joint still meets. The joint is taken to be at the next link's pivot, as a bend takes it: a chain whose pivots sit at its joints stays closed exactly, and one with centred pivots closes only where the links scale alike. Growth is a power here: a link's scale is the first's raised to its growth, so Linear 100% makes the scales 2, 4, 8, … for a doubling, a taper; with a Compound growth and a bend, a shell.
- **Together inside a chain.** A turn or move of a selected link still carries the links after it rigidly. A scale resizes the selected links about the active one, and the links after them now follow so the joints meet, rather than being left where they were. Scaling one link of an entered chain lengthens that link and pushes the rest along.
- **A scale is read off the first link.** The ratio the edit gives the first link's first item, axis by axis, is what every link takes. A drag's factor is that ratio; a value typed in the Inspector makes the first link that value and the rest the same ratio. A link that is a plain group scales its items about its pivot along each one's own axes, as any group does, and its step to the next grows by the first item's ratio.

## Laying a chain

A second bend makes a helix, but its axis is the product of the two turns: bend about Y, then about Z, and the helix winds about an axis between them, and the Z turn changes the turn per link, so a ring stops closing. Two bends can't aim a helix. The chain section's **Lay along** group lays one directly. It is a beta, behind Settings › Beta, off by default: it is the one chain operation that reads which way a chain runs (a helix's rise is a climb per step, so it tips each link by an angle measured from the links' own steps), and it may yet change. It picks a shape, shows that shape's fields, and Lay chain applies it as one undo step (`layChain`). Every shape is a function from the links and its fields to their transforms, so a new one (an arc, a spline) is a case of `ChainShape` and a set of fields.

- **Straightened first.** A bend never changes a link's step to the next as read in that link's own axes (the pivot-to-pivot offset turned back by the link's rotation). Every link takes the first link's axes, and those steps then line the chain up along the way the first link points. The first link stays where it is, keeping its roll. **Straight** stops there, which also undoes a bad bend whatever made it.
- **Helix: tipped, then turned.** The straight chain tips toward a world axis (X, Y or Z) until each step climbs the rise per link, and every joint turns the turn per link about the axis. A constant joint turn about one axis with a constant climb is a helix about that axis; a rise of 0 is a flat ring square to it, and a rise at or past a step's length stands the chain along the axis. Growth grows each joint's turn the way it grows a bend's.
- **An action, not a setting.** Nothing goes in the sidecar, so a freehand bend after is free, and laying again starts from the straightened chain, so it repeats. A stored shape, re-laid live like a modifier stack, would fight a freehand bend over who owns the chain. Links that face other ways from one another take the first link's axes, so a chain of mixed pieces loses their own turns.

## Naming, after use (2026-11-09)

A review of the words the chain feature shows turned up one problem underneath the rest: a chain's behaviour hung on Each, a word for "each piece about its own pivot", which says nothing about a turn running down a chain. A new chain also opened at Together, so it turned rigidly until the user found the period key. The user settled the fixes. What is true now is in [DESKTOP.md § Group pivots and chains](../DESKTOP.md#group-pivots-and-chains).

- **A setting of the chain's own.** A chain on its own (selected whole, or links inside an entered chain) follows `chainMode`, Rigid or link by link, not `pivotMode`; the same toggle and key flip whichever the selection follows. It starts link by link, so a new chain bends on its first turn, and a loose selection's Together is left alone. Removing Together/Each instead was weighed and rejected: loose selections need Each to keep a gap through a scale, to turn pieces where they stand and for local moves, and a chain needs a two-way choice either way.
- **Words for what the drag does.** Link by link, the toggle names the tool's effect on a chain: Bend (rotate), Spread (move), Stretch (scale). The move case is the trap: a whole chain moved link by link spreads rather than moving, and the word says so before the drag. Making a whole chain's move always rigid was the alternative, left for if people trip on it.
- **One link inside an entered chain** is enough for link by link, which bends, spreads or stretches from it to the end. Before, one link held the toggle at Together.
- **Joints, not Growth.** The growth counts joints: Even means every joint takes the same, so the pieces already move further and further down the chain (link `k` moves `k` times as far). Read as pieces, every name looked one step behind. The control is now Joints, Even / Linear / Exponential (Compound was a finance word), with a line that says what it makes of the last link in pieces. The sidecar keeps `compound`.
- **Make chain** replaces Group as chain and Convert to chain, three verbs for one action. Reverse's tooltip says "Start from the other end", and the view marks link 1 while a chain is selected, since everything a chain does counts from it.

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

All five landed together in #227, on top of #225's Pivot section and Position row. Of the open questions, the carry inside a chain has no modifier: Unchain is the escape. An instance's axes stay identity.
