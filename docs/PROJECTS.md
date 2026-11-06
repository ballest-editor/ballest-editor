# Projects, maps and exports

This page holds the project model: what the three nouns are, the files on disk, which file is the source of truth for what, and the design still to come. Phases 1 to 3 below are built. [DESKTOP.md](DESKTOP.md) describes how the app behaves today, and [FORMAT.md](FORMAT.md) describes the game's file format, which none of this changes.

## The three nouns

| Noun    | What it is                                                                                                              | Where                                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Project | A folder the user works in, holding any number of maps. Later a git repository.                                         | `Documents/Ballest Editor/<name>/` when the app makes it, or any folder the user opens or picks at first Save. |
| Map     | A document in a project: the game's map and the editor-only data beside it.                                             | `<project>/maps/<file name>.balledit`, and its sidecar `<project>/maps/<file name>.editor.json`.               |
| Export  | The `.balledit` the game reads, a byte-for-byte copy of a map. Play is an export plus the handoff to the editor plugin. | The game's maps folder, the only target so far. A folder the user chooses is a later option (`exportTarget`).  |

The link between a map and its export is specific to this machine and is never shared. It lives in `<project>/.ballest/`, which the project's `.gitignore` leaves out.

```
<project>/
  ballest-project.json         name, format version, export target
  maps/
    Map_LevelEditorMain&Big Loop_Isaac.balledit
    Map_LevelEditorMain&Big Loop_Isaac.editor.json    its sidecar: what the game's format can't hold
  prefabs/
    Bridge.json                the project's prefabs, in the game's format
  .ballest/
    link.json                  per map: origin, last export (path, hash, time), last seen game hash
    backups/                   previous versions of overwritten files (#137)
    thumbnails/                the Project panel's renders of the maps, by file hash
  .gitignore                   .ballest/
```

### The files

The code is in `apps/desktop/src/project/`. Main reads and writes only these, the game's maps folder and prefabs folder, and a file the user picked to import. The page names maps by file name, never by path.

