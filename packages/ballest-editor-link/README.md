# Ballest Editor link

A plugin for the [Ballest plugin manager](https://anythinggoes-ballest.github.io/ballest-plugin-manager/). When you press
**Play** in the Ballest Editor desktop app, it starts a race of the map you're
editing in _Ballest of Them All_: pre-race menu, countdown, checkpoints and finish, as if it were a published track.
Press Play again after an edit and the race restarts with the new version.

It needs plugin manager 0.26.0 or later. It doesn't use the network or the console.

## Install

The Ballest Editor desktop app ships this plugin and will install it for you (Game settings, or the prompt when you
press Play without it). Until then, copy `info.toml` and `main.as` from this folder into
`<game>/Ballest/Binaries/Win64/plugins/ballest-editor-link/` and start the game. The folder name matters: it's the
plugin's id, and the editor writes into that folder. The plugin manager picks up a folder copied in by hand the next
time the game starts.

## How it works

The editor's Play button does three things:

1. Saves the map into the game's maps folder (`%LOCALAPPDATA%\Ballest\Saved\UserSavedMaps`, or the Proton prefix's copy
   on Linux). The map must never have been published (`levelPublishedFileId` of -1).
2. Writes `play.json` into this plugin's folder.
3. Starts the game through Steam if it isn't running.

The plugin reads `play.json` twice a second (the **Check every** setting changes that). When it sees a nonce it hasn't
handled yet, it races the map with `Tracks::OpenLocal`. If the game is still starting up, it waits for the track list,
then keeps trying every 2 s for 30 s before it gives up and logs the reason.

The last nonce it handled is saved, so a `play.json` left over from your last session doesn't start a race when the
game starts again.

The editor writes only `play.json`, and only inside this plugin's folder. It never touches the rest of the game's
install.

## `play.json`

```json
{ "map": "Map_LevelEditorMain&My Track_spigelli.balledit", "nonce": 1730332800123 }
```

| Key     | Meaning                                                                                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `map`   | The map's file name in the game's maps folder. No folders. `Map_LevelEditorMain&` and `.balledit` can be left out, as `Tracks::OpenLocal` allows.                                            |
| `nonce` | A number or a string, different for every press of Play (the editor uses the time in milliseconds). Any value other than the last one handled starts a race, so it doesn't have to increase. |

Write the file in one go (write a temporary file next to it, then rename it over `play.json`). The plugin ignores a
file that isn't valid JSON yet and reads it again on its next check.

To try it without the editor, save a map in the game's own editor, then write `play.json` by hand with that map's file
name and any nonce. Change the nonce to race it again.

## Log

Everything the plugin does appears in the plugin manager's log: the request, `racing <map>` once the game accepts it,
or `couldn't race <map>: <reason>` with `Tracks::OpenState`'s explanation (for example, a map that has been published
has to be opened from the Workshop).
