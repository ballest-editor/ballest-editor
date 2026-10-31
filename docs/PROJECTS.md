# Projects, maps and exports

Status: long-term design, written 2026-10-31. Phase 1 and 2 are milestone 0.2 work; the rest is
sequenced below. [DESKTOP.md](DESKTOP.md) describes the shell this runs in; [FORMAT.md](FORMAT.md) the
game's file format, which none of this changes.

## The three nouns

Today the app has one noun, a file, and two verbs that both mean "write the game format" (Save, Save
to game). That is why #132 has six open questions. The editor adopts three nouns instead:

| Noun        | What it is                                                                                     | Where                                                               |
| ----------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Project** | A folder the user works in. Later a git repository. Holds any number of maps.                  | `Documents/Ballest Editor/<project>/` by default; any folder.       |
| **Map**     | A document in a project: the game's map plus editor-only data.                                 | `<project>/maps/<file name>.balledit` and its sidecar (#112).       |
| **Export**  | The `.balledit` the game reads, written from a map. Play is an export plus the plugin handoff. | The game's `UserSavedMaps` (default), or a folder the user chooses. |

The link between a map and its export, which is machine-specific and never shared, lives in
`<project>/.ballest/` (gitignored once the project is a repository).

```
<project>/
  ballest-project.json         name, format version, default creator, export target
  maps/
    Map_LevelEditorMain&Big Loop_Isaac.balledit
    Map_LevelEditorMain&Big Loop_Isaac.editor.json    sidecar (#112), only once something needs it
  .ballest/
    link.json                  per map: origin, last export (path, hash, time), last seen game hash
    backups/                   previous versions of overwritten files (#137)
  .gitignore                   .ballest/
```

A project is never the game's maps folder. The game loads only from `UserSavedMaps`, so a map must be
exported to be played, and a project inside that folder would make the game edit project files
behind the editor's back. Picking the maps folder (or a folder under it) as a project is refused
with that explanation.

### Source of truth

**Now and through the public launch: the `.balledit` in the project is the map.** The sidecar adds
what the format can't hold (hidden and locked pieces, layers, reference underlays, construction
planes). An export is a byte-for-byte copy plus a link record. Reasons:

- Round trips with the game are lossless by construction; there is no converter to get wrong.
- Git diffs of a map are the game's own JSON, readable without the editor.
- In an emergency the project file can be copied into `UserSavedMaps` by hand and the game opens it.
- #112's stable-key problem (sidecar entries surviving an in-game edit) is the same problem whether
  the sidecar is small or large, so nothing is gained by a new container format now.

