# Projects, maps and exports

This page holds the project model: what the three nouns are, the files on disk, why the `.balledit` stays the source of truth, and the design still to come. Phases 1 to 3 below are built. [DESKTOP.md](DESKTOP.md) describes how the app behaves today, and [FORMAT.md](FORMAT.md) describes the game's file format, which none of this changes.

## The three nouns

| Noun    | What it is                                                                                                              | Where                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Project | A folder the user works in, holding any number of maps. Later a git repository.                                         | `Documents/Ballest Editor/<name>/` when the app makes it, or any folder the user opens.                       |
| Map     | A document in a project: the game's map. Later, editor-only data too.                                                   | `<project>/maps/<file name>.balledit`. Later a sidecar beside it (#112).                                      |
| Export  | The `.balledit` the game reads, a byte-for-byte copy of a map. Play is an export plus the handoff to the editor plugin. | The game's maps folder, the only target so far. A folder the user chooses is a later option (`exportTarget`). |

The link between a map and its export is specific to this machine and is never shared. It lives in `<project>/.ballest/`, which the project's `.gitignore` leaves out.

```
<project>/
  ballest-project.json         name, format version, export target
  maps/
    Map_LevelEditorMain&Big Loop_Isaac.balledit
    Map_LevelEditorMain&Big Loop_Isaac.editor.json    sidecar (#112), later, only once something needs it
  .ballest/
    link.json                  per map: origin, last export (path, hash, time), last seen game hash
    backups/                   previous versions of overwritten files (#137)
  .gitignore                   .ballest/
```

### The files

The code is in `apps/desktop/src/project/`. Main reads and writes only these, the game's maps folder, and a file the user picked to import. The page names maps by file name, never by path.

- **`ballest-project.json`** is indented JSON: `{ "formatVersion": 1, "name": "<folder name>", "exportTarget": "game" }`. Project settings can change `name` (`renameProject`), and the folder keeps its own name. `defaultCreator` is in the schema, but nothing writes or reads it. New maps take the creator from Settings › General, Steam, or the maps already in the game's maps folder (`domain/creator.ts`).
- **Making a project.** File › New project…, the first Save in Untitled Project, and naming the project in Project settings all call `Projects.createNew`, which makes the folder, `maps/`, `.ballest/`, `ballest-project.json` and a `.gitignore` of `.ballest/`. A folder chosen with Open project… gets whatever it lacks of these on the first write (`Projects.ensure`).
- **`.ballest/link.json`** is `{ "formatVersion": 1, "maps": { "<file name>": <link> } }`, where a link is `{ "origin", "export", "lastSeenHash" }`. `origin` and `export` are each null or `{ "path", "hash", "at" }`: the file's absolute path, the SHA-256 of its bytes (lowercase hex) and an ISO 8601 UTC time.
  - Import sets `origin`.
  - Export to game sets `export` and `lastSeenHash` to the bytes it wrote.
  - A map imported from the game's maps folder under its own name gets `export` and `lastSeenHash` equal to its `origin`, so it is linked from the start.
  - Rename moves the entry to the new file name.
  - Sync detection compares a game file's hash with `export.hash` and `lastSeenHash`, and keeps the hash it saw in `lastSeenHash`.
  - Re-import sets `export` and `lastSeenHash` to the game file it took.
  - An export found gone sets both to null, and `origin` stays.

  The `MapLinks` service owns the file: one update at a time, atomic writes, and a file that doesn't decode reads as empty.