- **`ballest-project.json`** is indented JSON: `{ "formatVersion": 1, "name": "<name>", "exportTarget": "game" }`. `name` starts as the folder's name, or as what the first Save's dialog was given. Project settings can change it (`renameProject`), and the folder keeps its own name. `defaultCreator` is in the schema, but nothing writes or reads it. New maps take the creator from Settings › General, Steam, or the maps already in the game's maps folder (`domain/creator.ts`).
- **Making a project.** File › New project…, the first Save in Untitled Project, and naming the project in Project settings all call `Projects.createNew`, which makes the folder, `maps/`, `.ballest/`, `ballest-project.json` and a `.gitignore` of `.ballest/`. The folder is `<projectsFolder>/<name>`, or the one the first Save's Choose… picked (main takes no other path from the page). A folder chosen with Open project… gets whatever it lacks of these on the first write (`Projects.ensure`).
- **`maps/<file name>.editor.json`** is the map's sidecar, indented JSON that the game never reads. It sits beside the `.balledit` and is shared with the project. `domain/MapSidecar.ts` holds its schema:

  ```json
  {
    "formatVersion": 1,
    "mapHash": "<SHA-256 of the .balledit it was written for>",
    "items": {
      "<key>": {
        "index": 3,
        "fingerprint": "BP_Prim_Cube|100,200,8615|0,0,0,1|1,1,1",
        "name": "Left ramp",
        "tags": ["start"]
      }
    },
    "tree": [
      { "kind": "item", "key": "<key>" },
      { "kind": "group", "id": "<id>", "name": "Bridge", "tags": [], "children": [] },
      {
        "kind": "group",
        "id": "<id>",
        "name": "Arch",
        "tags": [],
        "children": [],
        "prefab": { "tier": "user", "name": "Arch", "hash": "<SHA-256>", "items": ["<signature>"] }
      }
    ]
  }
  ```

  - A **key** is 12 random URL-safe characters that an item gets when it enters the document (placed, pasted, duplicated, imported). It is the item's one identity in the editor: the store's `ids`, the selection and the sidecar all use it. A group's `id` is made the same way, and keys and ids share one space.
  - `items` has an entry per item. `index` is its place in `map.items`. `fingerprint` is its class and transform, rounded to 0.01 cm and four places for rotation and scale, with a quaternion and its negative written alike. `name` and `tags` are optional, and tags are free strings. Groups have tags too.
  - `tree` holds every item in exactly one place, and groups nest to any depth. A group left empty by an edit goes with it, as the game's do.
  - `prefab` makes a group an instance of a prefab ([DESKTOP.md § Prefabs](DESKTOP.md#prefabs)). `tier` and `name` say which, and `hash` is the SHA-256 of its file when the instance was placed or last updated. `items` has a signature per item the definition held then, in its frame and document order: class, transform and a digest of the rest (`signatureOf`, `domain/prefabInstance.ts`). It is what tells an unedited instance once the file has moved on. Copying an instance copies its link.
  - **Loading** (`loadStructure`, `domain/sidecar.ts`). A `mapHash` equal to the `.balledit`'s hash means `index` is right. Otherwise something rewrote the file, and each entry looks for its item by fingerprint: the same class and transform first, in document order, then the same class and the nearest transform within 1 cm and 0.01 on any rotation or scale component. Items left over get fresh keys and join the root. Entries left over are dropped, and their count is reported (`sidecarUnmatched`). The re-matched sidecar is written back at once, so the loss is reported once and the old file goes to the backups. A hash that matches but indices that can't be right (past the items, or two on one item) re-match the same way.
  - A map with no sidecar loads with fresh keys, a flat tree, and one tree group per game group ([FORMAT.md § Groups](FORMAT.md#groups-editorstategroups)). It gets a sidecar on its first Save. A sidecar that doesn't decode leaves the map on its own and says so (`sidecarUnreadable`); the next Save replaces the file, and the old one goes to the backups.
  - **Saving** writes the `.balledit`, then the sidecar with the `.balledit`'s new hash, each atomically. A crash between the two leaves a sidecar that re-matches on the next open.
  - The sidecar goes where the map goes. Rename moves it, Duplicate writes one for the copy, and Import replacing a map sends the old one to the backups. Export and Play copy only the `.balledit`. Project settings editing a map that isn't open leaves its sidecar a version behind, and it re-matches without loss on the next open.
- **`prefabs/<name>.json`** is a project prefab, byte for byte the game's format ([FORMAT.md § Prefab file](FORMAT.md#prefab-file)). The folder is made by the first one, and it isn't exported: a map holds an instance's items as plain items.
- **`.ballest/link.json`** is `{ "formatVersion": 1, "maps": { "<file name>": <link> } }`, where a link is `{ "origin", "export", "lastSeenHash" }`. `origin` and `export` are each null or `{ "path", "hash", "at" }`: the file's absolute path, the SHA-256 of its bytes (lowercase hex) and an ISO 8601 UTC time.
  - Import sets `origin`.
  - Export to game sets `export` and `lastSeenHash` to the bytes it wrote.
  - A map imported from the game's maps folder under its own name gets `export` and `lastSeenHash` equal to its `origin`, so it is linked from the start.
  - Rename moves the entry to the new file name.
  - Sync detection compares a game file's hash with `export.hash` and `lastSeenHash`, and keeps the hash it saw in `lastSeenHash`.
  - Re-import sets `export` and `lastSeenHash` to the game file it took.
  - An export found gone sets both to null, and `origin` stays.

  The `MapLinks` service owns the file: one update at a time, atomic writes, and a file that doesn't decode reads as empty.
- **`.ballest/thumbnails/<SHA-256 of the map's file>.png`** is the map's tile in the Project panel, 64px square, rendered by the page after a Save ([DESKTOP.md § Project panel](DESKTOP.md#project-panel)). Main refuses one for bytes no map has any more, which a slow render can be by the time it is done, and each write drops the ones no map has. It's a cache: deleting the folder costs only the tiles until each map's next Save.
- **`.ballest/backups/<time> <file name>`** holds the project's copy of a map, sidecar or prefab before anything wrote over it, and the old file after a Rename. The game's copy before an export wrote over it goes to `<userData>/backups/` instead, since it belongs to this machine and not to the project. [DESKTOP.md § Backups](DESKTOP.md#backups) has the rules.

`desktop-settings.json` keeps the recent projects under `project.recent`, at most 8, the last one used first. An empty list means Untitled Project. A window has one project, kept in memory, so another running copy changing the list doesn't move it. A project opens in one window at a time. [DESKTOP.md § Other windows](DESKTOP.md#other-windows) has where a window starts and how windows know about each other.

A project is never the game's maps folder. The game loads only from `UserSavedMaps`, so a map must be exported to be played, and a project inside that folder would let the game edit project files behind the editor's back. Picking the maps folder, or a folder under it, as a project is refused with that explanation.

### Source of truth

**The `.balledit` in the project is the source of truth for the pieces, and the sidecar for the structure:** the groups, each item's and group's name and tags, and which groups are prefab instances. An export is a byte-for-byte copy of the `.balledit` plus a link record. Save regenerates the `.balledit`'s `editorState.groups` from the sidecar's tree, so the game sees what it can hold of the structure ([FORMAT.md § Groups](FORMAT.md#groups-editorstategroups)). A change to the game's groups never reaches the tree of a map that has a sidecar. Later, the sidecar also holds hidden and locked pieces, layers, reference underlays and construction planes. The reasons:

- Round trips with the game lose nothing, because there is no converter to get wrong.
- Git diffs of a map are the game's own JSON, readable without the editor.
- In an emergency, the project file can be copied into `UserSavedMaps` by hand and the game opens it.
- Stable keys have to survive an in-game edit however much the sidecar holds, so a new container format gains nothing now.
- 0.4.1 deletes `editorState` on an in-game save ([qa/save-roundtrip.md](qa/save-roundtrip.md)). The structure survives that because it doesn't depend on the game keeping it.

**Later, when derived data exists** (generators #93, derived pieces #94, splines #91, shared bases #104), the sidecar carries the generating data, and the pieces it produces are marked as derived in the sidecar by stable key. The `.balledit` in the project stays the rendering, regenerated on save. That keeps the two files and the export path unchanged. For a derived piece the sidecar wins and the `.balledit` entry is output. If an in-game edit moves a derived piece, the piece becomes _detached_: the edit is kept, the generator no longer owns it, and the editor says so. There is no format switch and no migration of user projects.

## Why the flows look this way

The behaviour is in [DESKTOP.md § Renderer](DESKTOP.md#renderer). These are the decisions behind it.

- Save writes the map in the project, so the location needs no dialog and Save as is gone. Rename and Duplicate cover what it did.
- Open on an arbitrary file became Import, which copies it into the project. Nothing is edited in place outside a project. Importing from the game's maps folder links the map from the start, so Export knows where it goes and sync detection works.
- Export to game replaced Save to game. Export on save exists for people who alternate quickly between the editor and the in-game editor.
- The Save, Rename and Duplicate dialogs ask only the map's name. The game's file name and the creator aren't the user's question there: the creator lives in Settings › General, and the rule on names shows only once a name breaks it.
- New map always adds a tab and asks nothing, as a new document does in any desktop app. A name up front had a cost: in an untitled window the second New map named the first map instead of adding one to flip through. So a map is named on its first Save.
- The first Save in an untitled window makes the project, in one dialog with the map's name and the project's name, its folder shown by name with Change…. A project is only needed once something is written, and with one dialog Cancel leaves nothing on disk. The other tabs keep their own first Saves, because naming a map is that map's question.
- A project opens in this window, and where it opens is asked only while this window has unsaved changes. Asking every time put a question in front of every switch, for an answer that is nearly always the same. A second window is a deliberate act instead: Shift+click on a recent project, or Open in new window on its start screen row. Always do this stops the question for good. The required chooser doesn't ask, because its window has nothing else to be.
- Leaving an untitled window never prompts about unsaved changes, because nothing is lost: its maps go with it ([DESKTOP.md § Window](DESKTOP.md#window)).

Later, the Project panel lists the maps in `UserSavedMaps` that aren't in the project yet, with an Import button each (#103's first slice).

## Sync: edits made out of band

The in-game editor can change an exported file at any time, and a save in the game rewrites the whole file, so an exported file rarely stays byte-identical. The link record makes this detectable: compare the game file's hash with the last export's hash, and with the last seen hash so that one change is reported once. [DESKTOP.md § Sync](DESKTOP.md#sync) describes what the app does with that. Re-import loads the game's version the way any changed file loads, so sidecar entries of unchanged pieces survive it and the rest are reported (§ The files).

Later:

- Re-import gets a diff (#105), and "merge" becomes possible for edits that don't overlap. Not before git.
- A third out-of-band case, the project file itself changing under the editor (git pull, another tool), reloads the map when it has no unsaved edits and reports the change otherwise. Deferred until git.

## Shell

[DESKTOP.md § Renderer](DESKTOP.md#renderer) describes the window as built: map tabs, the dock and its panels, the menus, Project settings, the Game link, the status bar and notifications. The shape, with the default layout:

```
┌ BE  File  Edit  View  Project            Season 3 tracks           Play  v ^ x ┐
├───────────────┬──────────────────────────────────────────────┬─────────────────┤
│ Project Pieces│ [Big Loop *] [Golf base]                     │ Inspector       │
│               │                                              │                 │
│               │               viewport                       │                 │
├───────────────┴──────────────────────────────────────────────┴─────────────────┤
│               Changed since export · exported 4 min ago         update  bell 3 │
└────────────────────────────────────────────────────────────────────────────────┘
```

Everything between the top bar and the status bar is the dock ([DESKTOP.md § Dock](DESKTOP.md#dock)): the panels can be moved around the map tabs and the viewport, stacked, split, collapsed, closed from View, or popped out into windows of their own.

The wireframes in [mockups/](mockups/) are rough. Use [mockups/welcome.html](mockups/welcome.html) for the Welcome window and Project settings below. Its Project home tab and its Map and Game menus were dropped, and so were the Start page and Start tab in `start-page.html` and `start-tab.html`.

The rest of the design is still to come:

- **Welcome window** ([mockups/welcome.html](mockups/welcome.html) § 1). The app's level: recent projects with a thumbnail each, New project, Open…. It shows from the second launch on and when the last project window closes. The required chooser ([DESKTOP.md § Other windows](DESKTOP.md#other-windows)) is that screen without the thumbnails, but only a window that can't start on a project of its own shows it. **This window / New window** ([mockups/welcome.html](mockups/welcome.html) § 2) is built.
- **Close project** and **Save project…** in the File menu. Close project needs the Welcome window to go back to.
- **Project settings** ([mockups/welcome.html](mockups/welcome.html) § 5), IntelliJ's Project Structure shape, gains a creator, a choice of export target, and git.
- **Thumbnails.** An offscreen render of the map, written next to it on save, used by the Project panel and Welcome.
- **The Project panel** gains folders, sub-assemblies and the rest of what a project can hold, beyond its flat list of maps.

## Phases

The order settles where files live before anyone installs a release, because moving users' maps later is the one migration worth avoiding. Thumbnails, git, multi-map and diffs can follow at any time without touching saved projects.

| Phase | Milestone | State | Scope                                                                                                                                                                                                                       |
| ----- | --------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | 0.2       | Built | Project folder and the save flow. Save names a new map into the project; Rename and Duplicate replace Save as; Import replaces Open; Export to game replaces Save to game; `link.json`; backups on overwrite; close prompt. |
| 2     | 0.2       | Built | Game link and notifications. Status bar, notification centre, Project panel, Game link checklist, creator from Steam, game not found, plugin manager and plugin install, Play.                                              |
| 3     | 0.2       | Built | Sync. Change detection on launch, focus and after Play; the Export confirm; Re-import; link states in the status bar and the Project panel.                                                                                 |
| 4     | 0.3       | Open  | Public launch. No new flow work.                                                                                                                                                                                            |
| 5     | 0.4       | Open  | Editor-only data. The sidecar (#112) with stable keys and re-matching on Re-import; hide, lock, layers (#81, #111); Map settings (#142).                                                                                    |
| 6     | 0.5       | Open  | Projects proper. Thumbnails in the Project panel and Welcome; the maps folder and Workshop browser (#103); the rest of #143; git history and diff (#105); multi-map with shared bases (#104).                               |
| 7     | later     | Open  | Derived data. Generators, derived pieces and splines make the sidecar authoritative for the pieces they own; detached pieces.                                                                                               |

What stays out of the public launch on purpose: a separate project-manager window in the Godot style, git, the Workshop browser, multi-map, and any merge. Phases 1 to 3 are small on disk (a folder, one JSON file, a hash) and large in how the app reads; that is the trade.