**Later, when derived data exists** (generators #93, derived pieces #94, splines #91, shared bases
#104), the sidecar carries the generating data and the pieces it produces are marked as derived in
the sidecar, by stable key. The `.balledit` in the project stays the rendering, regenerated on save.
That keeps the two files and the export path unchanged; what changes is that for a derived piece the
sidecar wins and the `.balledit` entry is output. If an in-game edit moves a derived piece, the piece
becomes _detached_ (the edit is kept, the generator no longer owns it) and the editor says so. No
format switch, no migration of user projects.

The browser review build has no project. It stays a one-map scratchpad: Open is the file input,
Export is a download, nothing else applies.

## User flows

### Create

New map asks for the name (creator prefilled from Steam, #133) and saves the map into the project at
once. There is no untitled state and no "where" dialog. The dialog keeps the read-only "Exports as
`Map_LevelEditorMain&<name>_<creator>.balledit`" line so the game's naming stays visible. The first
New map or Import creates the default project lazily; most users never see a project dialog.

### Save, rename, duplicate

Save (Ctrl+S) writes the map in the project and asks nothing. Save as is gone: **Rename** changes the
name or creator and moves the file to match (the old file goes to backups), **Duplicate** copies the
map under a new name. A "Choose location…" escape hatch is not needed: the location is the project.

### Import

Open… on an arbitrary `.balledit` or `.ballmap` (Downloads, the Workshop cache, the maps folder)
becomes **Import**. It copies the file into the project and records its origin in `link.json`. A map
imported from `UserSavedMaps` is linked to that file from the start, so Export knows where it goes
and sync detection works. Nothing is edited in place outside a project. Importing a file whose name
clashes with an existing map asks: replace (backing up), or import as a copy.

Later, the Start tab lists the maps in `UserSavedMaps` that aren't in the project yet, with an Import
button each (#103's first slice).

### Export and Play

**Export to game** (replacing Save to game) writes the map into the maps folder under the game's file
name and records the exported bytes' hash and time in `link.json`. **Play** is Export then the plugin
handoff (#66). The replace-published prompt (`ReplacePublishedDialog`) stays on this path. A per-map
setting **Export on save** (off by default) makes Save export too, for people who alternate between
the editor and the in-game editor quickly.

### Sync: edits made out of band

The in-game editor can change an exported file at any time, and the game rewrites `editorState` on
every save, so an exported file rarely stays byte-identical. The link record makes this detectable:
compare the game file's hash with the last export's hash (and the last seen hash, so one change is
reported once).

| When                            | What happens                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch, window focus, Play ends | Every linked map is checked. A changed export becomes a notification: "Big Loop was changed in the game" with **Re-import** and **Ignore**. The status bar shows the state. |
| Export                          | If the export changed since the last export, a dialog: **Back up and overwrite** (#137), **Re-import first**, **Cancel**.                                                   |
| Re-import                       | Replaces the project map with the game's version (the project map goes to backups). Sidecar entries are re-matched by stable key; unmatched ones are reported (#112).       |
| Export deleted in the game      | The link is dropped and the map shows **Not exported**; the next Export writes it again.                                                                                    |

Later, Re-import gets a diff (#105) and "merge" becomes possible for non-overlapping edits. Not
before git.

Link states, shown in the status bar and on the Start tab: **Not exported**, **In sync**, **Edited
since export**, **Changed in game**, **Both changed**, **Published draft** (the export has a
`levelPublishedFileId`).

A third out-of-band case, the project file itself changing under the editor (git pull, another
tool), is reloaded when the open map has no unsaved edits and reported otherwise. Deferred until git.

## Shell

Document tabs (one per open map), a Start tab when nothing is open, and a status bar. The status bar
is where state that used to be a toast lives:

```
┌ BE  File  Edit  View  Map  Game                   Big Loop *            v ^ x ┐
├───┬───────────┬──────────────────────────────────────────────┬────────────────┤
│ ▣ │ Pieces    │ [Start] [Big Loop *] [Golf base]             │ Inspector      │
│ ▤ │           │                                              │                │
│   │           │               viewport                 [cube]│                │
├───┴───────────┴──────────────────────────────────────────────┴────────────────┤
│ Maps · main    ⟳ Exported 4 min ago · changed in game  [Export] [Play] │ 1.2.0 🔔3 │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Left:** the project (later its branch).
- **Centre:** the open map's link state; click for a popover with the export path, last export time,
  Export, Play, Re-import, Reveal.
- **Right:** the update pill (#136) and the notification bell.

**Notifications.** Every toast is also a notification. The toast auto-dismisses; the bell keeps the
last 100 across restarts (`<userData>/notifications.json`), with their actions still live (Reveal,
Re-import, Choose folder…). Persistent ones (game not found, plugin manager missing) pin to the top
until resolved and resolve themselves when the cause goes away. "Don't show again" is per
notification kind, in `desktop-settings.json`.

**Start tab.** Opens when no map tab is open, and from View. Project-centric, which is what separates
it from an IDE's welcome page:

```
┌ Start ─────────────────────────────────────────────────────────────┐
│ Maps in this project                                 [New map]     │
│  ┌──────┐ Big Loop        ⟳ changed in game    edited 2 h ago      │
│  │ thumb│ Golf base       ✓ in sync             edited yesterday   │
│  └──────┘ Spiral test     · not exported        edited 3 d ago     │
│                                                                    │
│ In the game, not imported                            [Import…]     │
│   Hairpin_Isaac.balledit        published · 412 items              │
│   Test3_Isaac.balledit          210 items                          │
│                                                                    │
│ Game link   ✓ game  ✓ maps  ✓ creator Isaac  ✗ plugin manager ▸    │
└────────────────────────────────────────────────────────────────────┘
```

**Game link** replaces the three startup toasts of #133, #134 and #135 with one checklist, inline on
the Start tab on first run and collapsed to one row afterwards: the install, the maps folder, the
creator (from Steam, editable), the plugin manager and the `ballest-editor-link` plugin (#118). A
missing item carries its fix (Choose folder…, Install docs, Install plugin). Nothing toasts on first
run because this is already in front of the user; later launches notify only when a result changes.

**Settings tiers.** _Settings_ (the app: keybinds, camera, appearance, game folders), _Project
settings_ (name, folder, default creator, export target; later git), _Map settings_ (what today's
"Project settings…" edits: level data, difficulty, tags, grid height, Export on save). A **Map** menu
holds Rename, Duplicate, Map settings, Export to game and Re-import; **Game** keeps Launch, Play and
Install plugin.

## Phases

The order is chosen so that where files live is settled before anyone installs a release: moving
users' maps later is the one migration worth avoiding. Thumbnails, git, multi-map and diffs can
follow at any time without touching saved projects.

| Phase | Milestone | Scope                                                                                                                                                                                                                                                                                      |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | 0.2       | **Project folder and the save flow.** Default project created lazily; New map saves at once; Rename and Duplicate replace Save as; Import replaces Open; Export to game replaces Save to game; `link.json`; backups on overwrite; close prompt. Menus and dialog copy use the three nouns. |
| 2     | 0.2       | **Game link and notifications.** Status bar; notification centre; Start tab as a plain list (no thumbnails); Game link checklist; creator from Steam; game not found; plugin manager and plugin install; Play.                                                                             |
| 3     | 0.2       | **Sync.** Change detection on launch, focus and after Play; the Export confirm; Re-import; link states in the status bar and Start tab.                                                                                                                                                    |
| 4     | 0.3       | **Public launch**, as planned. No new flow work; docs describe the three nouns.                                                                                                                                                                                                            |
| 5     | 0.4 (new) | **Editor-only data.** The sidecar (#112) with stable keys and re-matching on Re-import; hide, lock, layers (#81, #111); Map settings tier.                                                                                                                                                 |
| 6     | 0.5 (new) | **Projects proper.** Start tab with thumbnails; maps folder and Workshop browser (#103); New and Open project; Project settings tier; git history and diff (#105); multi-map with shared bases (#104).                                                                                     |
| 7     | later     | **Derived data.** Generators, derived pieces and splines make the sidecar authoritative for the pieces they own; detached pieces.                                                                                                                                                          |

What stays out of the public launch on purpose: a separate project-manager window (Godot style), git,
thumbnails on the Start tab, the Workshop browser, multi-map, any merge. Phase 1 to 3 are small on
disk (a folder, one JSON file, a hash) and large in how the app reads; that is the trade.

### Issues to reshape

| Issue                                           | Change                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| #132 save to a default folder                   | Rewrite as phase 1: the project folder, New saves at once, Rename and Duplicate, Import, Export to game. Its "decide first" list is answered above. |
| #137 back up before overwriting                 | Keep; backups go under `<project>/.ballest/backups/` for project files and `<userData>/backups/` for exports. Recover lives in the Map menu.        |
| #70 close prompt                                | Keep as is.                                                                                                                                         |
| #133 creator from Steam                         | Keep the discovery; the UI is a Game link row, not a Settings-only field. Done: `useCreator()` is what the row shows (DESKTOP.md § Game paths).     |
| #142 map settings, #143 new and open project    | New, phases 5 and 6; #21's dialog becomes Map settings.                                                                                             |
| #136 restyle the update pill                    | Keep; the pill moves to the status bar.                                                                                                             |
| #118 install the plugin, #66 Play               | Keep; Play exports first and records the link. Install plugin is a Game link row.                                                                   |
| #140 status bar, notifications, Start tab       | New, phase 2.                                                                                                                                       |
| #134 game link checklist                        | #135 merged into it; the Game link checklist on the Start tab plus notifications when a result changes. Phase 2.                                    |
| #141 sync detection, Export confirm, Re-import  | New, phase 3.                                                                                                                                       |
| #112 sidecar                                    | Move to 0.4; add "re-match on Re-import" to its scope.                                                                                              |
| #81, #111 hide, lock, layers                    | Move to 0.4.                                                                                                                                        |
| #103 Workshop browser, #104 multi-map, #105 git | Move to 0.5; #103 gains "the maps folder list on the Start tab" as its first slice.                                                                 |
