# UI critique, round 5

Reviewer: Robin Ebers (role-played). Build: `feat/ui-redesign` at `91fdb5d06`, desktop app, 1723×1078 CSS px window. Screenshots: `/home/spigelli/.cache/ballest-editor/ui-critique-round-5/shots/` (445 files, every surface in dark and light with `-light` twins; the full-window pairs are `100-editor-map` through `113-editor-tooltip`; `MANIFEST-A..D.md` hold menu dumps, bug-check results, badge colours and the dark-theme measurements). Earlier rounds: `ui-critique-round-1.md` to `ui-critique-round-4.md`. System: `ui-system.md`.

Same scale. Theme judged by rule 12 from full-window shots at 100%. **The dark bar moved this round**: the owner asked for dark mode to be less muted and dull, with a more contrasty near-black base and vibrant accents, so dark is scored against that and the doc describes the target by its properties.

## Scoreboard

| View                                    | R1 | R2 | R3 | R4 | R5    | T     | One line                                                                                                                                      |
| --------------------------------------- | -- | -- | -- | -- | ----- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall                                 | 4  | 6  | 5  | 7  | **8** | 7     | Every round-4 item landed and verified. Light is now a real theme. Dark is correct but timid, and the owner wants it bolder.                  |
| Theme                                   | –  | –  | 2  | 7  | –     | **7** | Light 8. Dark 6 against the new bar: it is a narrow band of mid-dark grey with a desaturated accent, not a contrasty black with vivid colour. |
| Top bar and menu bar                    | 5  | 7  | 8  | 8  | 8     | 7     | Fine. The Play tooltip covers the inspector's ⋯.                                                                                              |
| Dock                                    | 4  | 6  | 7  | 8  | 8     | 7     | Project is the default panel. Clicking the active Outline tab clears the selection.                                                           |
| Viewport chrome                         | 5  | 7  | 8  | 8  | 8     | 7     | Toolbar sits above all panes but still on the vertical divider. Every pane picker tooltip says Num 5.                                         |
| Inspector: map                          | 4  | 6  | 7  | 8  | 8     | 7     | Creator tooltip only when truncated.                                                                                                          |
| Inspector: item and group               | 3  | 7  | 8  | 8  | 8     | 7     | Axis tabs at 85% chroma read right. Gizmo sits on one member of a multi-selection.                                                            |
| Outline                                 | 5  | 7  | 8  | 9  | 9     | 8     | Thumbnails, glyphs, teal wash. Context menu shortcuts are plain text while menubar ones are pills.                                            |
| Pieces                                  | 4  | 7  | 8  | 8  | 8     | 8     | Transparent thumbnails in both themes; numbered duplicates. The seven Lights are identical grey tiles.                                        |
| Prefabs                                 | 4  | 6  | 7  | 8  | 8     | 7     | Row uses ⋮ where everything else uses ⋯; "INSTANCE OF ASDF" uppercases a user name.                                                           |
| Project panel                           | 4  | 6  | 7  | 8  | 8     | 7     | Untouched maps are clean.                                                                                                                     |
| Status bar, sync, notifications, toasts | 5  | 6  | 7  | 7  | 8     | 7     | "Saved" chip, bell clears on open, popover seam gone. Saved shows 0.8 to 1.8 s, not 2.                                                        |
| Menus (content)                         | 5  | 7  | 8  | 8  | 8     | 7     | Fine.                                                                                                                                         |
| Settings › Game                         | 3  | 7  | 8  | 8  | 8     | 7     | Fine.                                                                                                                                         |
| Settings dialog                         | 5  | 7  | 8  | 8  | 8     | 7     | Fine.                                                                                                                                         |
| Project settings                        | 4  | 6  | 8  | 8  | 8     | 7     | Breadcrumb has one separator.                                                                                                                 |
| Save, Rename, Duplicate, New project    | 3  | 8  | 8  | 8  | 9     | 8     | Selection is the accent at 30%.                                                                                                               |
| Backups                                 | 3  | 7  | 8  | 8  | 8     | 7     | Fine.                                                                                                                                         |
| Start screen, Where to open             | 4  | 6  | 7  | 8  | 8     | 8     | Window title fixed, ball is the accent.                                                                                                       |
| Keyboard shortcuts                      | 6  | 7  | 8  | 8  | 8     | 7     | Fine.                                                                                                                                         |
| Split panes                             | 5  | 6  | 7  | 7  | 7     | 6     | Light four-pane is still blue over grey.                                                                                                      |
| Prefab definition tab                   | 4  | 7  | 8  | 8  | 8     | 7     | Light prefab side faces still blend into the water.                                                                                           |
| Light theme                             | 2  | 6  | 7  | 6  | 8     | 8     | Thumbnails, grid, water and backdrop all fixed.                                                                                               |
| Display popover                         | –  | 5  | 7  | 8  | 8     | 7     | No scene bleed at 95%.                                                                                                                        |
| About dialog                            | –  | 4  | 8  | 8  | 8     | 7     | Fine.                                                                                                                                         |

