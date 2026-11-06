# Map tool

`pnpm map` runs the editor's own map code on the command line, so looking into a map or making one doesn't take a throwaway script. It reads and writes through `MapCodec` and checks with `validateMap`, so its answers match the app's.

| Command                                           | Does                                                          |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm map inspect <file> [--json]`                | Name, size, characters against the limit, most used pieces    |
| `pnpm map validate <file...> [--json]`            | The Inspector's Validate; fails when a map has errors         |
| `pnpm map diff <before> <after> [--json]`         | Items added, removed and moved, and the change in each piece  |
| `pnpm map build <folder> [--items --seed --name]` | Writes a generated map; the same options write the same bytes |
| `pnpm map seed [folder] [--samples] [--force]`    | Makes a test project (default `.dev-project/`, gitignored)    |

- A built map uses only pieces on the palette that `assets/verified.json` records as loaded in the game, and is refused if `validateMap` finds an error.
- `seed` writes Small, Medium and Large maps (20, 500 and 5,000 pieces). `--samples` copies `samples/UserSavedMaps` in as well. Data flows one way: copies, never links.
- `diff` doesn't read sidecars, so items pair by class and position, and an item that moved far can count as one removed and one added.
- Nothing here writes to `samples/` or the game install.

`src/register.ts` lets plain `node` load `apps/web`'s domain code, whose imports have no extensions. The tool has `@ballest/web` as a dependency so turbo reruns its tests when that code changes.
