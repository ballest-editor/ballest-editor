<img src="assets/icon.svg" width="64" height="64" alt="">

# ballest-editor

A standalone, CAD-style map editor for [Ballest of Them All](https://store.steampowered.com/app/3339810). Reads and writes the game's own `.balledit` / `.ballmap` JSON, so maps made here load in the in-game editor and publish to the Workshop normally.

- [docs/FORMAT.md](docs/FORMAT.md) — the map format, hard limits, where files live
- [docs/VISION.md](docs/VISION.md) — feature roadmap
- `apps/editor/` — the editor (TanStack Start, Three.js, Effect)
- `tools/extract/` — pulls piece meshes out of the game pak (Nix flake)
- `tools/compress/` — compresses the extracted meshes and textures and publishes them to Vercel Blob

Contributors and coding agents: read [AGENTS.md](AGENTS.md).