## What got fixed (verified)

- **Light viewport.** Thumbnails render in-app on a transparent background in list, grid, Hidden and Outline (`102-editor-pieces-grid-light.png`); the grid is two steps lighter with no moiré at the horizon (`100-editor-map-light.png`); the water fades into the backdrop (`zoom-d-water-horizon.png`); the light clear colour is a pale grey-blue.
- **Glass at 95%.** The sync and Display popovers no longer show the scene through them; the notifications seam is gone.
- **Accent on selection, the hero ball and the axis tabs at 85%** (`94-selection-colour`, `80-start-screen.png`, `30f-axis-tabs.png`).
- **Toolbar above all panes**, centred on the viewport.
- **Untouched map is clean**: no dot, no row badge, no status chip; the first edit dirties it; closing the last tab leaves a clean Untitled; window title is "Untitled Project – Ballest Editor" and gains the dot only on edit (slice C checks 70, 70b, 72, 72b).
- **Focus returns at close start**: Ctrl+D fires 100 ms after Escape from a menu or from About, both themes.
- **"Saved" chip** in green for about a second after a save; **bell badge** clears on open.
- Breadcrumb has one separator; the creator tooltip only appears when truncated; the extractor note reads "This piece has no mesh to show."; Hidden duplicates are numbered; the Pieces scrollbar resets on empty results; Project is the default panel; placed pieces spread in rows of three.

## Theme

### Light (8)

`100-editor-map-light.png`, `101-editor-item-light.png`, `102-editor-pieces-grid-light.png`: pale grey-blue viewport, readable grid, thumbnails on white tiles, teal accent, amber and green status pills. It reads as one product with the dark theme and as a tool, not a document. Two things remain: in four-pane the top row is water-blue and the bottom row is grey (`103-editor-four-panes-light.png`), and the prefab's pale teal side faces vanish into the water (`111-editor-prefab-tab-light.png`). Tint the light ortho panes toward the water as was done for the light clear colour, and darken the light water one step.

### Dark (6, against the new bar)

What is there is correct by the round-3 rules and the owner has now moved the bar, so this is a direction, not a fault. Measured (slice D): body `rgb(20,22,24)`, panels `rgb(28,31,35)`, menus and dialogs `rgb(36,40,44)`, accent `oklch(0.64 0.105 210)`, body text `rgb(240,242,244)` at 14.7:1. The text contrast is fine. The problem is that every surface sits inside a 16-point band of mid-dark grey (20 to 36) and the accent has 0.105 chroma, so the whole screen is a soft charcoal with a dusty teal on it (`100-editor-map.png`, `105-editor-settings.png`, `80-start-screen.png`). It is tasteful and it is dull. The owner's word was muted, and that is exactly what it is.

**The target, by its properties.** The best modern dark themes for developer and creative tools share these:

1. **A near-black base.** Background around `rgb(9,11,13)` to `rgb(13,15,17)`, not 20. The window should read as black at a glance, with the chrome lifting off it.
2. **Bigger elevation steps.** Raised surfaces 8 to 10 points above the base rather than 3 to 4: panels around `rgb(22,25,28)`, popovers and menus around `rgb(30,34,38)`. The eye needs to see three distinct levels without a border.
3. **Borders that read.** On a black base, hairlines at white 10 to 12% rather than 6%, so panels have an edge; keep them at 65% strength.
4. **Text near white.** Body `rgb(245,247,249)`, secondary around `rgb(180,186,192)`, tertiary around `rgb(130,137,144)`. Secondary text at 209 is too close to body; the three tiers should be clearly three.
5. **One vivid accent.** The same blue-teal hue but at 0.15 to 0.17 chroma and L 0.70 to 0.74, so it glows on black instead of sitting on grey: around `oklch(0.72 0.16 210)`. Use it at full strength on the Play button, the active tool, the active tab underline, focus rings and links; the 12% selection wash stays.
6. **Status colours at full vibrancy.** On black, the amber, green and red pills can and should be saturated: a 16 to 20% tint with a fully saturated foreground, not the current muted tints. The dirty dot likewise.
7. **Hover and pressed states a full step brighter**, not a 3% nudge, so the UI answers the cursor.
8. **The viewport darker too.** With a near-black chrome the current water (a mid teal-blue) will look washed out; pull the dark water and clear colour down so the scene's objects pop against it, and keep the horizon haze subtle.
9. **Light stays as it is.** This is a dark-only change; the light theme's contrast and chroma are right.