- **`.ballest/backups/<time> <file name>`** holds the project's copy of a map before anything wrote over it, and the old file after a Rename. The game's copy before an export wrote over it goes to `<userData>/backups/` instead, since it belongs to this machine and not to the project. [DESKTOP.md § Backups](DESKTOP.md#backups) has the rules.

`desktop-settings.json` keeps the recent projects under `project.recent`, at most 8, the last one used first. An empty list means Untitled Project. A window has one project, kept in memory, so another running copy changing the list doesn't move it. A project opens in one window at a time. [DESKTOP.md § Other windows](DESKTOP.md#other-windows) has where a window starts and how windows know about each other.

A project is never the game's maps folder. The game loads only from `UserSavedMaps`, so a map must be exported to be played, and a project inside that folder would let the game edit project files behind the editor's back. Picking the maps folder, or a folder under it, as a project is refused with that explanation.

### Source of truth

**Through the public launch, the `.balledit` in the project is the map.** An export is a byte-for-byte copy plus a link record. Later, the sidecar adds what the format can't hold: hidden and locked pieces, layers, reference underlays, construction planes. The reasons:

- Round trips with the game lose nothing, because there is no converter to get wrong.
- Git diffs of a map are the game's own JSON, readable without the editor.
- In an emergency, the project file can be copied into `UserSavedMaps` by hand and the game opens it.
- #112's stable-key problem (sidecar entries surviving an in-game edit) is the same whether the sidecar is small or large, so a new container format gains nothing now.

**Later, when derived data exists** (generators #93, derived pieces #94, splines #91, shared bases #104), the sidecar carries the generating data, and the pieces it produces are marked as derived in the sidecar by stable key. The `.balledit` in the project stays the rendering, regenerated on save. That keeps the two files and the export path unchanged. For a derived piece the sidecar wins and the `.balledit` entry is output. If an in-game edit moves a derived piece, the piece becomes _detached_: the edit is kept, the generator no longer owns it, and the editor says so. There is no format switch and no migration of user projects.

## Why the flows look this way

The behaviour is in [DESKTOP.md § Renderer](DESKTOP.md#renderer). These are the decisions behind it.

- Save writes the map in the project, so the location needs no dialog and Save as is gone. Rename and Duplicate cover what it did.
- Open on an arbitrary file became Import, which copies it into the project. Nothing is edited in place outside a project. Importing from the game's maps folder links the map from the start, so Export knows where it goes and sync detection works.
- Export to game replaced Save to game. Export on save exists for people who alternate quickly between the editor and the in-game editor.
- New map's dialog keeps the read-only "Exports as `Map_LevelEditorMain&<name>_<creator>.balledit`" line, so the game's naming stays visible.

Later, the Project panel lists the maps in `UserSavedMaps` that aren't in the project yet, with an Import button each (#103's first slice).

## Sync: edits made out of band

The in-game editor can change an exported file at any time, and a save in the game rewrites the whole file, so an exported file rarely stays byte-identical. The link record makes this detectable: compare the game file's hash with the last export's hash, and with the last seen hash so that one change is reported once. [DESKTOP.md § Sync](DESKTOP.md#sync) describes what the app does with that.

Later:

- Re-import re-matches sidecar entries by stable key and reports the ones it can't match (#112).
- Re-import gets a diff (#105), and "merge" becomes possible for edits that don't overlap. Not before git.
- A third out-of-band case, the project file itself changing under the editor (git pull, another tool), reloads the map when it has no unsaved edits and reports the change otherwise. Deferred until git.

## Shell

[DESKTOP.md § Renderer](DESKTOP.md#renderer) describes the window as built: map tabs, the dock and its panels, the menus, Project settings, the Game link, the status bar and notifications. The shape, with the default layout:

```
┌ BE  File  Edit  View  Project            Season 3 tracks           Play  v ^ x ┐
├───────────────┬──────────────────────────────────────────────┬─────────────────┤
│ Project Pieces│ [Big Loop *] [Golf base] [Settings]          │ Inspector       │
│               │                                              │                 │
│               │               viewport                       │                 │
├───────────────┴──────────────────────────────────────────────┴─────────────────┤
│               Changed in game · Exported 4 min ago              update  bell 3 │
└────────────────────────────────────────────────────────────────────────────────┘
```

Everything between the top bar and the status bar is the dock ([DESKTOP.md § Dock](DESKTOP.md#dock)): the panels can be moved around the map tabs and the viewport, stacked, split, collapsed, closed from View, or popped out into windows of their own, and Settings is a panel beside the maps.

The wireframes in [mockups/](mockups/) are rough. Use [mockups/welcome.html](mockups/welcome.html) for the Welcome window and Project settings below. Its Project home tab and its Map and Game menus were dropped, and so were the Start page and Start tab in `start-page.html` and `start-tab.html`.

The rest of the design is still to come:

- **Welcome window** ([mockups/welcome.html](mockups/welcome.html) § 1). The app's level: recent projects with a thumbnail each, New project, Open…. It shows from the second launch on and when the last project window closes. The required chooser ([DESKTOP.md § Other windows](DESKTOP.md#other-windows)) has its list and its buttons, but only a window that can't start on a project of its own shows it. **This window / New window** ([mockups/welcome.html](mockups/welcome.html) § 2) is built, without the mockup's Always do this.
- **Close project** and **Save project…** in the File menu. Close project needs the Welcome window to go back to.
- **A Save project modal** with a folder choice, for the first Save. Today the Save map dialog asks the project's name and shows the folder it will make, read-only.
- **Project settings** ([mockups/welcome.html](mockups/welcome.html) § 5), IntelliJ's Project Structure shape, gains a creator, a choice of export target, and git.
- **Thumbnails.** An offscreen render of the map, written next to it on save, used by the Project panel and Welcome.
- **The Project panel** gains folders, sub-assemblies and the rest of what a project can hold, beyond its flat list of maps.

## Phases

The order settles where files live before anyone installs a release, because moving users' maps later is the one migration worth avoiding. Thumbnails, git, multi-map and diffs can follow at any time without touching saved projects.

| Phase | Milestone | State | Scope                                                                                                                                                                                                                    |
| ----- | --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | 0.2       | Built | Project folder and the save flow. New map saves at once in a project; Rename and Duplicate replace Save as; Import replaces Open; Export to game replaces Save to game; `link.json`; backups on overwrite; close prompt. |
| 2     | 0.2       | Built | Game link and notifications. Status bar, notification centre, Project panel, Game link checklist, creator from Steam, game not found, plugin manager and plugin install, Play.                                           |
| 3     | 0.2       | Built | Sync. Change detection on launch, focus and after Play; the Export confirm; Re-import; link states in the status bar and the Project panel.                                                                              |
| 4     | 0.3       | Open  | Public launch. No new flow work.                                                                                                                                                                                         |
| 5     | 0.4       | Open  | Editor-only data. The sidecar (#112) with stable keys and re-matching on Re-import; hide, lock, layers (#81, #111); Map settings (#142).                                                                                 |
| 6     | 0.5       | Open  | Projects proper. Thumbnails in the Project panel and Welcome; the maps folder and Workshop browser (#103); the rest of #143; git history and diff (#105); multi-map with shared bases (#104).                            |
| 7     | later     | Open  | Derived data. Generators, derived pieces and splines make the sidecar authoritative for the pieces they own; detached pieces.                                                                                            |

What stays out of the public launch on purpose: a separate project-manager window in the Godot style, git, thumbnails in the Project panel, the Workshop browser, multi-map, and any merge. Phases 1 to 3 are small on disk (a folder, one JSON file, a hash) and large in how the app reads; that is the trade.
