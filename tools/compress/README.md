# tools/compress: the extractor's assets, ready to serve

`tools/extract/` writes the raw game data to `assets/`. This step compresses it into `web-assets/`, the tree the editor serves at `/assets/*` (in `vite dev`/`preview`, and copied into the build output by `vite build`). `web-assets/` is committed (about 57 MB): it is how the meshes and textures reach deployments built from git, since `assets/pieces/` and `assets/textures/` are gitignored.

```sh
pnpm assets                                    # node tools/compress/compress.mjs assets web-assets
```

It is the turbo task `//#assets`, which `dev` and `build` depend on. Turbo caches it by the contents of `assets/` (gitignored meshes and textures included) and `tools/compress/`, so it only reruns after a re-extract or a change here.

- With the raw `assets/pieces/` and `assets/textures/` present, it rebuilds `web-assets/` from scratch. The output is deterministic, so a rerun without changes leaves git clean. Commit `web-assets/` after a re-extract.
- With neither present (CI, Vercel, a fresh clone), it keeps the committed `web-assets/` as is.
- With only one present, it fails rather than drop the committed other half.

| `assets/`         | `web-assets/`                            | size (Oct 2026) |
| ----------------- | ---------------------------------------- | --------------- |
| `pieces/**.glb`   | same names, meshopt-compressed, lossless | 89 → 24 MB      |
| `textures/**.png` | `.avif`, 4:4:4, quality 80               | 148 → 29 MB     |
| `materials.json`  | texture paths point at the `.avif` files |                 |
| everything else   | copied as is                             |                 |

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
