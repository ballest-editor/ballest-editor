# UI critique, round 9

Reviewer: Robin Ebers (role-played). Build: `feat/ui-redesign` at `eb9c41266`, desktop app, 1723×1078 CSS px window. Screenshots: `/home/spigelli/.cache/ballest-editor/ui-critique-round-9/shots/` (719 files, every surface in dark and light with `-light` twins; full-window pairs `100-editor-map` through `118-editor-validate`; `MANIFEST-A..D.md` with menu dumps, measurements and every bug-check result). Earlier rounds: `ui-critique-round-1.md` to `ui-critique-round-8.md`. System: `ui-system.md`.

Same scale. Theme by rule 12 from full-window shots at 100%.

## Scoreboard

| View                                    | R1 | R2 | R3 | R4 | R5 | R6 | R7/8 | R9    | T     | One line                                                                                                                                                                      |
| --------------------------------------- | -- | -- | -- | -- | -- | -- | ---- | ----- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall                                 | 4  | 6  | 5  | 7  | 8  | 8  | 9    | **9** | 9     | Both rows that were at 8 are at 9. Every round-8 gap and bug is verified fixed except one half-fix (name field spellcheck). Nothing is below 9.                               |
| Theme                                   | –  | –  | 2  | 7  | 7  | 8  | 9    | –     | **9** | Dark unchanged and right. Light has its three levels, 3:1 disabled text and card edges. One light contrast defect: the Not exported badge vanishes on the active project row. |
| Top bar and menu bar                    | 5  | 7  | 8  | 8  | 8  | 9  | 9    | 9     | 9     | Fine.                                                                                                                                                                         |
| Dock                                    | 4  | 6  | 7  | 8  | 8  | 9  | 9    | 9     | 9     | Tab ring inside the tab; strip buttons at −2 px.                                                                                                                              |
| Viewport chrome                         | 5  | 7  | 8  | 8  | 8  | 8  | 9    | 9     | 9     | Gizmo snaps frame at one scale; grid stays through the tween.                                                                                                                 |
| Inspector: map                          | 4  | 6  | 7  | 8  | 8  | 8  | 9    | 9     | 9     | Validate result survives selection and tab switches, resets on edit, returns on undo.                                                                                         |
| Inspector: item and group               | 3  | 7  | 8  | 8  | 8  | 8  | 9    | 9     | 9     | Fine.                                                                                                                                                                         |
| Outline                                 | 5  | 7  | 8  | 9  | 9  | 9  | 9    | 9     | 9     | Escape from its context menu rings the whole tree (bug 3).                                                                                                                    |
| Pieces                                  | 4  | 7  | 8  | 8  | 8  | 8  | 9    | 9     | 9     | Drops keep clear of items and stay at the hit point when clear. The push can be long (bug 5).                                                                                 |
| Prefabs                                 | 4  | 6  | 7  | 8  | 8  | 8  | 9    | 9     | 9     | Fine.                                                                                                                                                                         |
| Project panel                           | 4  | 6  | 7  | 8  | 8  | 8  | 9    | 9     | 9     | Drop zone spans the strip with a 2 px end line. Light active-row badge (bug 2).                                                                                               |
| Status bar, sync, notifications, toasts | 5  | 6  | 7  | 7  | 8  | 8  | 9    | 9     | 9     | Groups read by name, "2 groups" for two. Inside a group, Select all reads "Group" (bug 4).                                                                                    |
| Menus (content)                         | 5  | 7  | 8  | 8  | 8  | 9  | 9    | 9     | 9     | Select all with its KeyChip.                                                                                                                                                  |
| Settings › Game                         | 3  | 7  | 8  | 8  | 8  | 8  | 9    | 9     | 9     | Copy, Reveal and the fix in their own columns. The empty fourth column leaves 44 px (bug 8).                                                                                  |
| Settings dialog                         | 5  | 7  | 8  | 8  | 8  | 9  | 9    | 9     | 9     | Fine.                                                                                                                                                                         |
| Project settings                        | 4  | 6  | 8  | 8  | 8  | 8  | 9    | 9     | 9     | Tags compare against the saved state; toggle-back is clean.                                                                                                                   |
| Save, Rename, Duplicate, New project    | 3  | 8  | 8  | 8  | 9  | 9  | 9    | 9     | 9     | Still spellchecks the name (bug 1).                                                                                                                                           |
| Backups                                 | 3  | 7  | 8  | 8  | 8  | 8  | 9    | 9     | 9     | Fine.                                                                                                                                                                         |
| Start screen, Where to open             | 4  | 6  | 7  | 8  | 8  | 9  | 9    | 9     | 9     | Light cards carry the edge and shadow.                                                                                                                                        |
| Keyboard shortcuts                      | 6  | 7  | 8  | 8  | 8  | 8  | 9    | 9     | 9     | Fine.                                                                                                                                                                         |
| Split panes                             | 5  | 6  | 7  | 7  | 7  | 8  | 8    | 9     | 9     | "Top · Maximised", an "Esc to restore" chip, "Four panes (maximised)" in the button, the menu and View › Layout; first Escape restores and keeps the selection.               |
| Prefab definition tab                   | 4  | 7  | 8  | 8  | 8  | 8  | 9    | 9     | 9     | Fine.                                                                                                                                                                         |
| Light theme                             | 2  | 6  | 7  | 6  | 8  | 8  | 8    | 9     | 9     | Panel `#eef1f3`, card `#fafbfc`, popover white (1.09 and 1.04 apart); disabled `#8a9096` at 3.11:1 on card; 8% edges on inspector, Settings and start-screen cards.           |
| Display popover                         | –  | 5  | 7  | 8  | 8  | 8  | 9    | 9     | 9     | Fine.                                                                                                                                                                         |
| About dialog                            | –  | 4  | 8  | 8  | 8  | 8  | 9    | 9     | 9     | Build block selectable; labels not.                                                                                                                                           |

