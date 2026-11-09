# Design: box and lasso select

Written 2026-11-09 for #85, and built the same day. What is true now is in [DESKTOP.md § Box and lasso select](../DESKTOP.md#box-and-lasso-select); this is the comparison it came from and the reasons for each choice.

Before this, a left drag in the viewport did nothing unless it started on the gizmo or, with Drag body on, on the selection itself. A press that moved more than 4 px was dropped as not being a click. So box select takes no gesture away from anything.

## What other apps do

Checked against their manuals on 2026-11-09, not from memory. Where a manual says nothing, the row says so rather than guessing. Excalidraw has no user manual for this, so its row comes from its source.

| App        | How a region starts                                                                                                                                                       | Modifiers                                                                                                      | Inside or touching                                                                                  | Pieces behind others                                                          | Groups                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Blender    | Select Box and Select Lasso are tools. With Tweak, a drag on an object moves it. Lasso is also Ctrl+RMB.                                                                  | Shift adds, Ctrl removes. Set, Extend, Subtract, Invert and Intersect in the tool's Mode. Shift+click toggles. | Box: "partially or completely inside", so touching only. Lasso and circle test the object's origin. | X-ray lets you select what is hidden.                                         | Not documented                                               |
| 3ds Max    | A Selection Region flyout (rectangle, circle, fence, lasso, paint), cycled with Q. With Select Object a drag starts anywhere; with Move, Rotate or Scale, in empty space. | Ctrl adds, Alt removes, for clicks and regions alike. Ctrl stopped toggling in 2011.                           | A Window/Crossing toggle, Crossing by default. A preference picks it by drag direction.             | Not documented for objects                                                    | A click on a member selects the group                        |
| Maya       | The Select tool's Marquee style, and a separate Lasso tool                                                                                                                | Click: Shift toggles, Ctrl removes, Ctrl+Shift adds. Drag: Shift adds, Ctrl removes.                           | Not documented                                                                                      | Camera based selection, for components only                                   | "Single marquee select" takes the first in the hierarchy     |
| Fusion     | Window (1), Freeform lasso (2) and Paint (3) modes; a drag on a component moves it                                                                                        | Ctrl toggles, Shift adds, for clicks and regions alike                                                         | Drag direction: left to right is window, right to left is crossing                                  | A Select Through filter                                                       | Not documented                                               |
| Unreal     | In an orthographic view a plain left drag; a Select Objects tool (Q) in 5.6                                                                                               | Shift adds; Ctrl+Alt removes (one page says Ctrl+RMB)                                                          | A setting, Strict Box Selection                                                                     | A setting, Box Select Occluded Objects                                        | Allow Group Selection; whether marquee follows it isn't said |
| Unity      | "Drag a rectangle around multiple GameObjects"                                                                                                                            | Shift+click adds, Ctrl+click toggles; not said for the rectangle                                               | Not documented                                                                                      | Not documented                                                                | Unpickable objects are skipped by the rectangle              |
| Godot      | In Select mode, a left drag; applied on release                                                                                                                           | Shift adds; Shift+click on a selected node removes it                                                          | "within the rectangle's boundaries", not explicit                                                   | Not documented                                                                | A grouped node selects its root; locked nodes are skipped    |
| Rhino      | A drag in an open area; Alt+drag starts one anywhere, even on an object. Lasso and SelBoundary are commands.                                                              | Shift adds, Ctrl removes, for clicks and regions alike                                                         | Drag direction (left to right window); the mouse options can fix one                                | Not stated; SelVisible exists to take only the visible, so a box goes through | Locked objects can't be selected                             |
| AutoCAD    | Click and click for a rectangle, press and drag for a lasso; PICKAUTO decides whether a drag over an object starts one                                                    | Shift removes                                                                                                  | Drag direction for rectangle and lasso; Space cycles window, crossing and fence in a lasso          | Not documented                                                                | Not documented                                               |
| Figma      | A drag on empty canvas; Ctrl/Cmd+drag reaches nested layers                                                                                                               | Shift+click adds, and on a selected layer removes                                                              | Not documented                                                                                      | n/a                                                                           | The marquee selects top-level layers                         |
| Excalidraw | A drag on empty canvas; Ctrl/Cmd+drag starts one on an element. Lasso is a tool, and Alt held during a box drag turns it into a lasso.                                    | Shift keeps the selection, so it adds. No subtract.                                                            | A preference, Wrap or Overlap, Wrap by default; the lasso follows it                                | n/a                                                                           | A caught member selects its outermost group                  |

Feedback while dragging:

