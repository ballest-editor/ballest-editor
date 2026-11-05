# Notice

Ballest Editor is an independent map editor for [Ballest of Them All](https://store.steampowered.com/app/3339810). _Ballest of Them All_, its name, and all of its content belong to the game's developers.

## Game content in this repository

- `assets/thumbs/` holds the game's content-browser icons. They are redistributed with the developers' permission.
- `assets/*.json` (the piece catalog, item registry, materials, keybinds and UI strings) is data `tools/extract/` reads from the game's files so that maps made in the editor load in the game. `assets/verified.json` is our own record of which pieces loaded in game.
- Piece meshes and textures extracted from the game are not in this repository. They are published as the asset pack, a GitHub release tagged `assets-<hash>`, which builds download and bundle into the editor.

## Sample maps

`samples/Workshop/` holds maps that players published on the Steam Workshop. They are kept as test fixtures for the map format. Their creators' names have been replaced with `creator01`, `creator02`, and so on. `samples/UserSavedMaps/` holds the maintainer's own drafts.

## License

The code and everything else here that this file doesn't list are under the [MIT License](LICENSE). It doesn't cover:

- The game's content above: `assets/thumbs/`, `assets/*.json` except `assets/verified.json`, and the asset pack, which is also what `web-assets/` and the installers hold. It stays with the game's developers.
- `samples/`. The Workshop maps belong to their creators.
- `repos/`, vendored projects under their own licenses.

It gives no rights to the game, its name or its content.
