# tools/app-driver: put Ballest Editor in a known state, then look, measure or compare

The app driver is to the editor what the game driver is to the game. It starts the app in isolation, reaches a declared state, and returns a capture, measurements or a comparison. Use it instead of writing a browser script. [The design](../../docs/design/app-driver.md) says why it is the way it is.

## Run

```sh
pnpm app-driver list                                  # the states
pnpm app-driver list --uncovered                      # views with no state
pnpm app-driver capture editor/map                    # one state
pnpm app-driver run --smoke                           # every state at its default axes
pnpm app-driver run                                   # plus light twins and each state's listed axes
pnpm app-driver run --view panel:outline --axes theme=*,window=*   # a cross product, on request
pnpm app-driver run --repeat 2                        # finds states that differ between identical runs
pnpm app-driver run --jobs 3                          # browser captures side by side; desktop ones stay one at a time
pnpm app-driver run --name after --since before       # sheets hold only what changed
pnpm app-driver compare before after                  # by name or folder
pnpm app-driver review --state dialog/about           # a stateless model review; costs money, never in CI
pnpm app-driver start                                 # keeps the server and browser up between commands
pnpm app-driver stop                                  # stops what this worktree started, by pid
```

`.mcp.json` registers the same operations as `ballest-app-driver`: `app_list`, `app_run`, `app_compare`, `app_step`, `app_evaluate` and `app_stop`. `app_step` and `app_evaluate` explore on a scratch page without a script.

It needs Chromium on `PATH`, or `BALLEST_CHROMIUM`. Desktop states also need `Xvfb`. The first desktop state downloads Electron if it is missing.

## Output

A run lands in `.app-driver/runs/<name>/`, gitignored:

- `summary.md`: the scoreboard. Read this first.
- `sheet-<n>.webp`: contact sheets of up to 20 small captures. Read these before any full picture.
- `results.jsonl`: one row per capture, with its metrics, hash and failures.
- `shots/` and `a11y/`: full pictures and accessibility trees, on request.

A capture fails on a failed check, a page error, or a page that never settles. A `bad` state reproduces a known bug and doesn't fail the run.

## Comparing two commits

The scenarios run each tree's code, so two commits need two checkouts:

```sh
git worktree add ../before main
(cd ../before && pnpm install && pnpm app-driver run --smoke --name main)
pnpm app-driver run --smoke --name branch --since ../before/.app-driver/runs/main
```

## Add a state

A state is data in a `*.states.ts` file under `apps/web/src`, beside the view it shows. `src/state.ts` is the vocabulary.

```ts
import { app, count, states } from "@ballest/app-driver/state"

export default states({
  "panel/outline": {
    views: ["panel:outline"],
    fixture: "map:simple",
    reach: [app.select("")],
    measure: { rows: count("[role=treeitem]") },
    checks: [{ metric: "rows", min: 1 }]
  }
})
```

- **`views`** names what the state shows, from `apps/web/src/components/viewIds.ts`. That list is made from the app's own registries, and `viewCoverage.test.ts` fails on a view with no state or a state naming a dead view.
- **`reach`** uses `app.*` to get somewhere and `input.*` when the input is the subject. Prove the state happened with a check: an empty capture would otherwise pass.
- **`anchor`** adds a light twin, and `axes` lists other values to run. Each runs alone, so the count stays near the number of states.
- **`fixture`** costs time: software WebGL draws whatever map is open behind a dialog. Use `none` unless the map is the subject.
- **`target: "desktop"`** runs in Electron under a private Xvfb, in a throwaway home. Use it for popped-out panels, native dialogs and what a browser lacks.
- **`pending`** counts as coverage and shows its reason in every summary.

A new kind of view goes in `viewIds.ts`, read from its registry. A new fixture name goes in `src/fixtures.ts`.

## How it stays repeatable

The clock stands at one instant and random numbers and ids repeat, both pinned from outside the app before its scripts run. The shaders' game time is pinned, and motion is off. Captures use software WebGL, so they match across machines. `--gpu` swaps in the real GPU for frame times, and its pictures aren't comparable.

"Settled" needs no help from the app: fonts loaded, no request in flight, and two frames in a row the same.

Nothing here reaches production. The page's hook is `apps/web/src/components/driveHook.ts`, behind `import.meta.env.DEV`. Scripted native dialogs need `BALLEST_APP_DRIVER_DIALOGS` and an unpackaged app.
