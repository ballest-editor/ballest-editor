# UI system

The rules every view follows. The tokens live in `packages/ui/src/styles/globals.css`; `cn` (`@workspace/ui/lib/utils`) knows their names, so import it from there, never from `cn` itself. A new token goes in both.

## Text: five roles

| Class              | Size and weight | For                                                        |
| ------------------ | --------------- | ---------------------------------------------------------- |
| `text-caption`     | 11/16, 500      | Eyebrows, shortcut hints, counts, badges                   |
| `text-label`       | 12/16, 500      | Field labels                                               |
| `text-body`        | 13/20, 400      | Rows, menu items, values. The `body` default               |
| `text-body-strong` | 13/20, 500      | Buttons, segments, tabs, row titles, selected object names |
| `text-title`       | 14/20, 600      | Dialog titles, panel headers. Tracked -0.005em             |

Each class sets size, line height and weight together, so don't add `font-*`, and don't use `text-xs`, `text-sm` or arbitrary sizes. 500 is a label, 400 is a value, and 600 is for titles alone. An eyebrow is `text-caption uppercase tracking-wider`; `SectionTitle` is the shared one. In dark, `SectionTitle` goes up to `text-foreground`, so a block's title stands above the field labels under it, which are `text-fg-secondary` too.

The font is the system's (`--font-sans`), so the type is never where the personality comes from. `body` sets tabular numbers. `font-mono` is Geist Mono, bundled, and is for numbers in editable fields and About's build info, never sentences, file names or paths.

## Greys: three steps below `text-foreground`

| Class               | Dark contrast on `--card` | Light contrast on `--card` | For                                                          |
| ------------------- | ------------------------- | -------------------------- | ------------------------------------------------------------ |
| `text-fg-secondary` | 9.0:1                     | 10.7:1                     | Eyebrows, section labels, field labels, inactive tabs, icons |
| `text-fg-tertiary`  | 6.4:1                     | 6.3:1                      | Placeholders, helper copy, statuses, shortcut hints, counts  |
| `text-fg-disabled`  | 3.2:1                     | 2.6:1                      | Disabled text, and what's inside a disabled row but its name |

The variables are `--fg-secondary`, `--fg-tertiary`, `--fg-disabled`. They aren't `text-secondary`: `secondary` is shadcn's surface colour. Disabled is a colour, not `opacity-50`, except on filled buttons and on graphics (a switch, a slider).

## Colour

The chrome has no hue, only elevation, and the colour on screen comes from the viewport. The game's colours stay there and in the hero band, and nothing else quotes them. Judge a change from a full-window screenshot at 100%, dark and light. If you can name any one colour in the chrome, there is too much of it. `apps/web/src/editor/palette.test.ts` holds every contrast here, and holds the surfaces under 0.012 of chroma.

| Surface        | Dark      | Light                  | For                                                                             |
| -------------- | --------- | ---------------------- | ------------------------------------------------------------------------------- |
| `--background` | `#0b0d0f` | `#f3f5f6`              | Behind everything: the start screen, the window's edges                         |
| `--card`       | `#16191c` | `#fcfcfd`              | Panels, strips, bars                                                            |
| `--popover`    | `#1e2226` | `#ffffff`              | Dialogs, and what `glass` is made of                                            |
| `--muted`      | one up    | one down               | The track of a segmented control, skeletons, a key chip                         |
| `--secondary`  | one up    | one down               | Secondary buttons                                                               |
| `--accent`     | one up    | one down               | shadcn's neutral hover surface, opaque. `--accent-foreground` is the foreground |
| `--sidebar-*`  | `--card`  | a shade under `--card` | shadcn's sidebar                                                                |

Both themes are one cool neutral at hue 250, lighter as they rise: `--background`, `--card`, `--popover`. Separate things by that step first. A row or a group on a panel takes a tone, not a border. Dark is near-black, so the window reads as black with the chrome lifting off it, and each step is 8 to 11 points. `--muted`, `--accent` and `--secondary` sit above `--popover` there, because a track or a key chip also sits on a dialog or a menu.

