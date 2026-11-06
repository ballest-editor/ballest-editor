# ballest-editor: agent instructions

Ballest Editor is a standalone map editor for _Ballest of Them All_ (Steam 3339810, UE 5.8). Read `docs/FORMAT.md` (the map JSON format, hard limits, validation rules) and `docs/VISION.md` (where this is going) before changing anything. The root `README.md` lists every other doc.

## Ground rules

- **Never write to the game install** at `~/.local/share/Steam/steamapps/common/Ballest of Them All`. Copy what you need to `/tmp`. The one exception is the app's own plugin folder, `<plugins>/ballest-editor-link/` (its files and `play.json`), and only through `apps/desktop/src/game/GameLink.ts` when the user asks; tests use fixture folders.
- Map samples live in `samples/` (`UserSavedMaps/*.balledit` drafts, `Workshop/*.ballmap` published). They are test fixtures; don't edit them.
- Game-derived assets live in `assets/` (`catalog.json`, `pieces/*.glb`), produced by `tools/extract/`. `tools/compress/` turns the gitignored meshes and textures into `web-assets/` (meshopt, AVIF; also gitignored) and publishes it as the asset pack (a GitHub release tarball), recorded in `tools/compress/web-assets.json`; machines without the game download that instead. The app serves everything at `/assets/*` (`apps/web/src/editor/assetUrl.ts`). None of these are edited by hand, except `assets/verified.json`, the hand-kept record of which pieces loaded in game.
- Keep the game's conventions: positions in centimetres, rotations as unit quaternions, UE left-handed Z-up. Convert to the renderer's frame in exactly one place.

## Terms

Use one name per thing, in code comments and docs alike.

