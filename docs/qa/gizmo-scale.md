# QA: the gizmo's axes and what a scale does in the game

Run on 2026-11-06 against Ballest of Them All 0.4.1, through the game driver (sandbox complete, host 0.33.2). Slot 3 ran headless for what needs no mouse. Slot 4 ran in a window on a private display for real gizmo drags (§ How it was measured).

The question: what frame and origin does a scale use, and when does the game change between its coordinate modes?

The short answer: every selected item scales along its own axes about one shared point, and its offset from that point scales along those same axes, so nothing ever shears. The Scale tool forces the mode the game calls Relative, and the toolbar's indicator doesn't show it.

## How it was measured

| What                  | Read or done with                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinate mode, tool | `GetCoordinateSystem` (0 World, 1 Relative) and `GetGizmoType` (20 translate, 12 rotate, 8 scale, 24 select) on `SKGMLEHandlerComponent`                |
| Tool and mode changes | `tap` on the toolbar's buttons, the game's own click handlers                                                                                           |
| The gizmo             | `GetSelectionTransform` for where it sits, and `render` for which way it points: its rotation reads the same whatever the pivot                         |
| The panel's values    | `GetSelectionTransformPropertyValue`, and `ApplyTransformUITextEdit` between `BeginTransformUITextEdit` and `CommitTransformUITextEdit` to type a value |
| Items                 | The `editor` status and `editor_selection`                                                                                                              |
| A gizmo drag          | A real mouse drag with xdotool ([DRIVER.md](../DRIVER.md) § What the headless modes do and do not give)                                                 |

The factors below are read back from the panel, not chosen: a drag doesn't land on a round number.

## When the mode changes

Traced one step at a time, on a cube turned 90, then again with several selected and with nothing selected.

| Action                                 | Mode afterwards                                                         |
| -------------------------------------- | ----------------------------------------------------------------------- |
| A map opens                            | World, with the Move tool                                               |
| Choose Scale                           | Relative, whatever it was, with any selection or none                   |
| Leave Scale for Move, Rotate or Select | Stays Relative                                                          |
| The toggle, under Move or Rotate       | Flips it. To Relative only with exactly one piece selected, not a group |
| The toggle, several or none selected   | To World works. To Relative is refused                                  |
| The toggle, under Scale                | Still reads Relative, but the next tool gets World                      |
| Choose Scale again after that          | Relative again, and the World is forgotten                              |
| Changing the selection                 | No change                                                               |

So the toggle under Scale writes World however many times it's pressed: three presses leave World just as one does. It isn't a flip of a remembered choice.

### What the indicator shows

The toolbar's toggle shows a globe for World and a local icon for Relative. It's right after a press of the toggle, and wrong after everything Scale does:

| State                     | Mode     | Icon  |
| ------------------------- | -------- | ----- |
| Move or Rotate, toggled   | Either   | Right |
| Scale, entered from World | Relative | Globe |
| Scale, toggled            | Relative | Globe |
| Move, after Scale         | Relative | Globe |

The last row is the visible one: Move's arrows run along the turned piece under a globe. The switch Scale makes never reaches the widget.

The gizmo itself is honest. With a piece at yaw 45, World draws world axes and Relative the piece's, for Move and Rotate alike. #32 recorded a rotate gizmo drawing local axes while reading global; that didn't happen here, on any tool.

## A scale of several items

Five cubes with no group, all selected: (0, 0, 5000) unturned, (0, 3000, 5000) yaw 45, (0, −3000, 5500) yaw 90, (−2000, 1500, 6000) at pitch 30, yaw 20, roll 10 with scale 2, 1, 1, and the active one at (3000, 0, 5000) yaw 30. The gizmo sits on the active one with its axes.

| Cube       | After a Y handle drag, factor 2.37281 | Scale      |
| ---------- | ------------------------------------- | ---------- |
| Unturned   | (0, 0, 5000)                          | 1, 2.37, 1 |
| Yaw 45     | (−4118.43, 7118.43, 5000)             | 1, 2.37, 1 |
| Yaw 90     | (−4118.43, −3000, 5500)               | 1, 2.37, 1 |
| Tilted     | (−2896.46, 4854.63, 5471.81)          | 2, 2.37, 1 |
| The active | (3000, 0, 5000)                       | 1, 2.37, 1 |

