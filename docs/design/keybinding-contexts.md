# Keybinding contexts

A binding is a chord string on an action (`domain/Keybinds.ts`). Where it works is a condition on the action, a `When` (`domain/keyContext.ts`): the drags it is live in, the tools and the platforms. The editor reads the matching `KeyContext` off its state in one place (`editor/keyContext.ts`), and a chord fires only the actions whose condition holds there. That is what lets one key mean two things: Ctrl flies the camera down, and turns snapping off once a drag has begun; X is half of Ctrl+X cut, and locks a move to its axis; Escape deselects, and cancels a drag. It is the system VS Code's `when` clauses and Blender's keymaps are, kept to a struct a menu can edit.

## The context

| Dimension  | Values                                                                        | Read from                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `drag`     | `none`, `camera`, `move`, `turn`, `scale`, `place`, `stroke`, `scrub`, `area` | `sceneRegistry`: a look, a gizmo handle's kind, a body drag (a move), a box or lasso, a paint stroke; `preview` for a scrub |
| `tool`     | `select`, `translate`, `rotate`, `scale`, `paint`                             | the store's `tool`                                                                                                          |
| `platform` | `desktop`, `browser`                                                          | `capabilities.play`                                                                                                         |

Drags are exclusive: one at a time. The ones that change the map (move, turn, scale, place, stroke) are "while dragging" in Settings' words (`describeWhen`); looking, a number field's scrub and a box or lasso (`area`, "while selecting") are kept apart. A move is a move handle's drag, the selection's body dragged, or an Alt+drag's copy; the names follow [SNAPPING.md](../SNAPPING.md) ("a move", "a turn", "a scale"), not the tools', since the Move tool can be picked with nothing moving and a body drag moves things in any tool. `place` is a palette or prefab drop, which is the browser's own drag and reports modifiers only, so a snapping-off key held through one has to be a modifier (`dropSnapOff`).

What stays in code, on purpose:

- **The gate.** Text fields, dialogs, menus and Enter on a button keep their keys (`isEditorKeyEvent`). It reads the DOM, before the keymap.
- **Selection state and open tabs** decide whether a command does anything, inside the command, not whether its binding exists.
- **W as forward and move** is settled by the "movement keys need look" setting and what is held (`flyKeys`), not by context.
- **A bare Ctrl's 120 ms wait** and its suppression once it is part of a chord (`HeldKeys`) are chord timing.
- **Escape's order** with nothing dragged (tracking points, then a maximised pane, then the entered group, then the selection) is one "back out" intent inside `deselect`.
- **The tool's plain primary button**: it selects, or paints. Only modified clicks are bindings.

## The conditions

`actionWhen` gives every action its `When`. An unset field holds always, except `drag`, which unset means "nothing dragged", so an action has to say if it works during a drag.

| Actions                                                    | When                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| one-shots: tools, edit, view, file, snap magnet, help      | nothing dragged                                         |
| the fly keys, look keys, fly faster, camera speed          | nothing dragged, looking, a move, turn or scale         |
| `addToSelection`, `toggleSelection`, `removeFromSelection` | Select, Move, Rotate and Scale tools                    |
| `lassoSelect`                                              | a box or lasso                                          |
| `paintWholePiece`, `pickPaint`                             | Paint tool                                              |
| `snapOff`                                                  | a move, turn, scale or placement                        |
| `snapHold`                                                 | a move or turn                                          |
| `snapLockX/Y/Z`, `snapPlaneX/Y/Z`                          | a move                                                  |
| `snapOnlyConnectors`, `snapOnlyMesh`, `snapOnlyAlignment`  | the transforms that snap to that kind (`SNAP_KINDS_OF`) |
| `cancelDrag`                                               | a move, turn, scale, or a box or lasso                  |
| `playMap`                                                  | desktop                                                 |

The fly keys keep flying during a gizmo drag because `FlyCamera` never checked for one; it lets go of its modifiers then, so Ctrl is snapping's. `cancelDrag` (Escape) replaced the gizmo's and the body drag's "Escape or the deselect key": a save from before it had a key of its own keeps cancelling on what `deselect` was bound to (`mergeKeybinds`).

## Dispatch

`resolveChord(keybinds, ctx, chord)` returns the actions bound to the chord whose condition holds, the narrowest first (`specificity`: a tool or platform named counts, and a drag only when one is required), ties in the table's order. Everything that reads a chord goes through it or `firesHere`:

- `useActionKeys` runs the first resolved action with a command. During a look, a drag or a scrub no one-shot resolves, so undo, delete and the rest wait for the drag's one undo step; a chord that resolves to nothing falls through to the browser, which is how F5 still reloads in a browser, where Play has no binding.
- `editor/snap/dragKeys.ts` is the drag's keyboard: `handleDragKey` takes a key only when it resolves to one of `duringDragActions` in the drag under way, reading the chord without Ctrl and also bare, since Ctrl and Shift are drag keys themselves. `cancelsDrag` is `cancelDrag` in that drag. `dragHintsOf` lists, for the status bar, every action with a hint word (`keybindActionHints`) that is live in the drag, so a turn offers no lock and a scale only the mesh without a table of its own, and a key bound to more drags shows up there with no other change.
- The viewport's click selection and the paint tool's clicks resolve the mouse chord in the context, so Shift+click adds to the selection in the selecting tools and paints the whole piece in Paint, and Alt+click picks paint in Paint and orbits elsewhere.

## Conflicts

`conflictingBindings` compares bindings, not kinds: two actions on one chord contend when their conditions can hold at once (`overlaps`). Held camera keys never contend with anything else (the setting, and the camera letting go of its modifiers in a drag, decide). Where one condition lies within the other (`within`) and the key fires one action at a time, the narrower **overrides** the broader there rather than clashing: the eyedropper takes Alt+click from orbit in Paint, and the cap says so on hover. Held keys and a drag's keys all apply at once, so between them any overlap is a clash. Settings marks clashes red (`clashingChords`) and names the other action. Under the label of every action that doesn't work everywhere, Settings › Keybinds and Keyboard shortcuts say where it does (`KeybindWhen`: "While moving", "Paint tool", "Desktop app"), and the search finds those words.

## Next

Each a PR of its own, in this order:

1. **Per-binding conditions.** A binding becomes `{ chord, when }`, stored as `ballest-editor.keybinds.v5` (`Schema.Union` of the string and the struct, decoded per binding so one bad value drops one binding; v4 read as a fallback; only actions that differ from the defaults written). Each action gains an `allows`, the widest condition a user may set, and a "When…" menu on the cap offers what `allows` permits: not dragging, while dragging (moving, turning, scaling, placing, painting), while looking, the tools.
2. **Widen `allows` one action at a time**, making its command cope with a drag in progress: the axis switch mid-move (which has to restart the drag's maths), the view keys, the snap magnet, Frame. Undo, delete, copy and the file actions stay "not dragging".
3. **The hint line as a consumer.** `dragHintsOf` generalises to "the keys live here" for the tool as well as the drag, feeding the status bar's hint line (`statusHint.ts`) in the Paint tool: `Shift` whole piece, `Alt + LMB` pick.

Open: whether a palette drop should take the move's narrowing keys (the drop lands on the same targets as a move, so J, M and L would apply, but the browser's drag reports no key codes); whether `altDragDuplicates` and the orthographic wheel should become bindings; whether a paint stroke should cancel on Escape as a drag does.
