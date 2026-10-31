# ballest-editor — agent instructions

A standalone map editor for _Ballest of Them All_ (Steam 3339810, UE 5.8). Read `docs/FORMAT.md` (the map JSON format, hard limits, validation rules) and `docs/VISION.md` (where this is going) before changing anything.

## Ground rules

- **Never write to the game install** at `~/.local/share/Steam/steamapps/common/Ballest of Them All`. Copy what you need to `/tmp`.
- Map samples live in `samples/` (`UserSavedMaps/*.balledit` drafts, `Workshop/*.ballmap` published). They are test fixtures; don't edit them.
- Game-derived assets live in `assets/` (`catalog.json`, `pieces/*.glb`), produced by `tools/extract/`. `tools/compress/` turns the gitignored meshes and textures into `web-assets/` (meshopt, AVIF; also gitignored) and publishes it as an asset pack (a GitHub release tarball), recorded in `web-assets.json`; machines without the game download that instead. The app serves everything at `/assets/*` (`apps/web/src/editor/assetUrl.ts`). None of these are edited by hand.
- Keep the game's conventions: positions in centimetres, rotations as unit quaternions, UE left-handed Z-up. Convert to the renderer's frame in exactly one place.

## Layout

- Turborepo + pnpm workspace. Run `pnpm dev|dev:desktop|test|typecheck|build|lint|knip|dupes|format` from the root; `pnpm check:everything` runs format check, lint, knip, duplicate detection, typecheck, tests and build (in parallel, cached by turbo), and must pass before committing.
- Typecheck is `effect-tsgo tsc` (TypeScript 7 + Effect diagnostics; config in `tsconfig.base.json`). Lint is type-aware oxlint (`.oxlintrc.json`). Formatting is dprint (`dprint.json`, Effect's style). Duplicate code is jscpd (`.jscpd.json`: exact token clones plus structurally similar functions; shadcn components excluded). Don't run `effect-tsgo patch`: pnpm hard-links node_modules to the global store.
- `apps/web/` — React SPA (Vite + TanStack Router) + Three.js editor. Effect for all non-trivial logic (services, schema, errors). It never imports `electron` or `apps/desktop`.
  Layers, enforced by `no-restricted-imports` in `.oxlintrc.json`: `domain/` (data model; no renderer, UI or node builtins) ← `services/` (Effect services) ← `editor/` (scene, store, actions) ← `components/` (React UI; reaches services through `editor/actions`) ← `routes/`. `src/test/` helpers are for tests only; nothing imports `repos/`.
- `apps/desktop/` — Electron main process and preload (`docs/DESKTOP.md`). Bundled to CJS in `dist-electron/` by `vite build`. The `electron` package has no install script: it downloads the binary (~100 MB, cached in `~/.cache/electron`) the first time it is launched or `require`d from Node.
- `packages/contracts/` — `@ballest/contracts`: Effect schemas and the `DesktopBridge` interface shared by main, preload and renderer. Depends on `effect` only; exports `src/` directly, no build.
- `packages/ui/` — shadcn/ui (`@workspace/ui`, preset `b6nCVm82TK`). All UI chrome comes from here.
- `packages/ballest-editor-link/` — AngelScript plugin for the Ballest plugin manager (`info.toml` + `main.as`): races the map when the desktop app's Play writes `play.json`. Not on the plugin manager's registry; the desktop app bundles it and installs it into the game's plugins folder on demand (#118).
- `tools/extract/` — pak → glTF/catalog/keybinds pipeline, run via the Nix flake (`nix run .#extract`).
- `tools/dev/` — the `pnpm dev` / `pnpm dev:desktop` runner: picks the checkout's port (3000, or one per linked worktree) and runs the `dev` tasks through turbo.
- `tools/compress/` — `assets/{pieces,textures}` → `web-assets/` (`pnpm assets`, the turbo task `//#assets` that `dev` and `build` depend on) downloading the published pack when the raw files are absent; `pnpm assets:publish` → GitHub release `assets-<hash>` + `web-assets.json`.
- `repos/` — vendored read-only references (see below).
- `docs/` — format, vision, decisions.

## Vendored repositories

This project vendors external repositories under `repos/` using `git subtree` (`--squash`).

- Use vendored repositories as read-only reference material when working with related libraries.
- Prefer examples and patterns from the vendored source over guesses or web search results.
- Do not edit files under `repos/` unless explicitly asked.
- Do not import from `repos/` — application code imports from normal package dependencies.

Update with: `git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git main --squash`

### Effect

We use **Effect v4** (`effect@^4`). Before writing Effect code, read `repos/effect/LLMS.md` — it is the source of truth for v4 idioms (`Effect.gen`, `Effect.fn`, `Schema.TaggedError`, `ServiceMap`/`Layer`, etc.). Inspect `repos/effect/packages/effect/` for API details and `repos/effect/packages/*/test` for usage. v3 tutorials on the web are frequently wrong for v4.

## Conventions

- TypeScript strict (see `tsconfig.base.json`); pnpm; vitest (`@effect/vitest`) for tests. Fix lint findings rather than disabling rules; a disable comment needs a `-- reason`.
- Errors are `Schema.TaggedError` classes; no thrown exceptions across service boundaries.
- Map file I/O goes through a single `MapFile` schema (`Schema.Class`) that decodes the game JSON and encodes it back; the catalog through a `Catalog` schema. Add a round-trip test against every file in `samples/` when touching either.
- Commit only when asked. Commit messages, PR titles and issue titles follow Conventional Commits (`commitlint.config.mjs`); PRs are squash-merged with the PR title as the commit on `main`. `main` only changes through PRs that pass CI.
- Git hooks (husky): pre-commit formats and lints staged files (lint-staged), commit-msg runs commitlint, pre-push runs `pnpm check:everything`.
