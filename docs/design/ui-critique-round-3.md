# UI critique, round 3

Reviewer: Robin Ebers (role-played). Build: `feat/ui-redesign` at `aed9982f2`, desktop app, 1723×1078 CSS px window, dark unless noted. Screenshots: `/home/spigelli/.cache/ballest-editor/ui-critique-round-3/shots/` (211 shots from four parallel agents; same names as rounds 1 and 2 where the view matches, `-light` twins for the Theme row, `MANIFEST-A..D.md` with menu dumps, measured colours and bugs). Earlier rounds: `ui-critique-round-1.md`, `ui-critique-round-2.md`. System: `ui-system.md` (now with a Colour section).

Same scale as before, out of 10 against a shipping professional tool. New this round: **Theme** is a scored criterion with the same weight as any other. It judges palette, backgrounds, shading, icons and overall feel, loosely reminiscent of _Ballest of Them All_, with the explicit calibration that overreach is a fault: the game's palette should inform accents, status colours and surfaces, not turn a professional tool into game chrome. Both light and dark must exist and both must be good. Each view below carries a theme sub-score (T) next to its round-3 score.

## Scoreboard

| View                                    | R1 | R2 | R3    | T     | One line                                                                                                                                                                                                                             |
| --------------------------------------- | -- | -- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overall                                 | 4  | 6  | **5** | 2     | Structure, copy and behaviour are the best they have been (nearly every round-2 item landed). The theme pulls the whole thing down: the owner's verdict is that it looks like puke, and on a second look I agree. Reset the palette. |
| Theme (new)                             | –  | –  | –     | **2** | Wrong direction. The app went from grey to purple-navy, and goal-yellow as the one accent makes every action look like a warning. Nothing about it reads as sleek or modern. Start over from a neutral base.                         |
| Top bar and menu bar                    | 5  | 7  | 8     | 3     | Logo in the bar, Play is yellow, menus are navy/blur. Recent projects has no reason tooltip.                                                                                                                                         |
| Dock                                    | 4  | 6  | 7     | 3     | Sash and hover-shift fixed. Reopened panels land last; Untitled project panel shows a row and "No maps yet" together.                                                                                                                |
| Viewport chrome                         | 5  | 7  | 8     | 3     | Panes and Display are labelled, Display owns the toggles, controls pinned above panes, splitter highlights.                                                                                                                          |
| Inspector: map                          | 4  | 6  | 7     | 3     | Absolute date, Status ⓘ. Creator still an unbroken 29-char token.                                                                                                                                                                    |
| Inspector: item and group               | 3  | 7  | 8     | 3     | Finish always has a value, swatch row, X/Y/Z tabs in the game's RGB. Flip and Pivot read fine.                                                                                                                                       |
| Outline                                 | 5  | 7  | 8     | 3     | Glyphs, selection in a warm wash. Thumbnails for pieces are still the preferred direction (see Pieces).                                                                                                                              |
| Pieces                                  | 4  | 7  | 8     | 3     | Size tags coloured by S/M/L, grid outlines match. Sort order S/M/L inconsistent across families.                                                                                                                                     |
| Prefabs                                 | 4  | 6  | 7     | 3     | Empty state centred. "Stored in" toggle has almost no pressed state; a raw class name in a tooltip.                                                                                                                                  |
| Project panel                           | 4  | 6  | 7     | 3     | One badge vocabulary, coloured. Unsaved orange and Not exported blue are good; "Not exported" is the resting state and should be quieter.                                                                                            |
| Status bar, sync, notifications, toasts | 5  | 6  | 7     | 3     | Chip is coloured per state. Never-saved map shows plain text, not a chip.                                                                                                                                                            |
| Menus (content)                         | 5  | 7  | 8     | 3     | Theme gone from View, Display toggles gone from View. Re-import still has no reason.                                                                                                                                                 |
| Settings › Game                         | 3  | 7  | 8     | 3     | Reveal vs Choose with distinct glyphs and tooltips.                                                                                                                                                                                  |
| Settings dialog                         | 5  | 7  | 8     | 3     | Version row gone, search footer right, "on this computer". Stale Keybinds scrollbar.                                                                                                                                                 |
| Project settings                        | 4  | 6  | 8     | 3     | Workshop nested under its map with a breadcrumb, difficulty tooltips with the game's bars.                                                                                                                                           |
| Save, Rename, Duplicate, New project    | 3  | 8  | 8     | 3     | Unchanged and right. Light twins hold up.                                                                                                                                                                                            |
| Backups                                 | 3  | 7  | 8     | 3     | Title matches the menu, sized to content.                                                                                                                                                                                            |
| Start screen, Where to open             | 4  | 6  | 7     | 3     | Hero band with the track and ball, centred, last-opened in rows. Light has a paint artefact on the New project card under SwiftShader.                                                                                               |
| Keyboard shortcuts                      | 6  | 7  | 8     | 3     | Editor / Move / Keyboard shortcuts; one Camera section.                                                                                                                                                                              |
| Split panes                             | 5  | 6  | 7     | 3     | Controls pinned; splitter visible. Ortho panes in dark are a cold slate that fights the navy chrome.                                                                                                                                 |
| Prefab definition tab                   | 4  | 7  | 8     | 3     | Fine.                                                                                                                                                                                                                                |
| Light theme                             | 2  | 6  | 7     | 3     | Warm paper, navy ink, gold primary. Grid now readable. Water in the perspective pane is a saturated sky-blue that clashes with the paper.                                                                                            |
| Display popover                         | –  | 5  | 7     | 3     | Labelled trigger, right glyph, Grid height moved in, link to grid colours.                                                                                                                                                           |
| About dialog                            | –  | 4  | 8     | 3     | Hero strip, Copy, links, licence.                                                                                                                                                                                                    |

