# App driver: put the editor in a known state, then look, measure or compare

Status: built (designed and built 2026-11-06). [Its README](../../tools/app-driver/README.md) says how to run it and add states; this page holds why. The app driver is to Ballest Editor what the game driver
(`tools/driver`, [DRIVER.md](../DRIVER.md)) is to the game: one repo tool that starts the app in isolation, reaches a
declared state, and returns a capture, a measurement or a comparison. It lives in `tools/app-driver/`, runs as
`pnpm app-driver <command>` and as an MCP server registered in `.mcp.json`.

## Why

Agents rebuild this by hand. Across 265 sessions about 1,800 shell commands drove a browser with throwaway scripts:
roughly 770 loaded a map, 537 measured the page, 303 simulated input, 179 took a screenshot. In the UI redesign the
screenshot agents alone cost about $120 and 197 of 500 minutes, and none of their scripts survived. Reaching a state
and measuring it matter at least as much as pictures. Every kind of work needs it: bug reproduction, feature
verification, PR before/after shots, regression checks, design review.

The traps those sessions hit (recorded in the agent memory notes) are the design's constraints: hidden tabs and
occluded Electron windows get no frames; a fixed debug port or Vite port silently drives another agent's
process; `pkill -f` kills its own shell; a dirty map's `beforeunload` hangs navigation; a second `import()` of the
store after HMR gives a second store; thumbnails and mesh loads shift layout under a baseline; one thread that read
347 full-size images became very expensive.

## Decisions

Each decision names the T3 Code pattern it took, or why it departed.

### 1. A state is data, declared next to the code it shows

A state is a TypeScript literal in a `*.states.ts` file beside the component or action it exercises, found by glob under
`apps/web/src`. Nothing in the app imports these files: they are data, loaded only by the driver and the coverage test,
and never in the app bundle. The vocabulary, `tools/app-driver/src/state.ts`, imports nothing, so both can load it.

```ts
// apps/web/src/components/Editor.states.ts
export default states({
  "editor/selected-item": {
    views: ["panel:inspector"],
    fixture: "map:simple",
    anchor: true,
    reach: [app.select("")],
    measure: { selected: store("selectedIds") },
    checks: [{ metric: "selected", equals: 1 }]
  }
})
```

- `views` names the surfaces this state shows (§ 2 says where the names come from). A state names at least one.
- `fixture` names a map: `map:simple`, `map:complex`, `sample:<part of a name>` or `file:<path>`. The driver doesn't
  generate maps; those names can move to generated maps without touching a state.
- `reach` is an ordered list of steps (§ 4). The driver settles after the last one (§ 5).
- `measure` and `checks` are optional. Every state can be captured; a state with `checks` also grades.
- Owner: whoever adds or changes a view owns its states, as with tests beside code. Review asks for a state the way
  it asks for a test.

From T3: `scripts/mobile-behavior/cases.ts` (cases as data with `kind`, `source`, `checks` on named metrics).
Departure: cases there are one central list; here they sit beside the code so that a view's states move and die
with it, which is what requirement 1 needs.

### 2. Views are enumerated from the code, and an uncovered view fails the build

The driver keeps no list of views. `apps/web/src/components/viewIds.ts` makes the view ids from the registries the app already has, as values:

| Prefix      | Source                                                                  |
| ----------- | ----------------------------------------------------------------------- |
| `panel:`    | `dockPanels`                                                            |
| `dialog:`   | `dialogIds`, a record the compiler keeps complete against `DialogState` |
| `settings:` | `settingsCategories`                                                    |
| `menu:`     | `MENU_TITLES`                                                           |
| `viewport:` | `viewLayoutKinds`                                                       |

`viewCoverage.test.ts` sits beside it, so it runs in `pnpm check:everything`. It fails when a view has no state, when a state names a view that is gone, or when a state names none. Adding a panel without a state fails CI that day. The one manual step left is a new kind of registry, which is one line in `viewIds.ts`.

The test lives in `apps/web` because only there can it import the real registries. Parsing source from the tool would be a second, weaker copy of them.

From T3: nothing directly. T3 lists its poses and journeys by hand. The departure is forced by requirement 1.

### 3. States compose from a fixture, a few axes and steps; the matrix stays small

Two things vary a view, and they are kept apart:

- **Steps** reach the state: select, enter a group, open a dialog. They are per state.
- **Axes** are orthogonal settings the driver applies first: `theme` (dark, light), `window` (three sizes), `panes` (the four layouts), `dock` (default, bare).

Each axis has a default, and a state runs once there. An `anchor: true` state adds its light twin. Values in a state's `axes` each run once more, alone. `--smoke` keeps only the defaults, and `--axes theme=*,window=*` asks for a cross product. So the default sweep is close to the number of states, and an explosion is a choice someone makes per run.