| Name               | Means                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ballest Editor     | The product. "The desktop app" when the contrast with the web review build matters.                                                                        |
| web review build   | `apps/web` deployed by Vercel for pull requests and `main`. Not a product.                                                                                 |
| asset pack         | The compressed meshes and textures, published as a GitHub release tagged `assets-<hash>`.                                                                  |
| editor plugin      | `ballest-editor-link`, the plugin behind Play.                                                                                                             |
| driver plugin      | `ballest-driver`, installed only into the game driver's copies of the game.                                                                                |
| plugin manager     | The third-party [Ballest plugin manager](https://anythinggoes-ballest.github.io/ballest-plugin-manager/). Its `version.dll` inside the game is "the host". |
| game driver        | `tools/driver`, the MCP server that runs sandboxed copies of the game.                                                                                     |
| in-game editor     | The game's own map editor (not "track editor" or "level editor").                                                                                          |
| game's maps folder | `UserSavedMaps`.                                                                                                                                           |
| dock, centre group | The dockview shell between the top bar and status bar; the centre group is its group of map tabs and the viewport.                                         |
| popped-out panel   | A dock panel in a window of its own. Not "floating": that's dockview's in-window group, which is off.                                                      |
| pane, active pane  | One camera's view inside the viewport; the active pane is the last hovered or clicked, what the fly keys and Frame all act on. Not a dock panel.           |
| piece, item        | A piece is a kind of thing in the catalog; an item is one placed in a map.                                                                                 |
| definition         | A prefab's file. A prefab in a tab is that definition, open.                                                                                               |
| instance           | A placed prefab: a group with a `prefab` link in the sidecar.                                                                                              |
| user, project tier | Where prefabs live: the game's own prefabs folder, and `<project>/prefabs/`.                                                                               |
| sidecar            | `maps/<file name>.editor.json`, what a map holds that the game's format can't.                                                                             |
| stable key         | An item's one identity in the editor: `Doc.ids` in the store, the keys in the sidecar.                                                                     |

## Layout

- Turborepo + pnpm workspace. Run `pnpm dev|dev:desktop|test|typecheck|build|lint|knip|dupes|format` from the root; `pnpm check:changed` runs the fast checks for what the branch changed and must pass before committing; `pnpm check:everything` runs format check, lint, knip, duplicate detection, typecheck, tests and build (in parallel, cached by turbo) on push and in CI.
- Typecheck is `effect-tsgo tsc` (TypeScript 7 + Effect diagnostics; config in `.config/tsconfig.base.json`). Lint is type-aware oxlint (`.config/oxlintrc.json`). Formatting is dprint (`dprint.json`, Effect's style). Duplicate code is jscpd (`.config/jscpd.json`: exact token clones plus structurally similar functions; shadcn components excluded). Don't run `effect-tsgo patch`: pnpm hard-links node_modules to the global store.
- Keep the root short: tool configs go in `.config/` (the script passes `--config`) or a `package.json` key (`commitlint`, `lint-staged`). oxlint matches globs against paths relative to its config's folder, so `.config/oxlintrc.json` starts its `overrides` globs with `**/`, and ignores go in `--ignore-pattern` flags in the `lint` script and lint-staged. `dprint.json` stays at the root: the dprint VS Code extension only formats files under the folder that holds the config, and it has no setting to point it elsewhere. `CLAUDE.md` is `.claude/CLAUDE.md`, a symlink to `AGENTS.md`.
- `apps/web/` is the React SPA (Vite + TanStack Router) and Three.js editor. Effect for all non-trivial logic (services, schema, errors). It never imports `electron` or `apps/desktop`. The desktop app is the product; the web review build deploys from `apps/web/vercel.json`. Don't add web-only features. `apps/web/build/` is what `vite.config.ts` runs: `virtual:build-info` (the commit and build time) and `virtual:third-party-notices` (the app's production dependencies from the lockfile, through `pnpm licenses list`, with their licence texts).
  Layers, enforced by `no-restricted-imports` in `.config/oxlintrc.json`: `domain/` (data model; no renderer, UI or node builtins) ← `services/` (Effect services) ← `editor/` (scene, store, actions) ← `components/` (React UI; reaches services through `editor/actions`) ← `routes/`. `src/test/` helpers are for tests only; nothing imports `repos/`.
- `apps/desktop/` is the Electron main process and preload ([its README](apps/desktop/README.md), `docs/DESKTOP.md`). Bundled to CJS in `dist-electron/` by `vite build`. The `electron` package has no install script: it downloads the binary (~100 MB, cached in `~/.cache/electron`) the first time it is launched or `require`d from Node. Every IPC message has a schema in `packages/contracts`, and main decodes the payload before a handler runs.
- `packages/contracts/` is `@ballest/contracts`: Effect schemas, the bridge's method table (`DesktopMethods`) and the `DesktopBridge` type mapped from it, shared by main, preload and renderer. `@ballest/contracts/channels` (the IPC channels) imports nothing, so the preload can bundle it. Depends on `effect` only; exports `src/` directly, no build.
- `packages/ui/` is shadcn/ui (`@workspace/ui`, preset `b6nCVm82TK`). All UI chrome comes from here.
- `packages/ballest-editor-link/` is the editor plugin, AngelScript for the plugin manager (`info.toml` + `main.as`): it races the map when the desktop app's Play writes `play.json`. It isn't on the plugin manager's registry. Its `build` stages `info.toml` + `main.as` into `dist/ballest-editor-link/`, which the desktop app ships as `resources/plugins/ballest-editor-link` and installs into the game's plugins folder when the user asks (Settings › Game).
- `packages/ballest-driver/` is the driver plugin: it does what the host's test channel can't, for the game driver. Its `build` stages `dist/ballest-driver/`, which `pnpm driver setup` copies into the driver's copy of the game. Never a player's game.
- `tools/extract/` is the pak → glTF/catalog/keybinds pipeline, run with `nix develop -c tools/extract/run.sh` (`tools/extract/README.md`). `panel.json` and `paint-measured.json` beside it are measured in the game and checked in; re-measure them after a game patch rather than editing them by guess.
- `tools/dev/` is the `pnpm dev` / `pnpm dev:desktop` runner, which picks the checkout's port (3000, or one per linked worktree) and runs the `dev` tasks through turbo, and `pnpm check:changed`.
- `tools/compress/` turns `assets/{pieces,textures}` into `web-assets/` (`pnpm assets`, the turbo task `//#assets` that `dev` and `build` depend on), downloading the published asset pack when the raw files are absent; `pnpm assets:publish` publishes a GitHub release `assets-<hash>` and updates `tools/compress/web-assets.json`.
- `tools/release/` packages the desktop app with electron-builder (`pnpm dist:desktop:win|linux`, `pnpm release:smoke`) and checks a release's assets; `.github/workflows/release.yml` runs it on `v*.*.*` tags.
- `tools/driver/` is the game driver (`pnpm driver`, `docs/DRIVER.md`): an MCP server (`.mcp.json` registers it) that runs sandboxed copies of the game headless under Proton in `~/.cache/ballest-editor/driver/` and drives them through the plugin manager's test channel: render, state, the in-game editor, `dumptypes`, map probes. Linux only; needs Steam running, which an agent never starts itself, and the plugin manager host built from the fork's `ui-dump` branch (`tools/driver/README.md`).
- `tools/map/` is `pnpm map`: inspect, validate, diff, build and seed maps with the editor's own domain code ([its README](tools/map/README.md)). Reach for it before writing a script over a map.
- `repos/` holds vendored read-only references (see below).
- `docs/` holds the format, the vision, the desktop app's design, the project model and the game driver's design. `docs/qa/` holds what was measured in the game, case by case, and `docs/mockups/` holds wireframes.

## Verifying

- Before committing, run `pnpm check:changed`. While you iterate, run the tests beside your change (`pnpm --filter <package> exec vitest run <file>`). Don't run `pnpm check:everything` by hand unless asked: push and CI own the full suite.
- Test at one layer, the lowest that fails on `main`. Extend an existing test or table before adding one.
- A logic, data or state bug gets a failing test first, then the fix. A purely visual bug gets a before and after in the integrated pass.
- When work is split across agents, a delegated agent proves its change with tests and says what needs looking at. It doesn't start a dev server or a browser unless its brief says to. The agent that integrates does one pass in the running app, with the `test-ballest-app` skill, which also has the only browser automation to use.
- Never `pkill -f`, `pgrep -f` or kill a process found by matching a name or path: your own shell has that text in its command line, and other agents share this machine. Stop what you started, by its PID or port.

## Vendored repositories

This project vendors external repositories under `repos/` using `git subtree` (`--squash`).

- Use vendored repositories as read-only reference material when working with related libraries.
- Prefer examples and patterns from the vendored source over guesses or web search results.
- Do not edit files under `repos/` unless explicitly asked.
- Do not import from `repos/`. Application code imports from normal package dependencies.

Update with: `git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git main --squash`

### Effect

We use **Effect v4** (`effect@^4`). Before writing Effect code, read `repos/effect/LLMS.md`, the source of truth for v4 idioms (`Effect.gen`, `Effect.fn`, `Schema.TaggedError`, `Context.Service`/`Layer`, etc.). Inspect `repos/effect/packages/effect/` for API details and `repos/effect/packages/*/test` for usage. v3 tutorials on the web are frequently wrong for v4.

## Conventions

- TypeScript strict (see `.config/tsconfig.base.json`); pnpm; vitest (`@effect/vitest`) for tests. Fix lint findings rather than disabling rules; a disable comment needs a `-- reason`.
- Errors are `Schema.TaggedError` classes; no thrown exceptions across service boundaries.
- Map file I/O goes through a single `MapFile` schema (`Schema.Opaque`) that decodes the game JSON and encodes it back; the catalog through a `Catalog` schema. Add a round-trip test against every file in `samples/` when touching either.
- Docs say what's true now, each fact has one home, and other files link to it. Use the names in § Terms.
- Commit only when asked. Commit messages, PR titles and issue titles follow Conventional Commits (`commitlint` in `package.json`); PRs are squash-merged with the PR title as the commit on `main`. `main` only changes through PRs that pass CI.
- Git hooks (husky): pre-commit formats and lints staged files (lint-staged), commit-msg runs commitlint, pre-push runs `pnpm check:everything`, so a push takes the full run.
