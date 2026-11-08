---
name: test-ballest-app
description: Check Ballest Editor in a real browser or the desktop app against test maps. Use for the one integrated pass after a user-visible change, reproducing a UI bug, or measuring the page. Don't write your own browser automation; this has it.
---

# Test Ballest Editor

Logic gets a test, not a browser (AGENTS.md § Verifying). This is for what only a running app shows. It runs once, in the agent that integrates the work; a delegated agent doesn't start a dev server or a browser unless its brief says to.

## Declared states first

To see, measure or compare a view that has a state, use [`pnpm app-driver`](../../../tools/app-driver/README.md) or the `ballest-app-driver` MCP tools, not the steps below. They start the app in isolation, pin what moves, cover desktop surfaces, and return a summary and a contact sheet. A state worth repeating goes in a `*.states.ts` file. The helper here is for a quick look at something no state reaches.

## Start the app

Run `pnpm dev` in the background and keep hold of it. The port is this checkout's own: read it from the `Local:` line of the output, and before trusting a result make sure that server is this checkout's, not another agent's. Stop what you started by its PID or port. Never `pkill -f` or `pgrep -f` a name or path: your own shell has that text in its command line.

## Test data

An empty map proves little. Make what the check needs with [`pnpm map`](../../../tools/map/README.md):

```sh
pnpm map seed --force                   # .dev-project/: Small, Medium and Large maps
pnpm map build /tmp/x --items 300 --seed 2
```

## Drive it

```sh
B=.claude/skills/test-ballest-app/scripts/browser.mjs
node $B start http://localhost:<port>/   # a private headless Chromium, 1280x800
node $B open-map .dev-project/maps/<file>
node $B eval '__ballest.useEditor.getState().doc.map.items.length'
node $B click '[aria-label="Settings"]'
node $B hover 'header button'          # a real pointer, which opens tooltips
node $B key Escape
node $B drag 640 400 700 400             # a left-button drag between page pixels, for a gizmo handle
node $B shot /tmp/after.png
node $B stop                             # always: idle software WebGL burns about 8 cores
```

- `globalThis.__ballest` (`useEditor`, `sceneRegistry`) exists in dev builds. Use it to read and set state. `import("/src/editor/store.ts")` after a hot reload gets a second store.
- `eval` awaits promises and prints JSON. Prefer it to a screenshot: a measurement costs a fraction of an image. Take shots of what only looks can settle, one per state.
- Meshes stream in, so wait for what you're checking instead of sleeping for a set time.
- Theme: set `settings.appearance.theme` with `setSettings`. Toggling `.dark` by hand doesn't switch it properly.
- Switches: Base UI puts `id` on a 1px hidden input, so click `[role=switch]`.

## Snapping on real drags

`scripts/snaplab.mjs` drives drags in the browser `browser.mjs start` opened and prints what snapped at every step, folded into runs: the target's label, the base, and where the selection stood. For tuning snapping from real use, not for logic, which gets a test.

```sh
L=.claude/skills/test-ballest-app/scripts/snaplab.mjs
node $L boot                                                    # after browser.mjs start, and after any code change (restart the browser: the scene caches mesh elements)
node $L scene '{"pieces":[{"name":"Track L","x":-2000},{"name":"Track S","x":-300}],"view":"top","snap":{"enabled":true}}'
node $L px 1; node $L end 1 0; node $L arrow 1 x 35            # page pixels: a piece's origin, a connector end, a translate handle
node $L drag 620 148 0 330 --steps 110 --lock x --shot /tmp/a.png   # a drag by page pixels, with a lock key, a screenshot before release
node $L drag 620 148 0 330 --key KeyG --hold --shot /tmp/b.png  # with a key held through the drag (a KeyboardEvent.code), still pressed for `release`
```

Every scene starts from the default snap config plus what `snap` gives (`enabled` is off by default); `view` is a pane projection and `frame: true` frames the map. The default top view shows world x from about -2200 (bottom) to +100 (top), so put pieces there. A `--hold` drag stays pressed for `release`.

## Traps

- Don't use T3's preview tabs for the viewport. A tab that isn't on screen gets no frames, so WebGL doesn't paint and input never arrives.
- A dirty map's `beforeunload` hangs a reload and every call after it. `stop` and `start` instead.
- Frame timing needs the real GPU, not software WebGL: start Chromium by hand with `--use-angle=gl-egl --disable-frame-rate-limit --disable-gpu-vsync`.

## Desktop-only surfaces

Popped-out panels, native menus and the real project flows need Electron. A covered window gets no frames, so run it under Xvfb. Keep `pnpm dev:desktop` for Vite, stop the Electron it started, then from `apps/desktop`:

```sh
Xvfb :77 -screen 0 1800x1125x24 -nolisten tcp &
env -u WAYLAND_DISPLAY -u ELECTRON_RUN_AS_NODE DISPLAY=:77 \
  VITE_DEV_SERVER_URL=http://127.0.0.1:<port>/ BALLEST_USER_DATA_DIR=$PWD/.dev-user-data \
  <electron> --remote-debugging-port=0 --ozone-platform=x11 \
  --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist .
```

Without those flags WebGL fails and the page says "Something went wrong". New windows inherit them but not the debug port; `.dev-user-data/windows/<pid>.json` has theirs. A clean profile opens the Game link dialog first and has no creator name, which disables Save: set `general.creatorName` with `setSettings`. Native dialogs and folder pickers can't be driven.

Saving writes to the real `~/Documents/Ballest Editor`, and `BALLEST_USER_DATA_DIR` doesn't move it. Before any save, set `HOME`, `XDG_CONFIG_HOME` and `XDG_DATA_HOME` to a scratch folder, and put `XDG_DOCUMENTS_DIR="<scratch>/Documents"` in its `user-dirs.dirs`.
