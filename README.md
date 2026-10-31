# ballest-editor

A standalone, CAD-style map editor for [Ballest of Them All](https://store.steampowered.com/app/3339810). Reads and writes the game's own `.balledit` / `.ballmap` JSON, so maps made here load in the in-game editor and publish to the Workshop normally.

- [docs/FORMAT.md](docs/FORMAT.md) — the map format, hard limits, where files live
- [docs/VISION.md](docs/VISION.md) — feature roadmap
- `apps/web/` — the editor (React SPA on Vite + TanStack Router, Three.js, Effect). Its web build is only for review: Vercel deploys a preview for each pull request and production from `main`
- `apps/desktop/` — the Electron shell around it ([apps/desktop/README.md](apps/desktop/README.md) explains how it works; plan in [docs/DESKTOP.md](docs/DESKTOP.md))
- `packages/contracts/` — schemas and the `DesktopBridge` interface shared by the desktop main process, preload and renderer
- `tools/extract/` — pulls piece meshes out of the game pak (Nix flake)
- `tools/dev/` — the `pnpm dev` and `pnpm dev:desktop` runner (one dev port per checkout, so worktrees run side by side)
- `tools/compress/` — compresses the extracted meshes and textures and publishes them as a GitHub release asset pack
- `tools/release/` — builds the Windows installer and Linux AppImage; a `v*.*.*` tag publishes them as a GitHub release

To use the editor, install the desktop app from the [latest release](https://github.com/ballest-editor/ballest-editor/releases/latest) (Windows installer or Linux AppImage).

Contributors and coding agents: read [AGENTS.md](AGENTS.md).

The game, its name and its content belong to its developers. See [NOTICE.md](NOTICE.md) for what this repository includes from the game and from Workshop creators, and for the license status.