- **3ds Max** draws a window region with a solid line and a crossing region dashed, when direction picks the mode.
- **AutoCAD** dashes a crossing region, and fills the window area blue and the crossing area green at 25%. It previews what a region will select, up to 20,000 objects (`SELECTIONPREVIEWLIMIT`).
- **Fusion** fills the area with a translucent colour.
- **Figma** draws a blue box around each layer that will be selected.
- **Excalidraw** changes the selection itself on every pointer move.
- **Godot** applies the selection on release. Blender, Maya, Unreal and Unity don't document what they show.

On performance:

- **Excalidraw** runs its lasso tests in a web worker, on cached segments.
- **Maya**'s lasso has a Fast setting that approximates the shape, which it says makes very little difference now.
- **Rhino**'s SelBoundary with Precise=No tests against a bitmap of the shape.
- **AutoCAD** caps its preview.

None of these apps says anything about orthographic against perspective views.

Sources, one or more per app:

- Blender: [Selecting](https://docs.blender.org/manual/en/latest/interface/selecting.html), [Object selecting](https://docs.blender.org/manual/en/latest/scene_layout/object/selecting.html), [Shading (X-ray)](https://docs.blender.org/manual/en/latest/editors/3dview/display/shading.html)
- 3ds Max: [Selecting objects](https://help.autodesk.com/cloudhelp/2026/ENU/3DSMax-Basics/files/GUID-E371C8DA-9664-4284-9AFA-826EF4544144.htm), [Selection region](https://help.autodesk.com/cloudhelp/2018/ENU/3DSMax-Basics/files/GUID-3467E7F6-DEEE-4B7B-881E-B3293DAA814C.htm), [Window/Crossing](https://help.autodesk.com/cloudhelp/2016/ENU/3DSMax/files/GUID-35216345-561C-460D-82AD-00E4C2F6716E.htm), [Auto Window/Crossing by Direction](https://help.autodesk.com/cloudhelp/2024/ENU/3DSMax-Customizing/files/GUID-86205F0D-6143-432A-B0D4-5CCC4DB2699F.htm), [Ctrl and Alt](https://help.autodesk.com/cloudhelp/2016/ENU/3DSMax/files/GUID-1962BD49-AAD7-43FA-871E-5C2742C047B8.htm), [Groups](https://help.autodesk.com/cloudhelp/2016/ENU/3DSMax/files/GUID-D75FD8C0-3851-44BD-B50F-747D61F3A98B.htm)
- Maya: [Select objects](https://help.autodesk.com/cloudhelp/2024/ENU/Maya-Basics/files/GUID-5C5F2B9B-BE16-4C49-B72B-70EA7CB4C688.htm), [Drag selection](https://help.autodesk.com/cloudhelp/2024/ENU/Maya-Basics/files/GUID-98CCC417-B06A-4E19-A3C6-19EF75295EEA.htm), [Select Tool options](https://help.autodesk.com/cloudhelp/2024/ENU/Maya-Basics/files/GUID-60FD5F79-AC1D-46DE-B66D-2FBE73E15A30.htm), [Lasso Tool](https://help.autodesk.com/cloudhelp/2020/ENU/Maya-Basics/files/GUID-BA4D08B7-70ED-4C4F-8538-9C491D781193.htm), [Selection preferences](https://help.autodesk.com/cloudhelp/2024/ENU/Maya-Customizing/files/GUID-8C8BA1F4-59EE-4A02-BFE7-9193C0D6F5BE.htm)
- Fusion: [Selection](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-SELECTION.htm), [Selection modes](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-SELECTION-MODES.htm), [Selection filters](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-SELECTION-FILTERS.htm)
- Unreal: [Selecting actors](https://dev.epicgames.com/documentation/en-us/unreal-engine/selecting-actors-in-unreal-engine), [Viewport controls](https://dev.epicgames.com/documentation/en-us/unreal-engine/viewport-controls-in-unreal-engine), [Quick settings](https://dev.epicgames.com/documentation/unreal-engine/quick-settings-in-the-unreal-engine-level-toolbar)
- Unity: [Select GameObjects](https://docs.unity.com/en-us/engine/6000.3/manual/working-with-scenes/scenes-manage-gameobjects/scene-picking/select-game-objects), [Scene picking controls](https://docs.unity.com/en-us/engine/6000.0/manual/working-with-scenes/scenes-manage-gameobjects/scene-picking/controls)
- Godot: [Introduction to 3D](https://docs.godotengine.org/en/stable/tutorials/3d/introduction_to_3d.html)
- Rhino: [Selecting objects](http://docs.mcneel.com/rhino/6/usersguide/en-us/html/ch-03_selectingobjects.htm), [Mouse options](https://docs.mcneel.com/rhino/8/help/en-us/options/mouse.htm), [Selection commands](https://docs.mcneel.com/rhino/8/help/en-us/commands/selection_commands.htm), [Lock](https://docs.mcneel.com/rhino/8/help/en-us/commands/lock.htm)
- AutoCAD: [Did you know](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-LT-DidYouKnow/files/GUID-D0D5C0C3-F092-448A-8E81-D38F27094639.htm), [PICKAUTO](https://help.autodesk.com/cloudhelp/2021/ENU/AutoCAD-Core/files/GUID-7BAAA374-8409-4296-B520-C5355941C836.htm), [SELECT](https://help.autodesk.com/cloudhelp/2016/ENU/AutoCAD-LT-MAC/files/GUID-0DD5DA73-9DC5-4424-8FED-7BBE3BE52A4D.htm)
- Figma: [Select layers and objects](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects)
- Excalidraw: [lasso, PR #9169](https://github.com/excalidraw/excalidraw/pull/9169), [Wrap or Overlap, PR #11053](https://github.com/excalidraw/excalidraw/pull/11053), [groups.ts](https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/groups.ts)

The manuals disagree with themselves in two places: Blender's lasso key (Ctrl+RMB on one page, Ctrl+Alt+LMB on another) and Fusion's lasso direction (clockwise on one page, left to right on another).

## What Ballest Editor does, and from where

**A plain left drag draws a box, from anywhere the drag means nothing else.** That covers every tool whose click selects, so not Paint. A drag on a gizmo handle is the gizmo's, and a drag on the selection is a body drag when Drag body makes it one. Anywhere else a drag starts a box, on a piece as well as on empty space. From 3ds Max's Select Object ("on an object or off") and Rhino's Alt+drag, both of which exist because the space between objects runs out. A track seen from above is mostly floor tiles and track, so a box that needed empty space would rarely start. Figma and Excalidraw start only in empty space because a drag on an object moves it there; here a drag on an unselected piece did nothing.

**The modifiers are click selection's keybinds, applied per unit.** Shift (`addToSelection`) adds. Ctrl (`toggleSelection`) flips each unit the box catches. Ctrl+Shift (`removeFromSelection`, new, and on a click too) takes them away. The issue asked for the click's modifiers, and the click has add and toggle, so subtract needed a chord of its own. Ctrl+Shift keeps Ctrl's "away" meaning: the in-game editor deselects on Ctrl+click, as Blender, Maya and Rhino remove on Ctrl+drag. 3ds Max dropped toggling regions in 2011 and Rhino never had it, so if toggling turns out to be the wrong thing for Ctrl+drag, the fix is to swap the two defaults. Intersect is Blender's alone and is left out.

**Inside or touching follows the drag's direction, as in the CAD apps.** Left to right catches what is wholly inside, right to left what the box touches. That is AutoCAD, Rhino and Fusion, and an option in 3ds Max. This is the "CAD-style tooling" [VISION.md](../VISION.md) promises, and it gives both of the issue's options with no trip to Settings. Settings › Editor › Box selects can fix it at Touching or Wholly inside instead, as Rhino's mouse options, Unreal's Strict Box Selection and Excalidraw's Wrap or Overlap do. The region shows which one is in force: a solid line for inside, dashed for touching (3ds Max, AutoCAD), with a translucent fill (Fusion, AutoCAD). A chip by the pointer names it and counts what it holds.

**Lasso: hold Alt while dragging.** That is Excalidraw's gesture. Alt at the press already orbits, so the lasso key only counts once the drag has begun (`lassoSelect`, live in the drag alone, like the snap keys). The path is kept from the press, so pressing Alt turns the box into the line drawn so far, and letting go turns it back. A lasso takes inside or touching from the way it first heads. Fusion's two pages disagree on its rule, and a loop's overall direction means nothing. The status bar lists Alt during the drag, as it lists a move's keys.

**What is behind other pieces is caught.** This is the 3ds Max and Rhino default, and Blender with X-ray. Rhino needs a separate SelVisible command to get the other behaviour. Seen from above, a track's lower decks sit under its upper ones, and a box over them in the Top pane should take them all. Only what is in front of the camera, in the pane the drag started in, counts. Visible-only would need an ID buffer pass, as Blender's solid mode and Unreal's option have, and is left for later.

**Groups follow the click.** A box reaches the same unit a click would (`clickLevelOf`): an item's outermost group, or inside an entered group, that group's children. That is Excalidraw, Godot and 3ds Max. Touching catches a unit when any of its items is touched, and inside only when every one of its items is inside. Inside an entered group a box looks only at that group's items, as Select all does. Hidden and locked pieces (#81) leave the candidates in one place, `areaCandidates`, as Unity, Godot, Rhino and Excalidraw skip what can't be picked; a unit is judged by its pickable items, and a caught group still comes whole, as it does for a click.

**The active item is the one nearest where the drag began.** Ballest Editor makes the item clicked the active one, so the gizmo sits where the click was. A box has no item clicked, so the item whose pivot is nearest the press, on screen, stands in for it. That is where the user aimed. The rest follow in Outline order, as Select all leaves them. Add and toggle put the units they add after the selection, with that item last. Remove leaves the active item alone unless it took it. Blender keeps the old active object through a box. That would leave the gizmo on something the box may have dropped, and it would differ from Shift+click here, which makes the added item active.

**Preview while dragging, applied on release.** What the release would select is drawn with the selection's outline while the box moves, after its modifier, so a remove shows what stays. That is Excalidraw, Figma and AutoCAD. The store's selection changes only on release, as Godot does, so the Inspector, the Outline and the undo history see one change, and Escape or another button gives the drag up with nothing changed. The gizmo and the pivot dots hide during the drag, so they don't sit on a selection that is about to change.

**Hundreds or thousands of pieces.** The test runs in screen space, at most once a frame, and only when the region or the camera has moved. Each piece's mesh boxes are projected first. A piece whose boxes miss the region is out, and one whose boxes lie wholly inside it is in. Only pieces that the region's edge crosses go on to their triangles. Releasing commits a selection that is already worked out. The outline of a large selection is the cost that's left, and § Performance below has the measurements.

## Left out

- Circle, fence and paint regions (3ds Max, Blender, Fusion). The lasso covers the irregular case.
- Intersect (Blender), and visible-only selection (Blender's solid mode, Unreal's option, Fusion's filter).
- A region tool in the tool bar. The box works in every selecting tool, so a tool of its own would add a mode with nothing to put in it.
- The Outline. Its Shift+click selects a range and its drag reorders rows, so a box there would take one of those away.

## Performance

Measured on 2026-11-09 with the Workshop sample _Ballest Of The Mall_ (3,750 pieces, `samples/Workshop`), in the Top pane, in headless Chromium on the real GPU (an AMD Radeon 890M), with React's production build and the dev hook kept. The seeded Large map wasn't usable for this: its pieces are mostly real lights, and it draws one frame in 5 to 7 seconds before anything is selected. On the Mall an idle frame takes 70 to 95 ms whatever the selection, so the numbers below sit on top of that.

The box itself:

| What                                       | Time                 |
| ------------------------------------------ | -------------------- |
| Working out what a box over the map holds  | 10 to 30 ms          |
| A frame while dragging over 196 pieces     | 90 ms, 103 at worst  |
| From release to the next frame, 196 pieces | 245 ms               |
| A frame while dragging over all 3,745      | 151 ms, 292 at worst |
| From release to the next frame, all 3,745  | 891 ms               |

What it costs to change the selection to so many pieces at once: from the change to the next frame, the middle of three tries, with each piece's outline already built once. Before is `main` at `8b2018adf`.

| Pieces selected | Before   | After    |
| --------------- | -------- | -------- |
| 100             | 302 ms   | 207 ms   |
| 300             | 321 ms   | 255 ms   |
| 1,000           | 671 ms   | 433 ms   |
| 3,750           | 2,578 ms | 1,245 ms |

The box was never what made a large selection slow. The panels were: with every panel closed, selecting 300 pieces took a third of the time. Three changes made the difference:

- **Align section.** It works out every button's plan to know which buttons to turn off, 15 or more at once. Each plan measured every unit's box again, and looked each item up with `ids.indexOf`. The boxes are now worked out once per selection (`selectedBoxes`), lookups go through `indexOfKey`, and a plan's preview marks are only drawn when the preview asks for them.
- **Status bar.** It named every item in the map on every selection change, to show a count. The names now follow the map, not the selection.
- **The drag's own store.** The drag lives in its own store (`editor/areaDrag.ts`). In the editor's store, every pointer move would run every selector in the app, and the Pivot section's work grows with the selection.

What is left grows with the selection, and none of it is the box:

- Each selected piece's outline is a draw call per mesh and a matrix update each frame, which is why frames with everything selected run at 200 to 230 ms.
- The first time a piece's outline shows, its edges are built.
- The Inspector still works through every unit.
