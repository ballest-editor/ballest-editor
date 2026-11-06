// Races a map from the Ballest map editor, or opens it in the in-game editor, when the editor asks. The editor saves
// the map into the game's maps folder, then writes play.json into this plugin's folder:
//     { "map": "Map_LevelEditorMain&<name>_<creator>.balledit", "nonce": <number>, "mode": "race" | "edit", "force": false }
// A nonce not seen before races that map (Tracks::OpenLocal, which reads the file again on every entry, so a second
// Play picks up the edits), or with mode "edit" opens it in the in-game editor (Together::OpenMap, the Create page's own
// way in, which reads the file too). That works from inside the in-game editor as well, where it replaces the map that
// is open: an "edit" of the map already open reloads it with the file's new version. The last nonce is kept in
// Storage: a play.json left from before a restart isn't acted on again. How an "edit" went is kept there too, as
// "edited": "<nonce> opened", or "<nonce> unsaved <map name>" when the in-game editor holds pieces moved, added or
// deleted since it opened its map and the request didn't say "force": the host can't say whether a map is saved, so
// this plugin keeps a snapshot of the pieces from when the map opened, and refuses to replace work it can see.

[Setting name="Check every" min=0.1 max=5 description="Seconds between looks at play.json"]
float CheckEvery = 0.5;

// Play can launch the game, so a request may arrive before the game can open maps: it's tried again for a while.
const double RETRY_FOR = 30;
const double RETRY_EVERY = 2;

bool watching = true;
double nextCheck = 0;
string lastNonce = "";          // the last request handled (raced or given up on)
string pendingNonce = "";       // a request not yet raced
string pendingMap = "";
bool pendingEdit = false;       // open it in the in-game editor, not race it
bool pendingForce = false;      // replace what the in-game editor holds even if it changed since it opened
double firstTry = -1;           // when the game was first asked to open it, -1 not yet
double nextTry = 0;
string lastNote = "";           // the last waiting or failure message logged, so each is logged once

// The pieces as they were when the in-game editor opened its map (taken SNAPSHOT_AFTER seconds in, once the level has
// spawned them): their ids and where each stands. A map whose pieces differ from this has work that may not be saved.
const double SNAPSHOT_AFTER = 2;
bool editorWasOpen = false;
double snapshotAt = -1;         // when to take the snapshot, -1 for none due
bool haveSnapshot = false;
array<int> snapshotIds;
array<string> snapshotPlaces;

void Main()
{
    lastNonce = Storage::Get("nonce", "");
    Log::Info("watching play.json" + (lastNonce == "" ? "" : " (last request " + lastNonce + ")"));
}

void OnDisabled()
{
    watching = false;
    Log::Info("stopped watching play.json");
}

void Update(float dt)
{
    if (!watching)
        return;
    double now = Host::Time();
    if (now >= nextCheck)
    {
        nextCheck = now + CheckEvery;
        WatchEditor(now);
        Check();
    }
    if (snapshotAt >= 0 && now >= snapshotAt)
        TakeSnapshot();
    if (pendingNonce != "" && now >= nextTry)
        TryOpen(now);
}

// A new request in play.json becomes the pending one, replacing any still waiting.
void Check()
{
    string text = Plugins::ReadFile("play.json");
    if (text == "" || !Json::Has(text, "nonce"))
        return;                 // no request, or one half written
    string nonce = Json::String(text, "nonce");
    if (nonce == "" || nonce == lastNonce || nonce == pendingNonce)
        return;
    string map = Json::String(text, "map");
    if (map == "")
    {
        Log::Warn("request " + nonce + " names no map");
        Handled(nonce);
        return;
    }
    Log::Info("request " + nonce + ": " + map);
    pendingNonce = nonce;
    pendingMap = map;
    pendingEdit = Json::String(text, "mode") == "edit";
    pendingForce = Json::Bool(text, "force", false);
    firstTry = -1;
    nextTry = 0;
    lastNote = "";
}

void TryOpen(double now)
{
    // No track list yet: the game is still starting and can't open maps.
    if (Tracks::Official().length() == 0)
    {
        Note("waiting for the game to be ready");
        nextTry = now + CheckEvery;
        return;
    }
    if (firstTry < 0)
        firstTry = now;
    if (pendingEdit)
    {
        TryEdit(now);
        return;
    }
    if (Tracks::OpenLocal(pendingMap))
    {
        Log::Info("racing " + pendingMap);
        Handled(pendingNonce);
        return;
    }
    string state = Tracks::OpenState();
    if (now - firstTry >= RETRY_FOR)
    {
        Log::Error("couldn't race " + pendingMap + ": " + state);
        Handled(pendingNonce);
        return;
    }
    Note("not raced yet, trying again: " + state);
    nextTry = now + RETRY_EVERY;
}

