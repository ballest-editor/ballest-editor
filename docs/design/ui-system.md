# UI system

The rules every view follows. The tokens live in `packages/ui/src/styles/globals.css`; `cn` (`@workspace/ui/lib/utils`) knows their names, so import it from there, never from `cn` itself. A new token goes in both.

## Text: four roles

| Class              | Size and weight | For                                                  |
| ------------------ | --------------- | ---------------------------------------------------- |
| `text-caption`     | 11/16, 500      | Eyebrows, shortcut hints, counts, badges             |
| `text-body`        | 13/20, 400      | Labels, rows, menu items, values. The `body` default |
| `text-body-strong` | 13/20, 600      | Row titles, selected object names                    |
| `text-title`       | 15/20, 600      | Dialog titles, panel headers                         |

Each class sets size, line height and weight together, so don't add `font-*`, and don't use `text-xs`, `text-sm` or arbitrary sizes. An eyebrow is `text-caption uppercase tracking-wider`; `SectionTitle` is the shared one.

`font-mono` is for numbers in editable fields, never sentences, file names or paths.

## Greys: three steps below `text-foreground`

| Class               | Dark contrast on `--card` | Light contrast on `--card` | For                                                          |
| ------------------- | ------------------------- | -------------------------- | ------------------------------------------------------------ |
| `text-fg-secondary` | 11:1                      | 8.7:1                      | Eyebrows, section labels, field labels, inactive tabs, icons |
| `text-fg-tertiary`  | 7.3:1                     | 5.4:1                      | Placeholders, helper copy, statuses, shortcut hints, counts  |
| `text-fg-disabled`  | 3.2:1                     | 2.3:1                      | Disabled text, and what's inside a disabled row but its name |

The variables are `--fg-secondary`, `--fg-tertiary`, `--fg-disabled`. They aren't `text-secondary`: `secondary` is shadcn's surface colour. Disabled is a colour, not `opacity-50`, except on filled buttons and on graphics (a switch, a slider).

## Colour

The dark theme is the stadium at night and the light theme is the game's cover art in daylight. Neither is the other inverted: dark is navy surfaces with yellow on them, light is warm paper inked in navy with a deeper gold. `apps/web/src/editor/palette.test.ts` holds every contrast below.

| Colour      | In the game                                             | Dark      | Light     | Tokens                                         |
| ----------- | ------------------------------------------------------- | --------- | --------- | ---------------------------------------------- |
| Goal yellow | `MI_GoalYellow` `#ffbe0d`, the ring in a race `#f9db3a` | `#fcca21` | `#be7c00` | `--primary`, the one accent colour             |
| Stadium     | The band under the stands `#2c3779`                     | `#171e3a` | `#161d45` | Dark surfaces; light `--foreground` is its ink |
| Paper       | The cover's white floor, the dawn horizon               | none      | `#f8f3e8` | Light surfaces                                 |
| Track teal  | The seats `#38969e`, the track in a race `#508a92`      | `#06707e` | `#3c9baa` | `--accent`, the ball in `HeroBand`             |
| Water       | The pool wall `#4c98d2`, the water `#067a9c`            | `#3fb1ea` | `#067a9c` | `--ring`, `--secondary`                        |
| Crowd green | `MI_ArenaGreen` `#00a95b`                               | tints     | tints     | `--status-ok`, `--difficulty-2`                |
| Orange      | `MI_ArenaOrange` `#ff6d00`                              | tints     | tints     | `--status-warn`                                |
| Ball red    | The ball on the cover, `#b61f1e` to `#f03f3c`           | tints     | tints     | `--destructive`, `--difficulty-4`              |
| Dawn        | The dawn sky, blue through mauve to the rim's coral     | tints     | tints     | `--size-s`, `--size-m`, `--size-l`             |

Components use the tokens, never a palette class (`emerald-500`) or a hex. The scene is the exception, because it draws the game's world and not the chrome: `sceneGround.ts`, `sceneColors.ts` and `axisColors.ts` keep their own colours, and the ground and theme sky lean to water so a pane doesn't read as a panel.