Components use the tokens, never a palette class (`emerald-500`) or a hex. The scene is the exception, because it draws the game's world and not the chrome: `sceneGround.ts`, `sceneColors.ts` and `axisColors.ts` keep their own colours. The clear colour sits near the chrome base, so the map's sky and water are the only real colour in the viewport: a cool near-black in dark, between the chrome's base and its panels, and in light a very pale cool grey-blue. Light's orthographic panes sit one step bluer (`ORTHO_GROUND`), so a side view that sees the water edge-on stays in the family of the panes that see it from above. The water has a look per theme and skips tone mapping, so its colours are what reach the screen before the map's light dims them: deep and muted in dark so the pieces pop, thicker in light so a pale piece's side faces stand off it. From above it thins out by the sky's own haze curve, so it runs straight into the horizon with no clear colour between them, and from below it thins out with distance (`water.ts`). The sky's haze over the far floor is tighter in dark, where a bright sky would otherwise light up a third of the pane (`sky.ts`), and the floor grid's lines fade before they get too fine to draw (`floorGrid.ts`).

A piece's thumbnail is rendered in the app on a transparent background (`editor/thumbnails.ts`), so it sits on its tile in both themes; the game's own renders are the fallback. A light has no body worth a picture, so it shows its own glyph in `text-fg-secondary` wherever a thumbnail goes (`components/outlineGlyphs.ts`). The tile is `THUMBNAIL_TILE` (`PieceThumbnail.tsx`), `bg-foreground/14`: further off the panel than `--muted`, so a white piece reads in light and a near-black one in dark.

A hover on a row or a ghost control is `bg-foreground/6`, and on a menu row `bg-foreground/8`. That is a step on whatever sits under it, and in dark more than the surfaces step: 13 points on `--card`, 17 on `--popover`. An opaque `--accent` is nearly the same tone as `--popover`, so it would vanish there and on glass.

**`--primary` is the one accent, and it means "interactive".** Dark `#05b9cf`, light `#007787`. It is for primary buttons, the active tab's underline, the active tool, selection, focus rings (`--ring` is the same value), links and the hero band's track and ball, and nothing else. In dark, `--primary-foreground` is near-black, because white on it is 2.4:1. Past sRGB this hue clips to a harsher cyan, so dark's chroma of 0.124 is the most L 0.72 holds at hue 210.

| Class           | For                                                                            |
| --------------- | ------------------------------------------------------------------------------ |
| `bg-primary/12` | A selection wash: selected rows, a pressed toggle. Its text keeps its colour   |
| `bg-primary/30` | Selected text (`::selection`, set once in `globals.css`), under `--foreground` |
| `text-primary`  | Links, and any accent text: it reads on `--card` and `--popover`               |
| `bg-dirty`      | The dirty dot, and nothing else. It is the one yellow in the app               |

`--destructive` is red, used as `text-destructive` on `bg-destructive/12`.

Components use the tokens, never a palette class (`emerald-500`) or a hex. The scene is the exception, because it draws the game's world and not the chrome: `sceneGround.ts`, `sceneColors.ts` and `axisColors.ts` keep their own colours.

## Borders

`--border` is an alpha hairline: white at 11% in dark, the foreground at 10% in light. A bare `border` is that at 65% (the `@layer base` default), felt rather than seen, and `border-border` is the whole hairline, for where two panels meet and for outline buttons. Panels meet with one line, not two. Nothing else gets a 1px rectangle by default.

`--input` is the well a field sits in: `bg-input` under `border-border/70`. It is alpha too (black at 24% in dark, the foreground at 3% in light), so it is a touch darker on any surface, and it isn't a border colour.

## Depth

| Class            | What                                                                      | For                                   |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------- |
| `shadow-primary` | A 1px inset highlight in white at 16%, and 1 to 2px in `--primary` at 24% | Filled primary controls               |
| `shadow-sm`      | 1 to 2px at 5%                                                            | Outline and secondary buttons, thumbs |
| `shadow-md`      | 12px at 12%, 20% in dark                                                  | Popovers, menus, tooltips, toasts     |
| `shadow-lg`      | 24px at 12%, 20% in dark                                                  | Dialogs                               |

A button pressed scales to 0.97 and drops its shadow, except one that opens a popup, which holds still under it.

## Glass

`glass` is whatever floats over content: menus, tooltips, toasts. It is `--popover` at 95% with `backdrop-filter: blur(12px) saturate(1.2)`, so what's behind is a faint tone and never a shape. Any thinner and a 3D scene shows through as a smudge, and a menu across a panel's edge takes that edge as a seam. A popover isn't glass: it is opaque `bg-popover`, because it stays open across the dock's edges and the viewport's colour would tint one side of it. A dialog isn't glass either: the overlay behind it has already blurred the page.

The viewport's own pills and chips are `SURFACE` (`viewControlStyle.ts`), `--card` at 80%. Thinner than `glass`, because they're small and hold little text.

