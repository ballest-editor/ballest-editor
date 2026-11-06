# QA: the game's joins, and a typed turn on a loose selection

Run on 2026-11-06 against Ballest of Them All 0.4.1, through the game driver (slot 3, headless, sandbox complete, host 0.33.2). Everything here went through the handler's own functions and the details panel's transform fields; no mouse.

Two questions. What does the editor's Join do, since `editor pieces` reports a `parent` for every piece? And what does a rotation typed into the panel do to several loose pieces, which [gizmo-scale.md](gizmo-scale.md) left unmeasured?

The short answer: a join is a flat, one-level set that selects with its parent and transforms about the parent's origin with the parent's axes, like a group whose frame is the parent. It doesn't nest, and the map format has no place for it. A typed turn is rigid about the active piece's pivot, the same as a typed scale.

## How it was measured

| What                 | Read or done with                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Joining              | `callx SKGMLEHandlerComponent JoinSelection PersistentLevel`, and `UnjoinSelection`. Without `PersistentLevel` the call lands on the class default and does nothing |
| Who is whose parent  | `editor pieces`, which prints `parent none` or the parent's id                                                                                                      |
| The selection, gizmo | `editor`, `GetSelectionTransform`, `CanSetSelectionPivot`                                                                                                           |
| Typing a value       | `ApplyTransformUITextEdit` between `BeginTransformUITextEdit` and `CommitTransformUITextEdit`, with the arguments below                                             |

The typed call, with `u8` 0 for location, 1 for rotation and 2 for scale:

```
callx SKGMLEHandlerComponent ApplyTransformUITextEdit PersistentLevel | v:x,y,z | v:pitch,yaw,roll | v:sx,sy,sz | b:1 | u8:1
```

Three cubes placed with `editor_spawn`: A at (0, 0, 5000), B at (2000, 0, 5000), C at (4000, 0, 5000) yaw 45.

## Joins

| Step                                       | Result                                                                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Select A then B (B active), Join           | A's parent is B. The selection is cleared                                                                                               |
| Select the child A                         | A alone is selected, pivots allowed, gizmo on A                                                                                         |
| Select the parent B                        | B and A are both selected, pivots refused (`CanSetSelectionPivot` false), gizmo on B's origin with B's rotation                         |
| Type a location on that selection          | Both move by the change (the panel shows the origins' centroid, as for any loose selection)                                             |
| Type yaw 90 on that selection              | B turns in place; A swings about B's origin from (2000, 0, 5000) to (4000, −2000, 5000) and turns 90 too. The gizmo turns with B        |
| Type scale 2, 2, 2                         | A's offset from B's origin doubles, to (4000, −4000, 5000), and both read scale 2: the group rule from [gizmo-scale.md](gizmo-scale.md) |
| Select the child alone and type a location | It moves alone and stays joined                                                                                                         |
| Select B (so B and A) then C, Join         | A **and** B both get C as parent. The old link from A to B is gone: joins don't nest                                                    |
| Select C                                   | All three selected; a typed yaw of +90 turns them rigidly about C's origin                                                              |
| Unjoin with the three selected             | Every parent is `none`, the selection stays                                                                                             |

So a join is what [groups-prefabs.md](groups-prefabs.md) describes for a group, with two differences: the frame is the parent's own transform rather than a bounds centre, and a child can still be picked and moved alone. Joining into a joined set flattens it.

**Does a join survive a save?** Not settled here: neither `ManuallySaveNoCallback` nor the save button plus the accept tap wrote a file in this run. Two things say no anyway. No item in any of the 30 sample maps, or in the file this slot last saved, has a key beyond `actorToSpawn`, `bIsBaseItem`, `itemTransform`, `meshComponents` and the five property lists, so there is nowhere for a parent to go. And a prefab saved from a joined pair had no parent key ([groups-prefabs.md](groups-prefabs.md) § Saving a prefab).

## A typed turn on a loose selection

The three cubes, unjoined, with C active: a typed yaw turned every cube by the change and swung the others about C's pivot. A at (9000, 0, 5500) went to (5000, 4000, 5500) for +90 about (5000, 0, 5000). A value past 180 is still a change: typing 225 into a panel reading 0 turned the active cube to −135 and the others by +225.

So the panel's three fields all act as a change from the panel's value, applied as a gizmo drag would be: rigid for a location or a turn, the own-axes rule for a scale. The editor's typed rotation used to set the axis on every item about its own pivot, which is not what the game does; it now follows the game ([the design](../design/pivot-modes-and-chains.md) § Inspector).

One quirk: right after `UnjoinSelection`, with the three still selected, the first typed turn reached only the active cube and left the other two untouched. The next typed edits reached all three, and so did everything after reselecting. Reselect after an unjoin before reading anything.

## Traps for the next person

- A `seq` has a length limit: a long chain of `callx` lines came back as `no instance of SKGMLEHandlerC` or `callx null() FAILED` for the last step, with the earlier steps done. Keep each `seq` to about six calls and check that the commit ran.
- `JoinSelection` clears the selection. Select again before the next read.