Judge it the same way: full-window at 100%. If the chrome still reads as grey, the base is not dark enough; if the accent reads as the same teal as before, the chroma is not up enough.

### Both

- The sync popover opens over the toolbar and hides it (`107-editor-popover.png`). Anchor it above the toolbar or offset it.
- Context-menu shortcuts are plain text while menubar shortcuts are pills (`112-editor-context-menu.png`). One KeyChip.
- The prefab row's ⋮ should be ⋯ like every other row.
- The seven Lights pieces show as identical grey tiles with a dot (`29h-lights-category.png`). Give each light a distinct glyph (point, spot, rect, card) tinted by the theme.

## Bugs found this round

1. **Clicking the already-active Outline tab clears the selection** (slice A). Switching away and back keeps it.
2. **Every pane picker tooltip says Num 5**, the Perspective key, including "Pane view: Top".
3. **Undo back to the original state leaves the dirty dot on** (seen once; not reproduced).
4. **Sync popover covers the toolbar** (above).
5. **"Saved" chip shows for 0.8 to 1.8 s**, timed from the file's modified time rather than from the chip's appearance; a re-save flashes "Not exported" for up to 340 ms before "Saved".
6. **Placement spread ignores pieces placed earlier**: the first of a new batch lands exactly on a piece from a previous batch.
7. **Lights are identical tiles** (above); some Hidden thumbnails nearly vanish on their tile (white pieces in light, "Tech Subtle" in dark).
8. **Prefab instance eyebrow uppercases the prefab's name** ("INSTANCE OF ASDF").
9. **Play tooltip covers the inspector's ⋯**; the tab tooltip covers the Perspective picker.
10. **Light four-pane** is two halves; **light prefab** side faces blend into the water.
11. **The document scrolls about 1 px** when driven by script; check whether a user can reach it.
12. Minor: the "rejected" tooltip on three Hidden pieces still reads like a developer note; the Units tooltip touches the description under it; long tooltip paths break mid-word; the dimmed group frame is faint in light; "Not exported" popover has no body text; Group looks enabled with one item selected.

## Per view (deltas only)

### Viewport chrome (8, T 7)

Toolbar now a sibling above the panes; in an even split it still coincides with the vertical divider. If a reserved strip is the cost of moving it, leave it. Bug 2.

### Outline (9, T 8)

Unchanged and right. Bug 1 is the one behaviour fault.

### Pieces (8, T 8)

The in-app thumbnails are the best-looking thing in the panel in both themes. Lights tiles (bug 7). First-view loading on SwiftShader was slow; confirm on a GPU.

### Status bar (8, T 7)

"Saved" in green with a check is the right feedback. Make the timer run from when the chip appears (bug 5).

### Start screen (8, T 8)

Title fixed, ball is the accent. On the new dark base the hero band's teal line should also go up in chroma with the accent.

### Split panes (7, T 6)

Dark panes are a family. Light is not (bug 10).

## What to do next, by score impact

1. **Dark theme, bolder** per the nine properties above: near-black base, 8 to 10 point elevation steps, hairlines at 10 to 12%, three clear text tiers, accent to about `oklch(0.72 0.16 210)`, status pills saturated, hover a full step, viewport darker. Light untouched. Judge from full-window shots.
2. **Light four-pane and water**: tint light ortho panes toward the water, darken the light water one step.
3. **Active Outline tab clears selection** (bug 1) and **pane tooltip keys** (bug 2).
4. **Sync popover above the toolbar**; **Play and tab tooltips** not covering controls.
5. **One KeyChip** in context menus; **⋯** on the prefab row; **Lights glyphs**.
6. **Saved chip timer** from appearance; re-save goes Unsaved → Saved directly.
7. **Placement spread** aware of existing pieces.
8. **Copy**: prefab name case in the eyebrow, the three "rejected" tooltips, "Not exported" popover body.
9. **Undo-to-clean clears the dot** (bug 3), confirm the 1 px document scroll.

## Not reviewed

Native prompts, Import clash / Overwrite / Replace published, Release notes (external), update pill, popped-out panels, Game link first-run when something is missing, drag-and-drop, splitter dragging, gizmo interaction, exported and changed-in-game chip states.
