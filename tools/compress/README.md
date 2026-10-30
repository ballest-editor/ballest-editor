# tools/compress: the extractor's meshes and textures, ready to serve

`tools/extract/` writes the raw game data to `assets/`. Its small files (catalog, materials, keybinds, strings, registry, thumbs) are committed and the editor serves them itself at `/assets/*`. Its meshes (`assets/pieces/`, 89 MB) and textures (`assets/textures/`, 148 MB) are gitignored. This step compresses those two into `web-assets/` (about 53 MB, also gitignored), and `upload.mjs` publishes that to a public Vercel Blob store, which is where deployments and clones without the raw data get them from.

```sh
pnpm assets           # node tools/compress/compress.mjs assets web-assets
pnpm assets:upload    # node tools/compress/upload.mjs web-assets web-assets.json  (needs BLOB_READ_WRITE_TOKEN)
```

| `assets/`         | `web-assets/`                            | size (Oct 2026) |
| ----------------- | ---------------------------------------- | --------------- |
| `pieces/**.glb`   | same names, meshopt-compressed, lossless | 89 → 24 MB      |
| `textures/**.png` | `.avif`, 4:4:4, quality 80               | 148 → 29 MB     |

## Where the editor reads from

`apps/web/src/editor/assetUrl.ts` is the one place that decides. Paths are always the extractor's (`pieces/...glb`, `textures/...png`); textures are requested as `.avif`.

- `web-assets/` on disk (you ran `pnpm assets`): `vite dev`, `vite preview` and `vite build` serve it at `/assets/*` next to the committed files.
- Otherwise (Vercel, CI, a fresh clone): `vite.config.ts` reads `web-assets.json` and builds the client with `VITE_ASSETS_BASE` set to that URL, so meshes and textures are fetched from the blob store.

`pnpm assets` is the turbo task `//#assets` that `dev` and `build` depend on. It is a no-op when `assets/pieces/` and `assets/textures/` are absent, and fails if only one of them is. Turbo caches it by their contents and by `compress.mjs`.

## Publishing: Vercel Blob

The store is `ballest-assets` (public, `iad1`), connected to the `ballest-editor` project. `vercel link` writes its `BLOB_READ_WRITE_TOKEN` to `.env.local`, which `pnpm assets:upload` loads.

`upload.mjs` hashes the whole tree and uploads under `<hash>/`, so blobs are immutable and served with a one-year cache; a re-extract gets a new prefix and never fights the CDN or browser cache. It skips blobs that already exist, then writes the base URL to `web-assets.json`. **Commit `web-assets.json` after a re-extract**, together with `assets/`. Old prefixes are not deleted automatically: `vercel blob list --prefix <old>/` and `vercel blob delete` once the deployment that used it is gone (deletes are free).

Free (Hobby) plan limits, shared with everything else on the account: 1 GB stored, 10 GB downloaded a month, 10,000 cache-miss reads, 2,000 writes. One tree is 53 MB and about 250 writes; a user's first load of a full map is up to 53 MB, after which the one-year cache keeps repeats off the meter. Vercel emails as limits approach and switches Blob off for 30 days once they are exceeded, so watch the Observability page if usage grows.

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
