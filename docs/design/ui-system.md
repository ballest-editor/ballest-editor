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
| `text-fg-secondary` | 9.5:1                     | 8.6:1                      | Eyebrows, section labels, field labels, inactive tabs, icons |
| `text-fg-tertiary`  | 5.7:1                     | 5.1:1                      | Placeholders, helper copy, statuses, shortcut hints, counts  |
| `text-fg-disabled`  | 2.7:1                     | 2.3:1                      | Disabled text, and everything inside a disabled row          |

The variables are `--fg-secondary`, `--fg-tertiary`, `--fg-disabled`. They aren't `text-secondary`: `secondary` is shadcn's surface colour. Disabled is a colour, not `opacity-50`, except on filled buttons and on graphics (a switch, a slider).

## Radii: two

- `rounded-control` (4px): buttons, inputs, menu items, chips, badges, and everything floating over the viewport.
- `rounded-surface` (8px): dialogs, popovers, menus, cards.

`rounded-xs`, `-sm` and `-md` resolve to the control radius and `-lg` and up to the surface radius, but write the two names. Panels are square. `rounded-full` is for true dots, switches, scrollbars and progress bars only.

Viewport chrome is one shape, rounded rects at the control radius (`viewControlStyle.ts`): no circles, no stadiums.

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
