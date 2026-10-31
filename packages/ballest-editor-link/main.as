// Races a map from the Ballest map editor when the editor asks. The editor's Play saves the map into the game's maps
// folder, then writes play.json into this plugin's folder:
//     { "map": "Map_LevelEditorMain&<name>_<creator>.balledit", "nonce": <number> }
// A nonce not seen before races that map (Tracks::OpenLocal, which reads the file again on every entry, so a second
// Play picks up the edits). The last nonce is kept in Storage: a play.json left from before a restart isn't raced
// again.

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
double firstTry = -1;           // when the game was first asked to open it, -1 not yet
double nextTry = 0;
string lastNote = "";           // the last waiting or failure message logged, so each is logged once

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
        Check();
    }
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