Put it on the element itself. A blur on a `::before` can't see past its parent while the parent fades, so it would pop in at the end. Submenus are safe because base-ui portals them beside their parent.

## Motion

120 to 180ms, ease-out, everywhere: hover tints, press, the tab underline, the segmented pill, and a popup's fade and 4px rise. The default transition is 150ms and `cubic-bezier(0, 0, 0.2, 1)`, so a bare `transition-colors` needs nothing more. No bounce, and nothing at 300ms. Every duration goes through `--motion` (Settings › Appearance). A status chip has no transition, hover included: its label can't fade, so a fading colour would sit under the wrong label.

## Difficulty colours

`--difficulty-1` to `--difficulty-5` (`bg-difficulty-1`, `text-difficulty-5`) are the five Workshop difficulties, easiest first: white, green, blue and red bars, and an amber warning sign for Baller. They follow the game's order, quieted to sit on the chrome. The first is `--foreground`, so in the light theme it is dark. A difficulty mark uses these, never a palette class.

## Size colours

`--size-s`, `--size-m`, `--size-l` are a piece's size: green, blue-grey and amber, all well under a named colour. A tag is a filled tint, `bg-size-s/15 text-size-s`, or solid under `text-background`; a thumbnail's outline is `ring-size-s`.

## Radii: three, and the pill

- `rounded-control` (8px): buttons, inputs, menu items, the track of a segmented control.
- `rounded-surface` (10px): cards and grouped rows on a panel.
- `rounded-sheet` (12px): what floats or stands alone: dialogs, popovers, menus, tooltips, toasts.
- `rounded-full`: anything small and self-contained: tags, chips, badges, counts, the viewport toolbar and the status chip. Dots, switches, sliders and scrollbars too.

`rounded-xs`, `-sm` and `-md` resolve to the control radius, `-lg` and `-xl` to the surface radius and `-2xl` and up to the sheet radius, but write the names. Panels are square.

A segmented control is `ToggleGroup`, one track with a pill inside that slides to the pressed item. `pill="primary"` is for the active tool, and the neutral default is for a setting. Add `rounded-full` to the group for a pill-shaped track, and the pill and items follow. A `multiple` group has no one place to slide to, so each pressed item takes a selection wash of its own.

## Spacing: 4px steps, 8px between groups

| What               | Size                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| Inputs, buttons    | 28px (`h-7`); menu items too                                                          |
| Segmented control  | 28px: 24px items in a track with 2px of padding                                       |
| Rows               | 24px dense (outline, thumbnails at 16px), 32px with a larger thumbnail or second line |
| Icon buttons       | 24px target, 16px icon: `Button size="icon-sm"`, no size classes                      |
| Panel tab strip    | 28px                                                                                  |
| Document tab strip | 32px, as is a popped-out panel's strip (the window controls' height)                  |
| Dialog padding     | `p-dialog` (16px) at every dialog size; `px-dialog` for split dialogs                 |
| Tooltip delay      | 300ms, the default; don't set `delay`                                                 |
| Tooltip side       | Down from top strips, up from the status bar; along the strip to clear a control      |

## Icons

One stroke family, Tabler, at one weight: 16px in rows, 14px in chips, 20px in the toolbar. An icon takes the text colour of where it sits, never a hue of its own, except a status icon.

## Status colours

Status is semantic: a filled tint with its own text, only on badges, chips and icons, never as a surface or as the accent. The resting state of anything is the neutral tint. A sync status (`syncStatusOf`, `domain/linkState.ts`) wears one of three pairs. The text also has to read with no fill, on `--card` and `--popover`, because Settings › Game uses it alone. `Badge` has them as `variant="ok"`, `"warn"` and `"neutral"`; `SyncStatusChip.tsx` is the one place that picks between them for a status.

| Fill                | Text                             | For                                                          |
| ------------------- | -------------------------------- | ------------------------------------------------------------ |
| `bg-status-ok`      | `text-status-ok-foreground`      | In sync, Saved                                               |
| `bg-status-warn`    | `text-status-warn-foreground`    | Unsaved, Changed since export                                |
| `bg-status-neutral` | `text-status-neutral-foreground` | Not exported, Published draft, an Export or a Play under way |

Not exported is every map's resting state, so it wears neutral, the quietest pair: colour means something needs a look or has just gone right. The variables are `--status-ok`, `--status-warn`, `--status-neutral`, and each with `-foreground`. Each is the tint already mixed with the surface, about 12% in light and 18% in dark, where the text is at full saturation, and opaque: a hover is the fill at 80%, which an alpha fill couldn't take.
