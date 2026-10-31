# Notice

ballest-editor is an independent map editor for [Ballest of Them All](https://store.steampowered.com/app/3339810). _Ballest of Them All_, its name, and all of its content belong to the game's developers.

## Game content in this repository

- `assets/thumbs/` holds the game's content-browser icons. They are redistributed with the developers' permission.
- `assets/*.json` (the piece catalog, item registry, materials, keybinds and UI strings) is data `tools/extract/` reads from the game's files so that maps made in the editor load in the game.
- Piece meshes and textures extracted from the game are not in this repository. They are published as a release asset (`assets-<hash>` tags), which builds download and bundle into the editor.

## Sample maps

`samples/Workshop/` holds maps that players published on the Steam Workshop. They are kept as test fixtures for the map format. Their creators' names have been replaced with `creator01`, `creator02`, and so on. `samples/UserSavedMaps/` holds the maintainer's own drafts.

## License

The code doesn't have an open-source license yet. One will be chosen before the public launch; until then, all rights are reserved.