## What got fixed (verified in the shots)

- All three input bugs from round 2: the sash no longer intercepts menus (measured by two agents), tabs reserve the close slot, the pane picker closes on choice.
- "Created" shows an absolute date; the UTC/local mismatch is gone.
- One badge vocabulary: `Unsaved` (orange), `Not exported` (blue), with the same background in the status chip and the row (`61c-project-status-badges.png`, `zoom-badges.png`).
- Display popover is the one home for Show grid / sky / water / Map lighting and Grid height; View and Settings › Appearance no longer carry them (`90-display-popover.png`, `04c-menu-View.png`).
- Viewport controls pinned to the viewport corner in every pane layout; splitter brightens on hover (measured 86/122/145 → 198/211/223).
- Start screen: centred hero band, logo, tagline, New / Open, recent rows with ⋯, a What's new card (`80-start-screen.png`). Where to open has New window as the primary.
- Copy: Move, Keyboard shortcuts, Editor, one Camera section, "on this computer", search footer, Version row gone, × n only above 1, Finish shows a value, Status ⓘ.
- Workshop nested under its map (`17d-project-settings-workshop.png`, breadcrumb "Project settings › Harbor Loop › Workshop"); difficulty tooltips name the game's bars.
- Light theme grid lines readable; ortho panes tinted; About has content.

## Bugs found this round (fix before polish)