## What got verified

- **Split panes**: `117-editor-pane-max.png` shows "Perspective · Maximised" in the picker, an "Esc to restore" chip beside it and "Four panes (maximised)" on the Panes button; View › Layout agrees; one Escape restores and keeps the Goal selected, a second deselects. Right, Top and Front after gizmo snaps all read 1 px = 2.3 cm. The grid stays through the tween (slowed 25×; one real-speed frame confirms).
- **Light theme**: three surfaces measure as specified; disabled text 3.11:1 on card; `zoom-b-inspector-card-edge-light`, `zoom-c-settings-card-edge-light` and `zoom-d-light-card-edge` show the 8% edge; `80-start-screen-light.png` cards have edge and shadow.
- **Focus**: dock tab ring sits inside the tab with one 4 px edge; all eight strip icon buttons at −1.91 px; hover lifts within ±1 ΔL* across six targets in both themes.
- **Select all**: Ctrl+A in the viewport selects every item, the status bar reads "2 items" or "3 items", `getSelection()` stays empty, Ctrl+G then groups. Inspector labels do not select; the About build block, licences and notification text do.
- **Validate** persists through click, deselect, dock and map tab switches; resets after placing a piece; returns on undo.
- **Tags** toggle on then off leave no dot and disable Save and Revert; Clear is absent at zero tags.
- **Drops**: onto the Player Start the piece lands 257 cm away and the disk stays visible; onto clear grid the pivot projects to the exact drop point.
- **Tab strip**: a drop at x = 560 opens the tab; a 2 px end line shows at the last tab's edge during the drag.
- **Settings › Game**: Copy, Reveal and the fix align in columns on every row (`144c-game-columns.png`).
- **Status bar**: a selected group reads "Group" or its name ("Harbor Arches"); two read "2 groups".
- **Numeric fields and Name field** in the inspector, and the project name in the start screen: no spellcheck. (The dialogs are another matter: bug 1.)

## The "(backup)" row, re-judged