Comparable in-app states (complex vs simple map, selection, pane count, popped-out panels) are either two states that differ in one field, or one state under two axis values. `compare` accepts both.

From T3: `scripts/mobile-e2e/poses.ts` (a declared variation with a `pending` reason). Departure: T3 runs every journey on every pose; here only anchors run the twin, so a full sweep stays cheap enough to run on request.

### 4. States are reached through a dev hook; real input only where input is the subject

`apps/web/src/components/driveHook.ts` publishes `globalThis.__ballestDrive`. `Editor.tsx` imports it dynamically behind `import.meta.env.DEV`, so a production bundle holds none of it, and there is no build flag: the driver always runs the Vite dev server, in the browser and in Electron alike. It sits in `components/` because the dock's controls do. Everything in it calls the app's own actions and store.

Step kinds in `reach`:

- `app.*`: a call through the hook. The default, because it is fast and deterministic.
- `input.*`: a real pointer or key event over the Chrome DevTools Protocol (CDP). Used when the state is about input, such as a menu, a gizmo drag or a dock drag.
- `desktop.*`: an Electron-only step (§ 6).

Rule: reach with `app`, exercise with `input`. Probes read the page (`rect`, `text`, `count`), the store (`store`), the scene (`scene`) or frame times (`frames`).

From T3: `window.t3dev.replay()` in `DevReplayHost.tsx` and the dev-only behavior probe. Departure: T3 drives touches through a device daemon; here CDP's `Input` domain is enough.

### 5. Captures are comparable because the driver fixes everything that moves

Most of this needs nothing from the app. Before any page script runs, the driver injects:

- **Time.** `Date` stands at one instant. Timers and `performance.now` stay real.
- **Ids.** `Math.random`, `crypto.getRandomValues` and `crypto.randomUUID` repeat, so stable keys do too.

And after load:

- **Animation.** The app's motion setting is off, and a style turns off every transition, animation and caret.
- **Shaders.** The hook pins the game time the glows and the air read.
- **WebGL.** SwiftShader: slow, but the same on every machine. `--gpu` opts into the real GPU for `frames` only.
- **Window.** The `window` axis through device metrics, at scale 1.
- **Cost.** Software WebGL draws whatever is open, so states about a dialog, settings page or menu sit over the start
  map, and only states about a map open one. Browser captures can run side by side with `--jobs`, each in its own
  context; desktop captures stay one at a time.
- **Assets.** The driver gets `web-assets/` first, so a fresh worktree shows the same meshes as an old one.

**Settled** is judged from outside: fonts loaded, no request in flight for a moment, and two frames in a row the same. That covers meshes, thumbnails and late layout without the app reporting any of them, and the last frame is the capture. A page that never settles fails.

**Noise floor.** `run --repeat 2` reports the states that differ between identical runs, as `render-metrics.ts --runs` does.

From T3: `render-metrics.ts` (repeat runs prove determinism), `grade.ts` (`frameStats`). The rest is what sessions here found by hand.

### 6. The Electron surfaces run under a private Xvfb, and native dialogs read their answers from a file

Most states run in headless Chromium. A `target: "desktop"` state runs Electron, restarted for each capture:

- `Xvfb -displayfd` picks a display nobody holds. Electron runs on it with the software WebGL flags and `--remote-debugging-port=0`, against this worktree's dev server.
- Popped-out panels are windows of the same process, so they appear as CDP targets, and each adds a picture.
- `HOME`, the XDG folders and the profile all sit in a scratch folder. A driven app never touches `~/Documents/Ballest Editor`, the real settings or the game install.
- Native dialogs can't be reached over CDP. With `BALLEST_APP_DRIVER_DIALOGS` set in an unpackaged app, `main.ts` swaps in `ScriptedDialogs`, which takes each answer from a JSON file, or cancels. A file keeps this out of the IPC contracts entirely.

From T3: the Browser panel skill runs against the worktree's ignored `.t3` state and never the real one. The Xvfb and dialog parts are Ballest's own.

### 7. One worktree, one of everything; stop only what you started

- **Ports and displays.** The driver starts its own Vite on a free port with a strict bind, and fails if that process exits, so it can never drive whatever else answers there. It doesn't use `tools/dev`'s derived port, so a developer's `pnpm dev` keeps it. Chromium takes `--remote-debugging-port=0`, Xvfb `-displayfd`.
- **Processes.** Pids go in `.app-driver/session.json`. A pid is stopped only after `/proc` shows it belongs to this worktree's folder, by environment or command line, since some Chromium wrappers clear the environment. No `pkill -f`, ever. A run stops what it started, including when killed.
- **State.** Output, profiles and logs live under `<worktree>/.app-driver/`, gitignored. Each capture gets a fresh browser context, so storage never leaks between states and a dirty map's `beforeunload` can't hang anything.
- **Fixtures** are read from `samples/`, or from any path with `file:<path>`, which is how `pnpm map build` output comes in. Nothing is written back.