1. **The viewport haze cannot be turned off.** The owner reports an ever-present fog in the editor even with sky, water and map lighting all off. The cause is in `SceneLights.tsx`: turning "Show sky" off does not remove the dome, it swaps `MapSky` for `ThemeSky`, which is the same `SkyDome` with the same horizon haze (`sky.ts`, `SKY_HAZE_BELOW` at 34% of the dome radius fading the far floor into the horizon colour), plus the floor grid's `fadeStrength` was raised to 3 in `772875f11`. So "off" is still a haze dome in the theme's colours, and the far grid dissolves into it. Fix: with Show sky off, render no dome at all (clear colour only) and let the grid fade only by distance; keep the haze for the map sky, where it belongs, and expose it as its own Display switch if it stays.
2. **Editor shortcuts die after Escape closes a menu.** Focus returns to the menubar button and `isEditorKeyEvent` drops keys from inside `[role=menubar]`. Ctrl+G did nothing twice until the button was blurred. Every editor key is affected, and Escape-out-of-a-menu is something users do constantly.
3. **Untitled project panel shows both states.** An "Untitled · Unsaved" row and, below it, "No maps yet / New map" (`06-panel-PROJECT.png`). One or the other.
4. **Reopened panels land last in the strip** (Prefabs after Outline); only Reset layout restores the order. Remember the slot.
5. **Raw class name in a tooltip**: "MP_PlayerStart is forbidden in prefabs." Say "Player Start can't go in a prefab."
6. **Stale Settings scrollbar**: after visiting Keybinds, its scrollbar persists on pages that don't scroll until the dialog is reopened.
7. **No reason tooltip on disabled File › Recent projects** (the source has one; it never showed), and none on Project › Re-import from game.
8. **Never-saved map shows plain text in the status bar** ("Not saved in the project yet") instead of the `Unsaved` chip the row uses, and clicking it does nothing.
9. **Prefab thumbnail flashes a broken-image glyph** for ~0.8 s on first view.
10. **Light New project card paints a hard-edged teal band** under SwiftShader (`81-start-screen-new-project-light.png` vs `-repainted`). The `from-accent/15 to-accent/5` gradient over `bg-card` is the suspect; verify on a real GPU before dismissing.
11. **Hard-killed app comes back Light** after Dark was chosen (unflushed localStorage). Probably harness only; worth a clean-quit check.
12. Minor: placed pieces stack on the same spot; Curve 2 sorts M, S, L while Curve 1 sorts S, M, L; the hidden "More for asdf" 1×1 button still exists in the tab strip; two Hidden rows have empty thumbnails in search.

## Theme, in detail

**Correction.** The first draft of this section scored the theme 7 because the palette was derived from the game and applied with restraint. The product owner's reaction on seeing it was "I hate everything about the theme, it looks like puke": yellow is an awful accent, the app went from grey to purple, and nothing about it is sleek or modern. On a second look at the full-window shots rather than the token table, I agree, and the score is 2. A palette can be well-sourced and well-structured and still be ugly. The brief was "prettier"; this is not prettier.

**What is wrong, concretely.**

- **The surfaces are purple.** `#171e3a` and its steps read as violet-navy on a monitor, not as a stadium at night. Every panel, menu and dialog is now tinted, so the app has no neutral anywhere to rest the eye (`03-untitled-project.png`, `20-settings-General.png`). The round-1 complaint was "overwhelmingly grey"; the answer was not "overwhelmingly purple".
- **Goal-yellow is the wrong accent.** `#fcca21` at full saturation on violet is the highest-contrast, highest-tension pair in the palette, and it is on Play, the active tool, the active tab underline, every primary button, every switch, every slider and the dirty dot. The eye reads yellow as caution; the UI now looks like it is warning you about everything (`90-display-popover.png`, `20-settings-General.png`, `60-named-project.png`).
- **The 20% yellow wash on selection cancels to bronze** on the violet, so selected rows, the pressed Pivot segment and the selected project row are a muddy brown (`43-outline-group.png`, `61c-project-status-badges.png`).
- **The viewport is a third colour.** Cerulean water and slate ortho panes against violet chrome: three blues that do not belong together (`37-four-panes.png`).
- **Light is better but has the same fault**: cream paper with a mustard-gold primary and a sky-blue viewport. It looks like a document template, not a tool (`38-light-theme.png`, `20-settings-General-light.png`).
- **It is blocky.** The owner also flagged this and it compounds the colour problem. With a 4px control radius, square panels, square chips, square tags, square segmented controls and a hard 1px border on nearly every element, the app reads as boxes inside boxes (`30-placed-piece-inspector.png`: the X/Y/Z tabs, the Pivot grid, the Flip buttons, the swatch row and the Finish select are all hard-edged rectangles stacked on each other; `17d-project-settings-workshop.png`: 29 outlined rectangles on one page; `zoom-viewctl.png`: five rectangles in a row). Modern tools soften this with three moves: a 6px control radius and 10 to 12px on surfaces, borders replaced by a tonal step wherever a row or group sits on a panel (chips and tags filled, not outlined), and fewer containers (the segmented control is one rounded track with a sliding pill, not eight bordered cells). Keep two radii, but raise them, and treat the 1px border as the exception.
- **The hero band** on the start screen and About is the one thing that works as an idea (a track-and-ball line drawing, nothing else from the game), and it should survive the reset. Its yellow track should become whatever the new accent is.

