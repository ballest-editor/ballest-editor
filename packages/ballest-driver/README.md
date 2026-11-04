# Ballest Driver plugin

A plugin for the [Ballest plugin manager](https://anythinggoes-ballest.github.io/ballest-plugin-manager/) that
`tools/driver` installs into its sandboxed copies of the game, never into a player's game. It does what the host's
test channel has no command for, through the script API: `Editor::SpawnPieces`, `SetLocation`, `SetRotation`,
`Select`, `Selection`, `Undo`, `Redo`, `Camera::Set`, `Camera::Project`, `Hud::HideEditor`.

The driver writes `command.json` into the plugin's folder (each slot has a plugins folder of its own, so a command
reaches one copy):

```json
{
  "nonce": "1730650000123-7",
  "op": "spawn",
  "classes": ["/Game/.../BP_Track_Short1.BP_Track_Short1_C"],
  "transforms": [0, 0, 1000, 0, 90, 0, 1, 1, 1],
  "drop": false
}
```

A nonce not seen before is run once (the last one is kept in Storage, so a file left from an earlier session does
nothing), and answered with one line in `host.log`, `reply <nonce> <json>`, which the driver reads. `main.as` lists
the ops. It uses no `Console::Run`.

`pnpm build` stages `info.toml` and `main.as` into `dist/ballest-driver/`, which `pnpm driver setup` copies into the
game copy's plugins folder.