| Token                              | For                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--background`                     | Behind everything: the start screen, the window's edges                                                                                                                   |
| `--card`                           | Panels, strips, bars. Viewport chrome is this at 80%                                                                                                                      |
| `--popover`                        | Dialogs and popovers. Menus are this at 70% over a blur                                                                                                                   |
| `--muted`                          | Hovered rows, wells, skeletons                                                                                                                                            |
| `--secondary`                      | Secondary buttons                                                                                                                                                         |
| `--primary`                        | The main action, pressed toggles, selection, the active tab: fills, lines and dots                                                                                        |
| `--accent`                         | The second colour. `bg-accent` is shadcn's menu focus, but the menus' `bg-foreground/10` replaces it and keeps `text-accent-foreground`, so that text has to read on both |
| `--ring`                           | Keyboard focus, in water blue so it never reads as selected                                                                                                               |
| `--border`, `--input`              | Edges of panels, and of fields                                                                                                                                            |
| `--sidebar-*`                      | shadcn's sidebar, the same values as `--card`, `--primary` and `--accent`                                                                                                 |
| `--size-s`, `--size-m`, `--size-l` | A piece's size tag and thumbnail outline; the tag's text is `text-background`                                                                                             |

Surfaces get lighter as they rise, in both themes: `--background`, `--card`, `--popover`. Shadows take `--shadow-tint`, so a shadow on navy is deeper navy.

`--primary` is 3:1 on a panel in the light theme, enough for a line or a dot and not for small text. Text on a pale `bg-primary/15` is `text-foreground`.

Yellow and navy are complements, so a thin wash of `--primary` cancels to grey on the dark surfaces: 10% to 20% comes out with almost no colour. At 20%, where selected rows sit, it has crossed over to a warm bronze. For a large wash in the dark theme use `--accent`, which stays blue.

## Difficulty colours

`--difficulty-1` to `--difficulty-5` (`bg-difficulty-1`, `text-difficulty-5`) are the five Workshop difficulties, easiest first: white, green, blue and red bars, as the game draws them, and Baller's yellow warning sign. The first is `--foreground`, so in the light theme it is navy, and the yellow deepens to gold to stay visible on paper. A difficulty mark uses these, never a palette class.

## Radii: two

- `rounded-control` (4px): buttons, inputs, menu items, chips, badges, and everything floating over the viewport.
- `rounded-surface` (8px): dialogs, popovers, menus, cards.

`rounded-xs`, `-sm` and `-md` resolve to the control radius and `-lg` and up to the surface radius, but write the two names. Panels are square. `rounded-full` is for true dots, switches, scrollbars and progress bars only.

Viewport chrome is one shape, rounded rects at the control radius (`viewControlStyle.ts`): no circles, no stadiums. A group is 28px high on the card colour at 80%, which follows the theme, and is divided into segments that fill it: no padding and no outer container, so no second radius.

## Spacing: 4px steps, 8px between groups

| What               | Size                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| Inputs, buttons    | 28px (`h-7`); menu items too                                          |
| Rows               | 24px dense (outline), 32px with a thumbnail or second line            |
| Icon buttons       | 24px target, 16px icon: `Button size="icon-sm"`, no size classes      |
| Panel tab strip    | 28px                                                                  |
| Document tab strip | 32px, as is a popped-out panel's strip (the window controls' height)  |
| Dialog padding     | `p-dialog` (16px) at every dialog size; `px-dialog` for split dialogs |
| Tooltip delay      | 300ms, the default; don't set `delay`                                 |

## Status colours

A sync status (`syncStatusOf`, `domain/linkState.ts`) wears one of three pairs: an opaque fill and the text on it. The text also has to read with no fill, on `--card` and `--popover`, because Settings › Game uses it alone. `SyncStatusChip.tsx` is the one place that names them; don't use Tailwind's palette (`emerald-500`) for a status. A chip is a `rounded-full` pill filled with its tone, the same component in the status bar and on a Project panel row.

| Fill                | Text                             | For                           |
| ------------------- | -------------------------------- | ----------------------------- |
| `bg-status-ok`      | `text-status-ok-foreground`      | In sync                       |
| `bg-status-warn`    | `text-status-warn-foreground`    | Unsaved, Changed since export |
| `bg-status-neutral` | `text-status-neutral-foreground` | Not exported, Published draft |

Not exported is every map's resting state, so it wears neutral, the quietest pair: colour means something needs a look or has just gone right. The variables are `--status-ok`, `--status-warn`, `--status-neutral`, and each with `-foreground`. A hover is the fill at 80%, which is why the fill has to be opaque.