**Direction for the reset.** The brief stands: prettier, loosely reminiscent of the game, not game-styled, light and dark both real. "Loosely reminiscent" means a hint, not a palette transplant.

- **Neutral base, slightly cool.** Dark surfaces near `#141618` → `#1c1f23` → `#24282d` with at most 2 to 3 points of blue chroma, so they read as charcoal with a cool cast, not violet. Light surfaces near white with the same faint cool cast, not cream. This is what Linear, Figma, Blender 4 and Godot 4 all do and it is why they look modern.
- **One accent, cool and desaturated.** The game's track teal, pulled toward a clean blue-teal around `#2fa7b8` (dark) / `#1b8a9a` (light), used for: the active tab underline, the active tool, selection washes at 12 to 15%, focus rings, links, primary buttons. Yellow, if it survives at all, is for the dirty dot and nothing else.
- **Status colours** stay semantic and muted: green for in sync, amber for unsaved, red for destructive. None of them should be the brand accent.
- **The viewport** keeps the game's world colours (that is where the game belongs) and the chrome stays neutral around it, so the scene is the colourful thing and the tool frames it.
- **Keep** the type scale, the three greys, the badge vocabulary, the hero band composition and the status chip. Those are structure, not theme, and they are right.
- **Soften the geometry** at the same time: 6px controls, 10 to 12px surfaces, filled chips and tags instead of outlined ones, segmented controls as one track with a sliding pill, borders only where two surfaces of the same tone meet. Update `ui-system.md` § Radii and § Spacing to match.
- **Test it the way the owner will see it**: full-window shots at 100%, dark and light, not the token table. If the first reaction is anything but "that's clean", keep going.

**The design philosophy to build the reset on.** The target is sleek and modern with some pop: the kind of tool UI where the chrome disappears, the content carries the colour, and the few coloured things on screen feel deliberate and alive. These are the rules that produce that look. They are stated as rules, not as a reference to any other product, so they can be applied here without copying anyone.