"Harbor Loop (backup)" truncates by 2 px at the default 260 px panel beside the Unsaved chip and clears at 262 px; beside a Not exported chip it would need about 283 px (`152-backup-row-truncation.png`). The name is not the problem; the suffix is. Mark a restored backup with a small "backup" pill after the name (same component as the tab's "Game" badge) and keep the name as the user typed it, so a 260 px panel shows "Harbor Loop · backup · Unsaved" with the name never cut. Verify: the row at 260 px shows the full "Harbor Loop".

## Bugs found this round

1. **The Save, Rename, Duplicate and New project dialogs still spellcheck the name.** `MapNameDialog.tsx:57` has no `spellCheck={false}`; "zzz qwrtp" gets a squiggle in both themes (`65b-light`, `21b-project-name-spellcheck`). Round 8's fix covered the inspector Name, the number fields and the filters, not the dialogs. A source scan finds nine more inputs without the attribute; set it on the shared Input once.
2. **Light: the Not exported badge disappears on the active project row.** Pill `227,232,236` on a row wash of `220,235,238` is 1.01:1; only its text shows (`61c-project-status-badges-light.png`). Give the neutral pill a tone step or an edge that holds on the selection wash.
3. **Escape from the Outline's context menu rings the whole tree** (260×950 px teal ring, both themes; `114x-editor-outline-focus-ring`). Closing by clicking outside does not. Return focus to the row, not the tree.
4. **Inside an entered group, Select all reads "Group"** in the status bar while the inspector says "2 items selected" and the corner card "16 m to 2 items"; the group row is also highlighted alongside its members. Count the members.
5. **Drop keep-clear can push a piece a long way**: 245 px and about 370 px from the pointer in two tests, off the left of the viewport in both. Prefer the nearest free slot inside the frustum, and never leave the view.
6. **Clicking empty viewport while inside a group leaves the group.** If intended, say so in the breadcrumb's tooltip; otherwise clear the selection and stay.
7. **Light disabled text is 2.84:1 on `--background`** (3.11 on card). The start screen and dialog footers sit on background.
8. **Settings › Game action columns end 44 px short** of the card edge because a fourth column is reserved and empty.
9. **Grid lines draw across pieces during the gizmo tween** (150 ms). Depth test the grid during the tween or fade it.
10. Minor: the group inspector lists members in a different order from the Outline; the Kicker prefab thumbnail sits left of centre; a Recent row can sit under the tab bar after placing until the list scrolls; the chip reads "Not exported" rather than "Saved" after save → place → undo (acceptable, the document equals the saved one but the Saved state was transient).
11. Harness, not app: localStorage needs a graceful quit; a `kill -9` even 22 s after a change can lose it. Agents in later rounds should quit through File › Quit.

## Theme (9)

Dark is as in round 8 and nothing moved: body `11,13,15`, panel `22,25,28`, popover `30,34,38`, viewport top rows `14,16,19` flat. Light now has the three levels on paper (1.09 then 1.04), which to the eye reads as two levels and a shadow; that is acceptable because the shadow and edge carry it, and raising the popover above white is not possible. The light start screen (`80-start-screen-light.png`) with its edged cards and the teal line on pale blue-grey is the cleanest light frame so far. The two defects are bugs 2 and 7, both one-token fixes.

## Per view (deltas only)

### Split panes (9)

The maximised state is now unmistakable: the picker label, the restore chip and the Panes button all say so, and the three ortho views frame at one scale after a snap. Nothing left on the list.

### Light theme (9)

Levels, disabled contrast and card edges all landed. Bugs 2 and 7 to close.

### Project panel (9)

Drop zone and end line fixed. Bug 2 in light; the backup suffix above.

### Status bar (9)

Group names, "2 groups". Bug 4.

### Pieces (9)

Drops are right; bug 5 is about how far the push goes.

## What to do next, by score impact

1. **Spellcheck off on the shared Input** (bug 1); **Not exported pill on the active row in light** (bug 2); **disabled text on background** (bug 7).
2. **Outline context-menu Escape focus** (bug 3); **Select all inside a group** (bug 4).
3. **Drop push bounded to the frustum** (bug 5); **empty-click inside a group** decided (bug 6).
4. **Backup marker as a pill**, not a name suffix.
5. **Settings › Game fourth column**, **grid during the tween**, the minor list.

## Not reviewed

Native prompts, Import clash / Overwrite / Replace published, Release notes (external), update pill, popped-out panels, Game link first-run when something is missing, splitter dragging, gizmo handle interaction, exported and changed-in-game chip states, Export progress in the chip.
