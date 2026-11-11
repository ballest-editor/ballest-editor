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

| Unit            | Pivot                                                                  | Axes in Local                                      |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| Item            | Its own pivot (`editorState.pivots`), as today                         | Its own rotation                                   |
| Group           | Its group pivot (§ Group pivot); Centre, the bounds centre, by default | Its own turn, or the anchor item's (§ Group pivot) |
| Prefab instance | The definition origin (`instanceOrigin`), always                       | Its own turn                                       |
| Chain           | Its first link's pivot                                                 | Its first link's axes                              |

Together uses one pivot, the active unit's, which is what `selectionPivot` returns. The gizmo sits there in both modes. For loose pieces the active unit is the active item, the game's rule ([qa/gizmo-scale.md](../qa/gizmo-scale.md)); when the active item is in a group whole in the selection, it is that group, so two turned groups move along the active group's axes and turn about its pivot, never one of its members'.

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

The fields follow the editor's rules (2026-11-11, § 4), like Unity's and Maya's, and not the game's panel, which takes a typed value as a change from the active piece applied rigidly ([qa/joins-and-typed-rotation.md](../qa/joins-and-typed-rotation.md)). Neither the pivot setting nor Local/World changes what a field does (`domain/fieldEdit.ts`).

- **Things.** A field edits the selected units one by one: a loose piece, a whole group, a whole chain, an instance, or a link inside an entered chain. Each reads its own value, and a field shows the value they all hold, or Multiple where they differ.
- **Plain numbers set.** A number, or plain arithmetic, is worked out for every thing as that value, and each is taken there whole about its own pivot (`fieldTo`): a group moves until its Location lands, turns until its Rotation does, scales by the ratio its value makes. A field never pulls a group apart.
- **Relative entries.** `+=`, `-=`, `*=` and `/=`, or the shorthands `+`, `*` and `/`, are worked out for each thing from its own value. A bare negative number is a value: `-20` sets -20.
- **Sequences.** `L(a, b)` spreads a to b evenly across the things in selection order, chain order for links; `$i` is a thing's place from 0 and `$prev` the value just worked out for the thing before, which the first thing has none of, so it keeps its own. `$prev + 300` spaces things evenly from the first, `+= 300 * 1.2^$i` grows the gaps, `$prev * 1.2` is a geometric series (`workOutEntry`).
- **Scrubs and pastes.** A scrub changes every thing by the same amount from its own value. A pasted row is its three values typed.
- **Links carry nothing.** Inside an entered chain each selected link takes exactly its own value; the links after it stay. The gizmo and the chain tools keep the carry.
- **The Pivot section's Position** is where the setting shows. In Together it is the combined pivot, where the gizmo sits, shown with two or more things or where it isn't the Location, and an edit there moves everything as one by what it takes to bring it there. In Each every thing has its own, shown where any isn't its Location, and it takes an entry as the other rows do.

Numeric fields also accept parentheses, powers (`^`) and scientific notation. Invalid expressions and division by zero leave the value unchanged, and a thing whose value works out to nothing finite keeps its own.