1. **Surfaces have no hue; they have elevation.** Pick one neutral and build every surface from it. Dark: a near-black base, and every raised surface (panel, card, popover, menu) is the base mixed about 3% toward white, not a different colour. Light: an off-white base, white cards, a very faintly tinted sidebar. A surface is "higher" when it is slightly lighter, in both themes. Nothing in the chrome should be nameable as blue, purple, cream or any other colour; at most one or two points of chroma, warm in light and cool in dark, so the two themes feel like siblings rather than inversions.
2. **One accent hue, and it means "interactive".** A single hue, used for primary buttons, the active tab, the active tool, selection, focus rings and links, and for nothing else. Selection washes are that hue at 10 to 15% on the surface, which reads as a tint, never as a new colour. For Ballest Editor the hue is a clean blue-teal (about `oklch(0.62 0.12 210)` in dark, `oklch(0.52 0.12 210)` in light): cool, desaturated enough to sit on neutral, and a nod to the game's track without quoting it.
3. **Status is semantic and quiet.** Green for in sync, amber for unsaved, red for destructive, blue-grey for informational; each as a filled tint at 8 to 16% with its own foreground, only on badges, chips, icons and the dirty dot. Never as a surface, never as the brand accent, and the resting state of anything should be the neutral tint, not a colour.
4. **Borders are the exception, tone is the rule.** Where a row, group or control sits on a panel, separate it by the 3% elevation step first. Where a hairline is still needed, make it alpha (white at about 6% in dark, a light neutral in light) and use it at 60 to 70% strength, so borders are felt rather than seen. Panels meet each other with one hairline, not two. Inputs get the hairline plus a 2% darker well; nothing else gets a 1px rectangle by default.
5. **Round everything a step more than feels safe.** Controls 8px, surfaces 10px, floating sheets 12px, and pills for anything small and self-contained: tags, chips, badges, counts, the viewport toolbar, the status chip. Segmented controls are one rounded track with a sliding pill inside, not a row of bordered cells. The eye reads rounded pills as "light" and bordered rectangles as "heavy"; the pop comes from the contrast between soft chrome and the one crisp accent.
6. **Depth is a highlight and a tinted shadow, not a drop shadow.** A filled primary button gets a 1px inset highlight at the top (white at 16%) and a shadow in its own hue at about 24%, 1 to 2px. Outline and ghost buttons get a 5% shadow at most. Dialogs and popovers get a soft, large, low-opacity shadow (8 to 12% at 12 to 24px). On press, scale to 0.97 and drop the shadow. These three moves are what make a button feel pressable without looking skeuomorphic.
7. **Floating chrome is glass.** Anything that floats over content (menus, the viewport control group, the toolbar, toasts) is the surface at about 80% with a 12px blur and a slight saturation boost, so what is behind it shows through as colour without detail. Large flat dark areas get a faint grain so they do not band.
8. **Motion is small, quick and everywhere.** 120 to 180ms ease-out on hover tints, press scale, tab underline slide, segmented-pill slide, popover fade-and-rise of 4px, and a 1px lift on hover for cards. No bounce, no 300ms anything. This is most of the "poppy" quality: things respond to the cursor.
9. **Type is the system font, four sizes, two weights.** 11 / 12 / 13 / 14 with 500 for labels and 400 for values; 600 only for titles. Tracking slightly tight on titles, normal everywhere else. Numbers tabular. The type should never be where the personality comes from.
10. **Icons are a single stroke family at one weight**, 16px in rows, 14px in chips, 20px in the toolbar, coloured by the text colour of their context, never by their own hue, except status icons.
11. **The game lives in the viewport and the hero band, nowhere else.** The scene keeps the game's colours because that is what the user is editing; the hero band on the start screen and About carries the one illustration. The chrome around them quotes nothing from the game: no stadium navy, no goal yellow, no cover-art cream.
12. **Judge it from a full-window screenshot at 100%, dark and light.** If the first impression is anything but "clean", keep going. If any single colour can be named in the chrome, it is too much.

Applied to this app, rules 1, 4 and 5 fix "purple" and "blocky"; rules 2 and 3 fix the yellow; rules 6 to 8 add the pop; rule 11 keeps the game out of the chrome.

**Overreach check.** This was the risk flagged before the round and it happened: the palette was taken literally. The fix is not to tone it down 10%. It is to go back to neutral and let one cool accent and the viewport carry the colour.

## Per view (deltas only; what round 2 said still holds where not mentioned)

### Top bar (8, T 8)

Logo and name at the left, menus, project name centred with a yellow dirty dot, Play as a yellow button. Clean. The blank 85px left of the logo is gone. Remaining: Recent projects disabled with no tooltip (bug 6).

### Dock (7, T 7)

Four icon tabs, active one labelled with a yellow underline; "…" on each group; closed panels reopen from a dimmed icon (`06b-panel-closed.png`). Bugs 2 and 3 are dock bugs. The document tab tooltip is the shared component with name and status.

### Viewport chrome (8, T 7)

"Panes" and "Display" are labelled with chevrons; World, 10 cm, 15° unchanged; tooltips with KeyChips. The group sits at 80% card over the viewport and reads as chrome. Theme note on the water colour above.

### Inspector: map (7, T 7)

Created Nov 5, 2026 with the relative time in the tooltip; Status "Not validated ⓘ"; File with a reveal icon. Creator is still `spigipplespigipplespigipple` unbroken; truncate with a tooltip. The lighting sliders are yellow, which is one of the places yellow should probably be the accent instead.

### Inspector: item and group (8, T 7)

