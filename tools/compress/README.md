# tools/compress: the extractor's meshes and textures, ready to serve

`tools/extract/` writes the raw game data to `assets/`. Its small files (catalog, materials, keybinds, strings, registry, thumbs) are committed and the editor serves them itself at `/assets/*`. Its meshes (`assets/pieces/`, 89 MB) and textures (`assets/textures/`, 148 MB) are gitignored. This step compresses those two into `web-assets/` (about 53 MB, also gitignored), and `publish.mjs` publishes that as the **asset pack**: a tarball on a GitHub release, which machines without the game download instead.

```sh
pnpm assets           # compress.mjs assets web-assets, then download.mjs
pnpm assets:publish   # publish.mjs web-assets web-assets.json  (needs `gh`, logged in)
```

| `assets/`         | `web-assets/`                            | size (Oct 2026) |
| ----------------- | ---------------------------------------- | --------------- |
| `pieces/**.glb`   | same names, meshopt-compressed, lossless | 89 → 24 MB      |
| `textures/**.png` | `.avif`, 4:4:4, quality 80               | 148 → 29 MB     |

## Where the editor reads from

Always `/assets/*` (`apps/web/src/editor/assetUrl.ts`). Paths are the extractor's (`pieces/...glb`, `textures/...png`); textures are requested as `.avif`. `vite dev` and `vite preview` serve `assets/` and `web-assets/` from disk, `vite build` copies both into `dist/`, and the desktop app serves the same paths through its protocol handler. Nothing is fetched from another origin.

`pnpm assets` is the turbo task `//#assets` that `dev` and `build` depend on. Turbo caches it by the scripts, `web-assets.json` and the raw files.

- With `assets/pieces/` and `assets/textures/` on disk (the game was extracted here), `compress.mjs` rebuilds `web-assets/` from them and `download.mjs` does nothing, except point out that the tree isn't the published one yet. `compress.mjs` fails if only one of the two directories is present.
- Without them (CI, Vercel, a fresh clone), `download.mjs` fetches the pack `web-assets.json` names, checks its size and SHA-256, unpacks it and checks the tree hash against the tag. It skips the download when `web-assets/` already has that hash, and fails the build when the pack can't be fetched or doesn't verify.

Vercel's build command (`apps/web/vercel.json`) runs `turbo run build --filter=@ballest/web` from the repo root so that `//#assets` runs before `vite build`.

## Publishing: GitHub release

`publish.mjs` hashes the whole tree (every path and its bytes; 16 hex digits) and tars it with sorted entries, mtime 0 and portable modes, gzip level 9 (about 40 MB: meshopt output still compresses). It creates a prerelease tagged `assets-<hash>`, never marked latest, with `web-assets.tar.gz` attached, and writes `web-assets.json`:

```json
{ "tag": "assets-<hash>", "sha256": "<tarball sha256>", "size": <bytes> }
```

It is idempotent: when the release already has the tarball, it records GitHub's digest for it and uploads nothing; when the release exists without one (an interrupted run), it uploads. **Commit `web-assets.json` after a re-extract**, together with `assets/`. Old `assets-*` releases can be deleted once no branch's `web-assets.json` names them (`gh release delete <tag> --cleanup-tag`).

Release downloads are free and need no token, so forks and contributors without the game build with the same meshes. The pack is only fetched at build time; browsers load the files from the deployment itself (GitHub's download URLs send no CORS headers, so they couldn't be fetched from the page anyway).

## Meshes: lossless

`gltfpack -cc -noq -kn -km -ke -kv`. `-noq` turns quantization off, so attributes stay float32; `-kn -km -ke -kv` keep node names, materials (the `<slot>:<name>` names), extras (`ueMaterialIndex`) and every vertex attribute. Meshes are renamed `mesh_0`, … and identical vertices are merged, which the editor doesn't depend on.

Checked by decoding every piece before and after with three.js's `GLTFLoader` + `MeshoptDecoder` and comparing, per mesh, the world matrix, material names, attribute set and the sorted multiset of triangles with every attribute value: all 195 identical. The check fails on quantized output, so it does catch differences. drei's `useGLTF` decodes meshopt by default.

**`gltfpack` is pinned to 1.2.0.** 1.3.0 also welds vertices whose UVs differ by about 2⁻²², which changed one piece (`SM_CornerScoop`); there is no flag to turn that off. Rerun the check above before upgrading.

## Textures: AVIF, lossy

`avifenc --speed 6 -q 80 -y 444 -a tune=ssim`. Measured against the PNGs (which are themselves decoded from the game's BC1/BC3/BC4/BC5 textures): 29.4 MB in total, mean 51.0 dB PSNR, worst 38.5 dB (`T_concrete_normal`). A lit render of that normal map is indistinguishable from the PNG at 1:1 and 3× zoom.

- **4:4:4**: normal maps and packed masks keep data in the colour channels. Chroma subsampling (always on in lossy WebP, and AVIF's default) smears it; lossy WebP scored 14.7 dB on `T_Default_Material_Grid_M`.
- **`tune=ssim`**: aom 3.13+ defaults to `tune=iq`, a perceptual mode that cost `T_concrete_normal` 9 dB at the same `-q`.
- Considered: AVIF q60 (16 MB, worst 33 dB), lossless WebP (99 MB), oxipng (109 MB), KTX2 UASTC (75 MB with mips, worst 29.7 dB, but stays compressed in GPU memory), KTX2 ETC1S (18 MB, worst 19 dB).

`avifenc` comes from `PATH` (the dev shell has it); otherwise the script builds `.#libavif` from the flake, so encodes follow `flake.lock`. It is only needed when `assets/textures/` exists.
