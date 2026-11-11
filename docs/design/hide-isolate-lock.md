# Design: hide, isolate and lock

Written 2026-11-09 for #81, and built the same day. What is true now is in [DESKTOP.md § Hide, isolate and lock](../DESKTOP.md#hide-isolate-and-lock); this is the comparison it came from and the reasons for each choice.

The game has none of it: its strings (`assets/strings.json`) have no hide, lock or isolate for the in-game editor, and its hotkey overlay, whose names and keys `domain/Keybinds.ts` follows, has none of them. Its one use of H is Show/Hide Overlay while spectating a ghost (`IMC_GhostPOV` in `assets/keybinds.json`), which the editor leaves out. So the names and keys come from the other editors.

## What other apps do

Read from each app's own documentation on 2026-11-09, not from memory. A point the docs don't state is marked unconfirmed.

### Blender (5.2 manual)

- [Show/Hide](https://docs.blender.org/manual/en/latest/scene_layout/object/editing/show_hide.html): Hide Selected H, Hide Unselected Shift+H, Show Hidden Alt+H. [The operator](https://docs.blender.org/api/current/bpy.ops.object.html) `hide_view_clear(select=True)` selects what it reveals.
- [The Outliner](https://docs.blender.org/manual/en/latest/editors/outliner/interface.html) has an eye (Hide in Viewport, per view layer, what H and Alt+H change), a monitor (Disable in Viewports, a lasting hide Alt+H leaves alone) and an arrow (Disable Selection). Hidden objects stay listed. Shift+click applies a toggle to the children too.
- [Local View](https://docs.blender.org/manual/en/latest/editors/3dview/navigate/local_view.html), Numpad / or /, isolates the selection per 3D Viewport; the same key leaves. Alt+/ takes objects out of it. Its quad view is one viewport split four ways, so the four share one local view.
- There is no lock: Disable Selection is "for reference images that you only want to display and never select/move". It still draws. [Snapping](https://docs.blender.org/manual/en/latest/editors/3dview/controls/snapping.html) has an opt-in Exclude Non-Selectable, so unselectable objects are snap targets by default.

### 3ds Max (2025–2027 help)

- [Hide rollout](https://help.autodesk.com/cloudhelp/2024/ENU/3DSMax-Basics/files/GUID-04F9913B-961A-44C2-BACD-898B06EBF226.htm): Hide Selected, Hide Unselected, Hide by Name, Hide by Hit, Unhide All; [the quad menu](https://help.autodesk.com/cloudhelp/2026/ENU/3DSMax-Basics/files/GUID-3A803F43-6F87-40FB-97CA-33844078AF9A.htm) has Isolate Selection, End Isolate, Hide, Unhide All, Freeze Selection, Unfreeze All. A default object-level hide key is unconfirmed.
- [Isolate Selection](https://help.autodesk.com/cloudhelp/2027/ENU/3dsMax-Basics/files/selecting_objects/GUID-FCA01DAD-15D6-4432-A10D-C184C7CB003C.html), Alt+Q, "temporarily hides all objects except those you're working on"; a highlighted status-bar toggle or End Isolate leaves it and restores what it hid. Zoom Extents on Isolate is off by default. Per viewport or scene-wide is unconfirmed.
- [Freeze](https://help.autodesk.com/cloudhelp/2025/ENU/3DSMax-Basics/files/GUID-B6650710-B62B-4BAD-8178-81A12DFB2432.htm): frozen objects "remain visible, but can't be selected, and therefore can't be directly transformed", drawn grey unless Show Frozen in Gray is off. [Snap to frozen objects](https://help.autodesk.com/cloudhelp/2025/ENU/3DSMax-Basics/files/GUID-47E8B8FB-6A32-44DA-AFF1-6D959B1E45F9.htm) is off by default.
- [The Scene Explorer](https://help.autodesk.com/cloudhelp/2023/ENU/3DSMax-Manage-Scenes/files/GUID-5600AB96-510B-4F33-B2BC-C00B555283B2.htm) keeps hidden objects listed in italics and frozen ones in grey, with a light-bulb column.

### Maya (2025–2026 help)

- [Show/Hide](https://help.autodesk.com/cloudhelp/2025/ENU/Maya-Basics/files/GUID-79D74D3C-FD62-4703-B3EE-3C699F2757DF.htm): Ctrl+H hides, H toggles, Shift+H shows, Ctrl+Shift+H shows the last hidden. Hidden objects stay in the Outliner in grey and are selected there.
- [Isolate Select](https://help.autodesk.com/cloudhelp/2024/ENU/Maya-Basics/files/GUID-A15B3808-D3C4-482F-98DD-BC7F45E13A36.htm) is per panel, Ctrl+1 on and off, marked "Isolate" in the panel. Auto Load New Objects, on by default, keeps what is made meanwhile in it.
- Lock is a [display layer](https://help.autodesk.com/cloudhelp/2020/ENU/Maya-Basics/files/GUID-8415A1A6-7798-43F5-9D64-783BD0642071.htm)'s mode: Template (wireframe, unselectable, not snapped to) or Reference (drawn as usual, unselectable, "You can snap to objects in the layer").

### Unreal Engine 5

- [H hides the selection, Ctrl+H shows all](https://dev.epicgames.com/documentation/unreal-engine/transforming-actors-in-unreal-engine); [the Outliner's eye](https://dev.epicgames.com/documentation/unreal-engine/unreal-editor-interface) does the same per actor. H is [editor-only for the session](https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/Actor?application_version=5.4) ("for the duration of the current editor session"), apart from the saved Actor Hidden In Game.
- Lock Actor Movement stops an actor being moved but leaves it selectable. A [locked group](https://dev.epicgames.com/documentation/en-us/unreal-engine/grouping-actors-in-unreal-engine) is another idea: any member selects the whole group. Isolate and hide-unselected keys are unconfirmed.

### Unity 6

- [Scene visibility](https://docs.unity.com/en-us/engine/6000.0/manual/working-with-scenes/scenes-manage-gameobjects/scene-visibility): the Hierarchy's eye or H hides an object and its children, Alt+click the object alone, and the icon has mixed states. Shift+H isolates; Shift+H again or the Scene view's Exit button "reverts back to your original Scene visibility settings", and visibility changes made while isolated are lost. A master toggle mutes every hide without clearing it. The state is kept in `Library/`, per user, out of the scene file.
- [Scene picking](https://docs.unity.com/en-us/engine/6000.0/manual/working-with-scenes/scenes-manage-gameobjects/scene-picking/controls): the hand icon or L turns picking off; the object "is still rendered in the Scene view, but you can't select or modify it in the Scene view", and a box select leaves it out. Per user, "not recorded as a modification to the scene".

### Godot 4

- [Lock, Ctrl+L](https://docs.godotengine.org/en/stable/tutorials/3d/introduction_to_3d.html), prevents "selection and movement in the viewport"; "locked nodes can only be selected in the scene tree", which shows a padlock that unlocks on a click. The scene tree's eye is the node's own `visible`, saved with the scene. Isolate isn't documented.

### Autodesk Fusion

- [The browser's visibility icon and V](https://help.autodesk.com/view/fusion360/ENU/?contextId=ASM-VISIBILITY) hide and show; [Isolate and Unisolate](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-SELECTION.htm) hide everything else and bring back only what Isolate hid. Components can be made unselectable, a badge on their icon. Fusion has one canvas, so isolation is global.

### Rhino 8

- [Hide Ctrl+H, Show Ctrl+Alt+H, ShowSelected, HideSwap, Isolate, Unisolate](https://docs.mcneel.com/rhino/8/help/en-us/commands/hide.htm). Isolate is global and keeps locked objects in view.
- [Lock Ctrl+L, Unlock Ctrl+Alt+L, UnlockSelected, LockSwap](https://docs.mcneel.com/rhino/8/help/en-us/commands/lock.htm): locked objects "can be seen and snapped to, but cannot be selected for editing", drawn [in a lock colour or see-through](https://docs.mcneel.com/rhino/8/help/en-us/options/view_display_mode_objects.htm).

### SketchUp

- [Hide, Unhide, Lock, Unlock](https://help.sketchup.com/en/context-menu-items-entities): "Locked entities cannot be moved or edited", but are selectable. [The Outliner](https://help.sketchup.com/en/sketchup/working-hierarchies-outliner) keeps hidden entities listed with Hidden and Locked icons, and one selected there shows as a hatched outline. [Hide Rest of Model](https://help.sketchup.com/en/sketchup/clipping-and-missing-faces) is a global view toggle that works while a group is open. [Locked geometry draws red](https://help.sketchup.com/en/sketchup/customizing-modeling-settings-complement-style).

### Figma

- [Show/hide, Ctrl+Shift+H](https://help.figma.com/hc/en-us/articles/360041112614-Toggle-visibility-to-hide-layers): hidden layers stay in the Layers panel, greyed, can't be picked on the canvas but can in the panel. The eye appears on hover.
- [Lock, Ctrl+Shift+L](https://help.figma.com/hc/en-us/articles/360041596573-Lock-and-unlock-layers), stops a layer being picked or moved on the canvas; "you can still select a locked layer in the Layers Panel or adjust any properties". Locking a group locks its children.

## Patterns across them

- **Hide** is H in Blender, Unity and Unreal, with Alt+H (Blender) or Ctrl+H (Unreal) to show everything. Every app keeps hidden objects listed in its outliner, greyed or in italics, and selectable there. Nothing hidden is picked in the viewport.
- **Isolate** is a view that ends and gives back what it hid: Max's End Isolate, Unity's Exit, Fusion's Unisolate, Blender's second press of /. Maya and Blender scope it to one viewport; Unity, Fusion and Rhino to the whole scene. Blender's quad view, the nearest thing to our panes, is one viewport and shares it. Maya keeps objects made meanwhile in it.
- **Lock** means two things. Unity, Figma, Godot, Max, Rhino and Blender's Disable Selection: drawn, but not picked in the viewport, and reachable from the outliner (Unity, Figma, Godot). Unreal and SketchUp: selectable, but not movable. Whether a locked object is a snap target splits too: yes in Rhino, Maya's Reference and Blender by default; no in Max by default and Maya's Template.
- **Saved or not**: Blender, Max, Rhino, SketchUp, Figma and Godot save it with the file. Unity keeps it per user, out of the scene, and Unreal's H lasts a session. The engines are the ones whose scenes a team shares.

## What Ballest Editor does, and why

### Hidden and locked are each item's, in the sidecar

- **Where it lives.** An item's sidecar entry gets `hidden: true` and `locked: true`, beside its name and tags ([PROJECTS.md § The files](../PROJECTS.md#the-files)). The issue said "the map's editor prefs", written before the sidecar existed (#112). The sidecar is right: the state belongs to items, and only the sidecar has the stable keys that find an item again after the game rewrote the file, so a hidden piece stays hidden after an in-game edit of others. The map's prefs are keyed by the map's name and kept on one machine. The game's file never holds it, so export and Play write the same bytes either way.
- **In the document, so undoable and saved.** As in Blender, Max, Rhino, SketchUp and Figma. Unity and Unreal keep it out of a scene a team shares; a project here is one person's folder for now, and the issue asks that it survive a reload. Hiding is one undo step that marks the map unsaved.
- **Per item, not per group.** The selection is item keys, and so is the sidecar's data. Hiding or locking a group, from its row or with it selected, sets every item under it; a group's eye shows all, some (faint, Unity's mixed state) or none. One member of a group can be hidden from its row or from inside the group, as Unity's Alt+click does. There is one level of hide, not Blender's two or Max's categories: Show all brings back everything.

### What hidden and locked do

|                                                                 | Hidden                                             | Locked                                                             |
| :-------------------------------------------------------------- | :------------------------------------------------- | :----------------------------------------------------------------- |
| Drawn                                                           | no                                                 | yes, as it is (no grey or tint: the panes show the game's colours) |
| Click, double-click, body drag, Select all, box and lasso (#85) | passes through it                                  | passes through it                                                  |
| Snapping, placing on it, its open ends ringed                   | no                                                 | yes (Rhino, Maya's Reference, Blender)                             |
| Outline                                                         | listed, name in italics and muted, an eye          | listed, a padlock                                                  |
| Selected from the Outline                                       | yes, and edits apply                               | yes, and edits apply (Unity, Figma)                                |
| Paint tool                                                      | passes through it                                  | refuses, and the status bar says it's locked                       |
| Frame all                                                       | left out                                           | framed                                                             |
| Member of a selected group                                      | moves, copies and deletes with the group           | the same                                                           |
| Duplicate, paste                                                | the copy keeps the flag, as it keeps name and tags | the same                                                           |
| Export, Play                                                    | written as any item: the game draws everything     | the same                                                           |

- **Lock is "can't be picked in the viewport".** That is the issue's wording and most apps'. Not Unreal's and SketchUp's "can't move": a locked member of a group would then stay behind when the group moves and tear it apart, and a selection made on purpose in the Outline is a choice, as Unity and Figma treat it.
- **A pick goes through.** A click on a locked or hidden piece lands on what is behind it, as Unity's pickability does, so a locked floor can be clicked through to the pieces on it. A click on a visible member of a group still selects the whole group, hidden and locked members too, so the group keeps its shape when it moves.
- **Locked pieces stay snap targets.** Locking the track built so far and building on it is the case that matters here.
- **Hiding or locking deselects** what it hides or locks, as Blender and Rhino do, since the viewport can no longer pick it. **Show all and Unlock all select** what they bring back (Blender's Alt+H), so a second press of H or Ctrl+L puts it back.
- **H and Ctrl+L toggle.** With all of the selection hidden already (picked in the Outline), H shows it; the same for Ctrl+L. That is Unity's H and the only way to unhide one piece without the Outline's eye.

### Isolate is a view of the tab

- **Every pane of the tab, not one.** Blender's quad view shares one local view, and our panes are one viewport divided. Isolating in one pane and building in another would hide the context of the other.
- **Outside the document and its history,** like the Outline's collapsed groups, and gone with the tab. It's how the user is looking, not something about the map.
- **What it holds is what it leaves out.** Pieces placed, pasted or duplicated while isolated show, as Maya's Auto Load New Objects does. Hides and locks made meanwhile are the document's and outlast it, unlike Unity, which discards them: one model of what is hidden is easier to keep in mind than two.
- **Leaving it** is the same key again (Shift+H, or Numpad /), View › End isolation, or the chip beside each pane's card, which names the key, as Max's highlighted toggle and Unity's Exit button do. Escape doesn't, as it already deselects, leaves groups and restores a maximised pane. The camera stays where it was going in and coming out (Max's default).
- **No Hide unselected.** Blender's Shift+H and Max's Hide Unselected change the document for what isolate does as a view. Shift+H is Unity's isolate.

### Keys

| Action                      | Key               | From                        |
| :-------------------------- | :---------------- | :-------------------------- |
| Hide / show the selection   | H                 | Blender, Unity, Unreal      |
| Show all                    | Alt+H             | Blender                     |
| Isolate / end isolation     | Shift+H, Numpad / | Unity, Blender's local view |
| Lock / unlock the selection | Ctrl+L            | Godot, Rhino                |
| Unlock all                  | Alt+L             | Alt+H's pair                |

L alone (Unity) is snapping's "guides only" during a drag, and a key held before the drag would lock the selection instead, so lock takes Ctrl+L. Ctrl+Alt+L, Rhino's Unlock, locks the screen on most Linux desktops.

## Left out, and open

- A tint or grey for locked pieces (Max, Rhino, SketchUp). A click passing through is the only sign in the viewport. If that proves confusing, a faint tint is the next step.
- Blender's lasting second level of hide, Max's Hide by Category, Unity's master toggle, Rhino's swaps.
- Prefab definitions have no sidecar, so hiding in a definition's tab marks it unsaved and is lost when it's saved.
- Lock was first built to block only the viewport's picks. Since #264 it also refuses every edit that would move, turn, scale or paint a locked piece (DESKTOP.md); Delete, Duplicate and tags still act on one selected in the Outline.
- A laser's beam still stops on a hidden piece, as it would in the game.