Paint shows "Base Surface Metal · Smooth" with a swatch row (`30-placed-piece-inspector.png`); Goal shows an "Off-panel" chip instead of the sentence. Group of 2 lists members, "× 2" only when it repeats. Bronze selection wash in the Pivot segmented control (theme).

### Outline (8, T 7)

Unchanged structure; selection wash is the bronze problem. Preferred direction stays: piece rows should carry the piece's thumbnail (round 1 had it; round 2 replaced it with a glyph), glyphs for Player Start, Goal and groups.

### Pieces (8, T 8)

S/M/L tags in the dawn tints, grid outlines matching, three header icons with tooltips (`29e-*`). Sort S/M/L consistently within a family. Tooltip still leads with the class name.

### Prefabs (7, T 7)

"No prefabs yet." centred; Save-as-prefab is one field plus a "Stored in" toggle. The pressed segment ("Project") is nearly indistinguishable from the unpressed (`49-save-prefab-dialog.png`). Bug 4.

### Project panel (7, T 7)

Badges as described. The row tooltip no longer covers the ⋯. Bug 2.

### Status bar (7, T 7)

`◌ Not exported` (blue) and `✎ Unsaved` (orange) as chips; the popover is title plus Export / Play. Bug 7. Still no state after Export (unreachable without Export; by design).

### Settings (8, T 7)

Rows, sliders, info tooltips all hold. Game page has Reveal (open folder glyph) and Choose (folder-search glyph) with tooltips. Bug 5. Toggle switches are yellow (theme note).

### Project settings (8, T 7)

Breadcrumb "Project settings › Harbor Loop › Workshop"; Workshop under the map in the sidebar with the globe glyph and indentation. Difficulty tooltip "Advanced: 3 blue bars in the game". Good.

### Start screen (7, T 8)

Hero band, recent rows with ⋯ (Open in new window / Reveal / Remove from recent), What's new card. Rows show the last-opened time per the manifest; the disabled row keeps its name. Focus-visible only. The lower half of the window is still empty; acceptable now that the block is centred. Bug 9 in light.

### Light theme (7, T 7)

Everything follows the palette; the About hero in light is lovely. Water/sky tuning above; top bar hairline.

## Flows (unchanged from round 2 except)

| Task                                 | R2            | R3                                               |
| ------------------------------------ | ------------- | ------------------------------------------------ |
| Toggle sky / water / lighting / grid | 3 homes       | Display popover only                             |
| Reopen a closed panel                | View › Panels | Click its dimmed icon in the strip               |
| Why is an item disabled              | Some tooltips | Most; Recent projects and Re-import still silent |

## What to do next, by score impact

0. **Reset the theme and soften the geometry** per the Theme section's design philosophy: neutral cool-grey surfaces in both modes, one desaturated blue-teal accent, yellow gone from everything but the dirty dot, viewport colours left to the game; 6px controls, 10 to 12px surfaces, filled chips, fewer borders, segmented controls as one track. This is worth more than every other item combined.
1. **Viewport haze with sky off** (bug 1) and **shortcuts after Escape** (bug 2). One-line fix in `keyTargets.ts`; it blocks every keyboard user.
2. (Folded into 0.)
3. (Folded into 0.)
4. (Folded into 0.)
5. **Untitled project panel** double state, **reopened panel order**, **never-saved chip** (bugs 3, 4, 8).
6. **"Not exported" as a neutral chip**; colour only for Unsaved / In sync / Changed.
7. **Copy**: the MP_PlayerStart tooltip, Recent projects and Re-import reasons, creator truncation.
8. **Stale Keybinds scrollbar**, **prefab thumbnail flash**, **Stored in pressed state**.
9. **Outline thumbnails for pieces** (keep glyphs for specials and groups).
10. **Light New project card** gradient artefact: confirm on a GPU, else flatten the card.

## Not reviewed

Native prompts, Import clash / Overwrite / Replace published, Release notes (external), update pill, popped-out panels, Game link first-run when something is missing, drag-and-drop, splitter dragging, gizmo interaction, the exported and changed-in-game chip states (need Export).