Each cube's offset from the pivot scaled along **its own** Y, not the gizmo's. The unturned cube's offset has no Y of its own, so it stayed put, and the yaw 90 cube's own Y is world −X. The tilted cube rules out the alternatives: the gizmo's Y would have put it at (−4607.68, 6016.63, 6000), and in place is (−2000, 1500, 6000). The rule gives (−2896.46, 4854.63, 5471.81), matching to the centimetre.

The rule, for an item at `p` with rotation `R`, scale change `S` along its own axes and pivot `c`:

```
p' = c + R S R⁻¹ (p − c)
```

The uniform handle is that with every axis the same, so a plain scale about the pivot: from those positions a factor of 2.28601 took the unturned cube to (−3858.02, 0, 5000) and the tilted one to (−10479.4, 11097.7, 6078.56).

An item's rotation never changes. No item needs a shear, however its axes lie against the gizmo's or anything else's, because each one only ever changes along its own axes. The selection as a whole does change shape, as a turned cube's offset goes one way and an unturned one's another.

A scale passes through zero to negative from the gizmo: dragging inward took one cube to −7.36.

This overturns what #32 recorded on 2026-10-28, that positions never change. Either that was an older build or a selection with nothing to show it, and it was what the editor copied.

### Whose pivot

Cube B at yaw 30 with a Top pivot and cube A at yaw 90 with a Bottom pivot, selected A then B. The gizmo sat on B's Top, and `CanSetSelectionPivot` was false. Scale Z typed as 2 took both to z 4000: about B's Top, along A's own Z. A's Bottom pivot counted for nothing. The active item's pivot is the shared point.

### Typed in the panel

The panel shows the active item's values. On the four-cube version of that selection, X typed as 2 (the panel at 1) gave the unturned cube (−3000, 0, 5000), left the yaw 45 cube at (0, 3000, 5000) since its offset has no X of its own, and took the tilted one to (−4542.87, 574.472, 4437.65) with its scale X going from 2 to **4**. So a typed scale is the change in the panel's value, applied by the same rule, not a value given to every item.

## A scale of a group

The same five cubes grouped with `GroupSelection`: frame (109.749, 103.553, 6214.03), no turn.

| Cube     | After an X handle drag, factor 3.8843 | Scale X |
| -------- | ------------------------------------- | ------- |
| Unturned | (−316.548, 0, 5000)                   | 3.88    |
| Yaw 45   | (4018.83, 7018.83, 5000)              | 3.88    |
| Yaw 90   | (0, −11951.6, 5500)                   | 3.88    |
| Tilted   | (−5310.3, 295.149, 3966.14)           | 7.77    |
| Yaw 30   | (9122.92, 3535.07, 5000)              | 3.88    |

The same rule, with the frame's translation as the pivot. The panel's scale went 1 to 3.88 and the frame stayed where it was.

### A turned frame, and the other mode

Two cubes at (0, 0, 5000) and (2000, 1000, 5000) yaw 45, grouped, then turned 30 through the panel: frame (1103.553, 603.553, 5500) at yaw 30, members at yaw 30 and 75.

- Move stays on world axes, and the toggle is refused, as for any selection that isn't one piece. So a group never gets Relative from the toggle.
- Scale forces Relative, and its handles run along the frame's axes.
- A Y handle drag, factor 2.36546, took the members to (861.69, −1184.63, 5000) and (2147.99, 1270.16, 5000): along their own Y, not the frame's. The frame turns the handles and nothing else.

That settles the coordinate mode [groups-prefabs.md](groups-prefabs.md) left open: a group's scale doesn't depend on the mode at all.

### A group and a loose piece

The gizmo goes back to the active item, with its rotation, whichever is picked last. The frame counts only when the selection is exactly one whole group.

## Front and back

The report that started this said the gizmo turns between a Back and a Front pivot to show which way a drag will scale. **I couldn't reproduce that.** The handles' directions didn't change in any of these:

| Tried                                                                    | The gizmo                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| All eight pivots on an unturned cube, under Scale                        | Moves to the pivot. Axes unchanged                           |
| Set through the panel's own button (`ChooseBack`), and after reselecting | The same                                                     |
| Back and Front on a cube at yaw 90                                       | The same                                                     |
| The camera on the far side                                               | True +X, +Y and +Z still. It doesn't flip to face the camera |
| Scaled negative                                                          | The same                                                     |
| Flip X                                                                   | The same                                                     |

What does change is how a handle sits against the piece, which may be what was seen. A handle always points along the piece's positive axis, so at Back (+X face) X points away from the mesh, and at Front (−X face) it runs through it. And a drag outward always raises the scale, so the same 6 px drag, factor 1.815, on a cube at yaw 90 did this:

| Pivot | The item            | Grows                |
| ----- | ------------------- | -------------------- |
| Front | (0, 407.593, 5000)  | Along the handle     |
| Back  | (0, −407.593, 5000) | Away from the handle |

The pivot stayed put in both.

## What the panel's Location shows

Measured with `GetSelectionTransformPropertyValue` on two cubes, the panel's value against the piece's own location. The panel doesn't show the piece's origin unless the pivot is there.

| Selection                          | Piece's location | Panel's Location  | Gizmo             |
| ---------------------------------- | ---------------- | ----------------- | ----------------- |
| One cube, Left pivot               | (0, 0, 5000)     | (0, −500, 5500)   | The panel's point |
| After Scale Y typed as 2           | (0, 500, 5000)   | (0, −500, 5500)   | The panel's point |
| After X typed as 100 in the panel  | (100, 500, 5000) | (100, −500, 5500) | The panel's point |
| One cube at yaw 90, Top pivot      | (3000, 0, 5000)  | (3000, 0, 6000)   | The panel's point |
| After Scale Z typed as 3           | (3000, 0, 3000)  | (3000, 0, 6000)   | The panel's point |
| Both, loose, the first cube active | Those two        | (1550, 250, 4000) | (100, −500, 5500) |
| Both, grouped                      | Those two        | (1550, 500, 4500) | The panel's point |

So for one piece the field is the pivot point: a scale leaves it alone while the piece's location moves, and typing into it moves the piece by what the pivot moved. For a group it's the frame. For several loose items it's the mean of their locations, which is the one case it isn't where the gizmo sits.

## What this means for the editor

- One rule for a loose selection, a group and an inspector edit: `applyGroupDelta` and `selectionAxisEdit` in `apps/web/src/domain/groupTransform.ts`.
- Scale always uses the piece's axes, so the toggle shows Local and is held while Scale is the tool. Unlike the game, Move and Rotate get back the mode they had: staying in Relative is what leaves the game's icon wrong, and a press the player can't see shouldn't change a later tool.
- The toggle works with any selection, unlike the game's (#32 chose that).
- A prefab instance pivots on the point its offsets count from, which is where the game's frame is ([groups-prefabs.md](groups-prefabs.md) § Spawning a prefab). It has to: a scale along one axis, about any other point, moves differently turned members in a way no single placement of the definition can give, so the instance would read as modified and stop following its prefab. Scaled along one axis as part of something larger (an outer group, or with a loose piece), it does read as modified, since that scale really has a different pivot.
- The Transform section's Location is the piece's origin, the value the map stores, so unlike the game's it moves under a scale. The Pivot section's Position is the game's field: the pivot point, shown once it's off the origin, and a typed value moves the selection so the pivot lands there. With several loose items it follows the gizmo rather than the mean of their locations.
- A whole group takes no pivot, as `CanSetSelectionPivot` says. The Pivot section is off for one.
- The editor doesn't keep any other group's frame ([FORMAT.md](../FORMAT.md) § The editor's projection). Its gizmo sits on the centre of the bounds with no turn, as Ctrl+G makes, and that is worked out again after each edit. So after a turn it isn't where the game's would be: that one stays put and turned.

## What I could not measure

- **How far a drag scales.** 60 px gave 7.09 and 6 px gave 1.815, and the same 6 px gave different factors at other camera distances. The editor's scale is the ratio of the pointer's distance from the pivot, and I left that alone.
- **A rotated or moved group through a real drag.** Only a scale was dragged on a group. The panel's route is in [groups-prefabs.md](groups-prefabs.md).
- **Decals and elevators in a selection.** Each keeps its own limits; whether the game then moves it about the shared pivot or its own wasn't tried. The editor holds it to its limits about its own.

## Traps for the next person

- `gamekey LeftMouseButton` does nothing in the editor, and `hover` doesn't reach the gizmo: the gizmo reads the mouse natively, through UE's input router. `IsHoveringGizmo` stayed false even in a drag that worked, so it isn't a test.
- xdotool on the desktop's own Xwayland scales coordinates by the desktop's scale, 1.25 here. On a private display it doesn't.
- `editor select` takes the active item last.
- Undo takes a selection change first, so one Undo after a drag can leave the drag in place.
- A first click that misses a handle deselects. Check `selected=` before reading anything.