Every unit has the same rows: Location, Rotation, Scale (Factor or Size) and Flip. A unit's Location is its transform's translation: a piece's origin, a group's pivot, or the origin of the member a group pivots on (a chain's first link, an Item pivot). Size needs every thing to take an item's transform (`Unit.anchor`, `unitExtentOf`): a group's own frame has none, since its items scale along their own axes and the box around turned items doesn't scale by the factor. A size keeps a flipped axis flipped. The Pivot section keeps its choices in place for every selection: item presets only when every selected unit is an item, a group's own when it is selected alone, and otherwise the same grid greyed with why under it (a chain, an instance, a group among pieces).

**Groups and instances.** A whole group is one unit, so it has Transform rows of its own, over its frame: Location is its pivot and a change moves the group; Rotation reads the group's own turn (§ Group pivot) and Scale reads 1, since a group holds no scale, so a value there scales it by that much about the pivot. With an Item pivot (below) the rows read that item's values, Size included. A group's Paint and Properties sit in the open under its rows, as several loose pieces' do; they edit every member. On an instance the Instance section says that an edit there changes the instance away from its definition, which the unit rows never do: every edit of theirs is about the instance's origin.

## Showing it

In Each the gizmo sits on the active unit's pivot with the active unit's axes, so the drag reads as it does for a single piece. Inside an entered chain the active unit is the last clicked link, and every edit in Each runs down the chain from it and takes the drag as that link does (`SelectionUnits.active`). Every other unit's pivot gets a dot. That dot is #82: a disc in perspective at the pivot, dotted when it is inside the selection's box. Build it once for the selection pivot, then draw it at every unit pivot in Each. The dots don't show axes; a short three-axis tick at each pivot in Local Each is a possible later addition, not part of this.

The numbers for the gizmo's point are the Transform section's Location when the pivot is the unit's position, and the Pivot section's Position row (#225) when it isn't; in Each they stay the active unit's.

How this sits with the open gizmo issues:

- **#82, the origin dot.** Prerequisite. Each draws several of the thing #82 draws one of. Its "inside the bounding box" test uses the unit's box, not the selection's.
- **#83, axis locks and uniform scale.** No conflict. A lock names a gizmo axis, which in Local Each means each unit's own X. Uniform scale is the centre handle already, and Each changes only the pivot.
- **#88, align and distribute.** The companion. Each plus facing pivots keeps the gap between two pieces; a row of three has a middle piece with gaps on both sides and one pivot, and that stays a job for distribute with equal gaps.
- **#109, the combined gizmo.** It must follow the same rules: placed at the active unit's pivot, scale handles along the items' own axes whatever its other handles show. Nothing in this design assumes the separate gizmos.

## Group pivot

The game refuses a pivot on a group (`CanSetSelectionPivot` false) but loads a `frame` anywhere, and the frame is where its gizmo sits and what the group turns and scales about. Its rotation turns with the group: a yaw of 90 takes a frame from 0 to 90 ([qa/groups-prefabs.md](../qa/groups-prefabs.md)). The editor keeps that turn as the group's `rotation`, and its frame (`groupFrameOf`) is the box around the members' bounds square to it, which is the box the viewport draws and the group card measures. The choices here:

| Choice                                | The pivot                                                      | Axes             | After the group turns                     |
| ------------------------------------- | -------------------------------------------------------------- | ---------------- | ----------------------------------------- |
| Centre (default)                      | Centre of the frame's box, as Ctrl+G makes                     | The group's turn | Turns with the box, so it stays put       |
| Bottom, Top, Left, Right, Back, Front | That face of the same box, along the group's own axes          | The group's turn | Turns with the box                        |
| Item                                  | One member's own pivot, chosen in the Outline or the Inspector | That item's      | Follows the item, so it stays put         |
| Point                                 | A world point, stored                                          | The group's turn | Rides along with the group's rigid motion |

#225 disables the Pivot section's choices on a whole group, with a hint that a group turns about its frame, and `setSelectionPivot` refuses one. The choice here replaces that disabled state and lifts the refusal: it is the one Pivot section, with a group's choices in place of a piece's.

**Storage.** A `pivot` field on the sidecar's `GroupNode`, optional, absent for Centre: `{ "choice": "Top" }`, `{ "choice": "item", "key": "<stable key>" }` or `{ "choice": "point", "world": { "x", "y", "z" } }`. Not in `editorState.groups`: the game would drop it on save, and the sidecar already holds everything the game can't. The turn is a `rotation` field beside it, a unit quaternion, absent for the world's axes. The `.balledit` gets the pivot as the group's `frame` translation on every encode, with the group's turn as its rotation and scale 1, so the in-game gizmo sits and turns where the editor's does. The other way, a map with no sidecar takes a frame's rotation as the group's turn, and a frame that isn't at the centre of the box square to it gets a Point pivot at the frame's translation.

**What the editor stores of a frame.** The turn, always, and the position only as the Point choice. A stored position goes stale the moment a member moves inside the group, so Centre stays the default because it follows the members. A turn doesn't go stale that way: moving one member leaves the group's axes where they were and the box still fits square to them. It is what makes a turned group keep its box, its face pivots and its Local axes, where a world-aligned box grew and swung about after every turn (#220's gizmo jump).

**Moves.** A group's frame rides along with every rigid motion of all its items (`withCarriedFrames`): its turn takes the motion's turn, and a Point goes where the motion takes it. A turn about the Point leaves it put, since it is what the turn is about, and a turn of the group with others about another pivot swings it along. A scale isn't rigid and leaves both alone, and so does an edit of only some members: a Point on a group whose members are then moved one at a time stays where the user put it, and so does its turn. A snapped landing and a mirror are motions of the whole group, so the Point goes with them, live during a landing's drag. A group with one item turns when that item turns. A nested group turns with its parent.

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
- Fields that edit each thing from its own value, with `L()`, `$prev` and `$i`. The game's panel takes a change from the active piece.
- Chains, link order, rotation that accumulates, and a link carrying the links after it.
- Pivot dots. The game shows one gizmo and no other pivot.

What the game does and the editor copies: Together's maths, the no-shear scale rule and the frame as the group's pivot.

## Bending, after use (2026-11-08)

Using chains turned up three problems, and the user settled the fixes. What is true now is in [DESKTOP.md § Group pivots and chains](../DESKTOP.md#group-pivots-and-chains).

- **Too many steps.** A bend took: select, group, convert, enter, select all, Each, turn. Each held a chain selected whole at Together, since it is one unit. Now a chain alone is enough for Each, which bends it, and Group as chain has a keybind (Ctrl+Shift+G) and makes one whole group selected a chain itself. A bend is: select in order, Ctrl+Shift+G, period, turn.
- **Selected links only.** Inside an entered chain, Each accumulated through the selected links only, and an unselected link rode rigidly on the one before it. Select one link of each pair and the pairs turned as if still grouped, which read as a bug. Now a turn bends from the active link, the last clicked, to the end, selected or not, and so do a move and a scale (§ Moving and scaling a chain).
- **World on a second bend.** The pass above turned every link about one world axis. A straight chain bends cleanly that way, but a curved one doesn't: each link's joint to the next is turned another way, so a fixed axis gives every joint a different turn and the curve kinks. Now the first link takes the turn as the gizmo shows it, read in its own axes, and every later link takes that same local turn in its own axes as the links before it left them. Every joint of a curve then turns alike, and a second bend about another axis winds the curve into a helix. The axes toggle still picks the first link's axis. A link that faces another way from its neighbours turns about its own matching axis, which is what keeps a curve of like pieces even.
- **Order.** A chain took its links in outline order, or selection order for Group as chain. A row of pieces built by duplicating blocks has a document order that jumps along the row, so Convert to chain made a chain whose bend broke at every block. Now both order the links along the pieces as they lie, nearest pivot next, starting from the first selected or first child when it is an end. Dragging a link in the Outline still reorders it by hand.
- **Growth.** A chain carries an optional growth in the sidecar. Linear adds a percentage of the first link's turn per link, which makes the curvature grow steadily (a clothoid, what roads use to ease into a bend). Compound multiplies by it per link, which winds a spiral; 3ds Max's Array has the same per-copy percentage as its incremental scale. Growth counts from the first bending link.

## Moving and scaling a chain

A move in Each moved every selected link by the offset, and the links after rode along once, so a chain selected whole moved exactly as in Together. A scale stayed with its link and never reached the next, so a scaled link left a gap or ran into its neighbour. Neither did anything a chain is for. Both now pass down the chain like a bend, from the active link to the end, selected or not.

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

- **A setting of the chain's own.** Links inside an entered chain follow `chainMode`, Rigid or link by link, not `pivotMode`; the same toggle and key flip whichever the selection follows. It starts link by link, so a link of a new chain bends it on its first turn, and a loose selection's Together is left alone. A whole chain selected from outside is one thing, as a group is: it follows `pivotMode` and always takes an edit whole, about link 1, so moving a whole chain never spreads it (the editor's rules, 2026-11-11). Removing Together/Each instead was weighed and rejected: loose selections need Each to keep a gap through a scale, to turn pieces where they stand and for local moves, and a chain needs a two-way choice either way.
- **Words for what the drag does.** Link by link, the toggle names the tool's effect on a chain: Bend (rotate), Spread (move), Stretch (scale). The move case is the trap: a whole chain moved link by link spreads rather than moving, and the word says so before the drag. Making a whole chain's move always rigid was the alternative, left for if people trip on it.
- **One link inside an entered chain** is enough for link by link, which bends, spreads or stretches from it to the end. Before, one link held the toggle at Together.
- **Joints, not Growth.** The growth counts joints: Even means every joint takes the same, so the pieces already move further and further down the chain (link `k` moves `k` times as far). Read as pieces, every name looked one step behind. The control is now Joints, Even / Linear / Exponential (Compound was a finance word), with a line that says what it makes of the last link in pieces. The sidecar keeps `compound`.
- **Make chain** replaces Group as chain and Convert to chain, three verbs for one action. Reverse's tooltip says "Start from the other end", and the view marks link 1 while a chain is selected, since everything a chain does counts from it.

## Open questions

- **Escaping the carry inside a chain.** A modifier during the drag, or nothing but Unchain? Alt is duplicate and Shift is selection, so a modifier would be new.
- **Instance axes in Local.** An instance's axes are its group's turn, which a placement starts at the world's axes and every turn of the whole instance adds to. Its placement rotation is known too (`checkInstance`), and would give the same axes for an instance placed square; the turn is kept instead so every group follows one rule.
- **The game's chain of joins on load.** The driver can't read a saved join because there is none; if a later build saves them, a map with no sidecar could become groups with Item pivots.

## Decided here, not by the user

- Typed rotation and location became deltas, matching the game and the scrub, and rows showed the active piece, not a blank Mixed. The user's rules of 2026-11-11 replaced that with per-thing fields that show Multiple (§ Inspector).
- A whole group has Transform rows over its frame; its items' editor loses theirs.
- Chains propagate rotation only. Scale and move act per link.
- A chain's pivot is its first link's; the group pivot choice is hidden on it, and stays stored, so Unchain gives it back.
- Group pivots live in the sidecar only and reach the game as the frame. A group's turn is always stored; its position only when the user picks Point.
- Instances always pivot on the definition origin, in every mode.
- The setting is store state, not persisted, with a toggle in the axes pill and a keybind.
- No Join command.

## Issues, in order

1. **feat: draw the selection pivot as a dot in perspective (#82).** The dot, dotted when inside the box, drawn at the selection pivot. Done when every pivot choice shows where it is without turning the camera.
2. **feat: pivot setting, Together or Each, for move, rotate and scale.** `pivotMode`, units, the per-tool maths above for drags with snapping, the toggle in the axes pill with its disabled states, the keybind, a dot per unit pivot in Each. Tests pin Together to the numbers in [qa/gizmo-scale.md](../qa/gizmo-scale.md) and Each to the gap case. Done when two facing-pivot cubes scale apart with their gap intact, and a sole group reads Together.
3. **fix: inspector edits follow the pivot setting and the game's delta rule.** `selectionAxisEdit` as deltas for every field, Together rigid about the shared pivot as measured, Each about each unit's. The Together half, with the group's own rows, is on this branch; Each is the rest. Done when a typed yaw on three loose cubes matches [qa/joins-and-typed-rotation.md](../qa/joins-and-typed-rotation.md).
4. **feat: configurable group pivot.** The sidecar field, the Inspector's choice with Set pivot here, the frame on encode, the Point on import, the instance exception. Done when a turned group's gizmo stays put with an Item or Point pivot, and the in-game gizmo sits where the editor's does.
5. **feat: chains.** The sidecar flag, Outline rows and menu, rotation down the chain in Each, carry inside an entered chain, Reverse. Done when a five-link chain turned 10 degrees in Each reads 10, 20, 30, 40, 50 on its links and exports as one flat group.

All five landed together in #227, on top of #225's Pivot section and Position row. Of the open questions, the carry inside a chain has no modifier: Unchain is the escape. Groups and instances later kept a turn of their own (`GroupNode.rotation`), so an instance's axes are no longer identity.