void TryEdit(double now)
{
    if (Editor::IsOpen() && !pendingForce && PiecesChanged())
    {
        Log::Warn("didn't replace the map open in the in-game editor with " + pendingMap + ": its pieces changed since it opened");
        Edited("unsaved " + Editor::MapName());
        return;
    }
    // By its full path, which only the game knows: under Proton it is a Windows path.
    string path = SavedMapPath(pendingMap);
    if (path != "" && Together::OpenMap(path))
    {
        Log::Info((Editor::IsOpen() ? "reloading the in-game editor with " : "editing ") + pendingMap);
        // The level is replaced: the snapshot is of the next map, once it has opened.
        editorWasOpen = false;
        haveSnapshot = false;
        snapshotAt = -1;
        Edited("opened");
        return;
    }
    if (now - firstTry >= RETRY_FOR)
    {
        Log::Error("couldn't open " + pendingMap + " in the in-game editor");
        Edited("failed");
        return;
    }
    Note("not opened yet, trying again");
    nextTry = now + RETRY_EVERY;
}

// Notices the in-game editor opening a map, by hand or through this plugin, and schedules its snapshot.
void WatchEditor(double now)
{
    bool open = Editor::IsOpen();
    if (open && !editorWasOpen)
    {
        haveSnapshot = false;
        snapshotAt = now + SNAPSHOT_AFTER;
    }
    else if (!open && editorWasOpen)
    {
        haveSnapshot = false;
        snapshotAt = -1;
    }
    editorWasOpen = open;
}

void TakeSnapshot()
{
    snapshotAt = -1;
    if (!Editor::IsOpen())
        return;
    array<int>@ ids = Editor::Pieces();
    snapshotIds.resize(0);
    snapshotPlaces.resize(0);
    for (uint i = 0; i < ids.length(); i++)
    {
        snapshotIds.insertLast(ids[i]);
        snapshotPlaces.insertLast(PlaceOf(ids[i]));
    }
    haveSnapshot = true;
}

// Where a piece stands, to the millimetre, the tenth of a degree and a thousandth of its scale: enough to tell an edit
// from a reading.
string PlaceOf(int id)
{
    double x, y, z, pitch, yaw, roll, sx, sy, sz;
    if (!Editor::GetLocation(id, x, y, z))
        return "gone";
    Editor::GetRotation(id, pitch, yaw, roll);
    Editor::GetScale(id, sx, sy, sz);
    return Round(x) + "," + Round(y) + "," + Round(z) + "|" + Round(pitch) + "," + Round(yaw) + "," + Round(roll)
        + "|" + Round(sx * 100) + "," + Round(sy * 100) + "," + Round(sz * 100);
}

string Round(double v)
{
    return "" + int(v * 10 + (v < 0 ? -0.5 : 0.5));
}

// Whether the pieces differ from the snapshot: one added, one gone, or one moved, turned or scaled. Without a snapshot
// (the map opened under two seconds ago) nothing can be told, and work that can't be seen is still work: changed.
bool PiecesChanged()
{
    if (!haveSnapshot)
        return true;
    array<int>@ ids = Editor::Pieces();
    if (ids.length() != snapshotIds.length())
        return true;
    for (uint i = 0; i < ids.length(); i++)
    {
        int at = snapshotIds.find(ids[i]);
        if (at < 0 || snapshotPlaces[at] != PlaceOf(ids[i]))
            return true;
    }
    return false;
}

// The full path of the saved map with this file name, "" if there is none.
string SavedMapPath(const string &in file)
{
    array<string>@ maps = Together::SavedMaps();
    for (uint i = 0; i < maps.length(); i++)
    {
        string path = maps[i];
        if (path.length() > file.length() && path.substr(path.length() - file.length()) == file)
            return path;
    }
    return "";
}

void Edited(const string &in outcome)
{
    Storage::Set("edited", pendingNonce + " " + outcome);
    Handled(pendingNonce);
}

void Handled(const string &in nonce)
{
    lastNonce = nonce;
    Storage::Set("nonce", nonce);
    pendingNonce = "";
}

void Note(const string &in message)
{
    if (message == lastNote)
        return;
    lastNote = message;
    Log::Info(message);
}