From T3: `scripts/dev-runner.ts` and AGENTS.md "Dev servers" ("stop what you started, by the PID you tracked").

### 8. Output is small by default and structured first

A run writes `<worktree>/.app-driver/runs/<id>/`:

- `results.jsonl`: one row per state per axis value: `id`, `axes`, `pass | null`, `failures`, `metrics`, the
  capture's hash and size, `error` when the state never settled.
- `summary.md`: the scoreboard. Counts, a row for each failure, and pending reasons.
- `shots/<state>[.<axes>].png` full size, and `sheet.webp`, a contact sheet of every capture at most 320 px wide
  with its id under it.
- `a11y/<state>.txt` and `measure/<state>.json`.

What goes back to the caller is `summary.md`, the sheet, and the measurements. Full images are opened by path on
request. With a baseline run named (`--since <run>` or `compare`), the sheet holds only the states whose capture
hash, a11y text or metrics changed; the summary says "12 of 61 states changed" and lists them. The MCP tools
return the same, as text plus the sheet path; they never inline a full-size image.

From T3: `summary.md` plus `results.jsonl` (`mobile-behavior`), and the static HTML report (`report.ts`) which here
becomes the contact sheet. Departure: downscaling and changed-only are the default, not an option, because of the
347-image thread.

### 9. Compare two runs; no committed image baseline

`compare <before> <after>` takes two run folders, usually `main` in a second worktree and the branch, and prints a
markdown table: per state, pixel difference within a small tolerance for rasteriser noise, a11y text diff, metric
deltas, with a side-by-side sheet of the changed states. That is what a PR's before/after shots are.

No baseline images are committed. They would bloat the repo, go stale with every design round and every asset
pack, and their diffs would be reviewed as pixels rather than as states. The baseline is always a run on a known
commit, which any worktree can produce in minutes. `run --name <name>` gives a run a name to compare against.

From T3: `render-metrics.ts` `run` and `compare <before> <after>` with two checkouts, exactly.

### 10. The app driver is a design tool; CI runs only the coverage check

The app driver answers "what does this look like now" and "what changed between these two commits". It doesn't answer "is the app still correct": that is the tests' job, at the lowest layer that fails, and the desktop launch is #69's.

- `pnpm check:everything` runs the coverage test (§ 2) and the states' typecheck. Cheap, every PR, and it is what lets a redesign capture every view before and after.
- No workflow runs the states. From #228 to #252 a workflow ran `run --smoke` on every PR that touched the app. Every failure in its history was a stale state, a flake or a timeout, never a regression, and at 80 states it ran past its 30-minute limit. Its pictures were compared to nothing.
- A state that has drifted from the app is found by the next person who runs it, so whoever changes a view runs its states (AGENTS.md "Verifying") and fixes any that can't be reached.
- `review` (§ 11) never runs in CI.

From T3: `scripts/mobile-behavior`, `mobile-e2e` and `render-metrics.ts` run by hand, never in CI; T3's CI covers the UI with component tests in Vitest's browser mode.

### 11. Model review is a separate, stateless, schema-checked step

`review <run> [--state id]` runs the Claude Code CLI once per state with `-p`, `--json-schema`, `--allowedTools
Read`, `--no-session-persistence`, pointing it at that state's capture and a11y text, with a prompt that names the
axes and lists what is intended and never to be reported. It returns `{ findings: [{ issue, severity }] }`,
written into the run as `findings.jsonl` and folded into `summary.md`. The prompt's "never report" list grows the
way T3's did: each confirmed false positive is added with its reason.

This replaces the screenshot-and-judge agents of the critique rounds with a fixed, cacheable prompt per state.

From T3: `scripts/mobile-e2e/review.ts`, nearly verbatim.

### 12. CLI first, MCP second, one service

The commands are in [the README](../../tools/app-driver/README.md). `serve` exposes the same operations as MCP tools through one service, as `tools/driver` does. Agents use the tools; scripts and people use the CLI. `app_step` and `app_evaluate` run one step or expression on a scratch page, so an agent never again writes a CDP client by hand.

From T3: `--list` and `--case` on `mobile-behavior`; from this repo, the game driver's CLI-plus-MCP shape.

## Out of scope

- Generating maps and seeding worktrees: that is [`pnpm map`](../../tools/map/README.md). The driver takes fixtures by name, and `file:<path>` takes its output.
- The game driver and in-game renders. A combined editor-versus-game comparison is a later tool over both.
- Committed image baselines, visual-regression services, and pixel thresholds tuned per state.
- Performance benchmarking beyond `frameStats` on an opted-in GPU run.
- Playwright or Puppeteer. Node's built-in `WebSocket` over CDP is enough and adds no dependency.
- The web review build on Vercel as a target. The driver runs this checkout's code only.
- Mobile, devices, and anything in T3's simulator machinery.
