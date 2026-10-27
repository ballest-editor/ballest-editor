# ballest-editor — agent instructions

A standalone map editor for _Ballest of Them All_ (Steam 3339810, UE 5.8). Read `docs/FORMAT.md` (the map JSON format, hard limits, validation rules) and `docs/VISION.md` (where this is going) before changing anything.

## Ground rules

- **Never write to the game install** at `~/.local/share/Steam/steamapps/common/Ballest of Them All`. Copy what you need to `/tmp`.
- Map samples live in `samples/` (`UserSavedMaps/*.balledit` drafts, `Workshop/*.ballmap` published). They are test fixtures; don't edit them.
- Game-derived assets live in `assets/` (`catalog.json`, `pieces/*.glb`), produced by `tools/extract/`. The app reads them; it must not hand-edit them.
- Keep the game's conventions: positions in centimetres, rotations as unit quaternions, UE left-handed Z-up. Convert to the renderer's frame in exactly one place.

## Layout

- Turborepo + pnpm workspace. Run `pnpm dev|test|typecheck|build|lint|knip|dupes|format` from the root; `pnpm check:everything` runs format check, lint, knip, duplicate detection, typecheck, tests and build (in parallel, cached by turbo), and must pass before committing.
- Typecheck is `effect-tsgo tsc` (TypeScript 7 + Effect diagnostics; config in `tsconfig.base.json`). Lint is type-aware oxlint (`.oxlintrc.json`). Formatting is dprint (`dprint.json`, Effect's style). Duplicate code is jscpd (`.jscpd.json`: exact token clones plus structurally similar functions; shadcn components excluded). Don't run `effect-tsgo patch`: pnpm hard-links node_modules to the global store.
- `apps/editor/` — TanStack Start (React) + Three.js editor. Effect for all non-trivial logic (services, schema, errors).
  Layers, enforced by `no-restricted-imports` in `.oxlintrc.json`: `domain/` (data model; no renderer, UI or node builtins) ← `services/` (Effect services) ← `editor/` (scene, store, actions) ← `components/` (React UI; reaches services through `editor/actions`) ← `routes/`. `src/test/` helpers are for tests only; nothing imports `repos/`.
- `packages/ui/` — shadcn/ui (`@workspace/ui`, preset `b6nCVm82TK`). All UI chrome comes from here.
- `tools/extract/` — pak → glTF/catalog/keybinds pipeline, run via the Nix flake (`nix run .#extract`).
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
- Commit only when asked.
