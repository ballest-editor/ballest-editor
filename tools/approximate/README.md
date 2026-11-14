# Approximation bench and golden check

Two checks of Tools › Approximate 3D model's fitters ([docs/APPROXIMATE.md](../../docs/APPROXIMATE.md)), on sample models and with the app's own code (`apps/web/src/domain/approximate/`). Neither is part of CI or `check:changed`: they take minutes and need the sample models.

The sample models (Stanford bunny, Utah teapot, Khronos Duck and Fox, three.js's slotted disk and `pr2_head_pan`) are fetched once into `~/.cache/ballest-editor/approximate-models` (`--models` to use another folder) and never checked in. Each is read as the app reads it, with its longest side 3000 cm. A model you put in a folder inside the models folder yourself (`.obj`, `.stl` or `.glb`, for example models read out of a game) runs too, under its file name.

## Bench

`pnpm approximate-bench` runs the methods at equal piece counts and scores them with the dialog's measures.

```sh
pnpm approximate-bench                                    # every model, method and count
pnpm approximate-bench --only bunny --methods boxes,mixed --counts 300,1000
pnpm approximate-bench --methods plates --force          # rerun rows that already exist
pnpm approximate-bench --methods mixed --search-seconds 0 --out /tmp/search-off
```

- Methods: `voxels`, `boxes`, `pieces` (Pieces only, and `pieces-3` with cubes, spheres and cylinders alone and `pieces-nospill` with No spill), `plates` (Plates only) and `mixed` (Pieces and plates).
- Each count (`--counts`, default 100, 300, 1000 and 3000) is the piece budget of the three methods that take one, run as the dialog runs them. Voxel cubes and Merged boxes have their resolution searched to land near it; a method that can't reach a count (Merged boxes on a blocky model) shows the most it reached.
- Jobs run in child processes, half the cores at once by default (`--jobs`). Each writes its row to `<out>/rows/` and its pieces to `<out>/pieces/`, and `table.md` is rebuilt from every row there (`--out`, default `~/.cache/ballest-editor/approximate-bench`). A row that exists is kept unless `--force`.
- Columns: the dialog's measures ([docs/APPROXIMATE.md § Measures](../../docs/APPROXIMATE.md#measures)) and the method's time, without scoring. A plates row also records the representation, the face count where it is a mesh, the acute share before and after remeshing, the counts by path and fallback reason, and the search's statistics.

## Golden check

`pnpm approximate-golden` proves that a change to the fitters' code changed no result. It makes 73 cases (models × methods × budgets, `CASES` in `src/golden.ts`) with the clock replaced (`clock.ts`), so the same code gives the same pieces every time, and keeps a digest of each case's placements.

```sh
pnpm approximate-golden --write            # record what the code makes now, before changing it
pnpm approximate-golden --check            # after: make every case again and compare
pnpm approximate-golden --check --only=duck
```

- Cases without search run with the clock frozen: nothing then depends on how often it is read, and the time-limited stages run to the end of their work.
- Cases with search (`-s2` in their names) run with a clock that ticks a millisecond each time it is read, which bounds the search by its own work. They stay the same only while the searches read the clock at the same places, so a change to `plateSearch.ts`, `piecePolish.ts` or `profile.ts` that adds or removes a read moves them without changing what the app makes.
- `--check` reports each case as identical, the same to rounding (lengths to a hundredth of a cm), or different, and exits 1 on a difference. A change that is meant to move results is judged with the bench instead, and recorded with `--write` afterwards.
- The cases include models read out of Super Mario Galaxy (`smg-*`), which can't be fetched: they must be in a folder inside the models folder.
- The digests live in `~/.cache/ballest-editor/approximate-golden` (`--golden`), not in the repo: they are of models that aren't checked in. A full run takes about six minutes on six cores (`--jobs`).
