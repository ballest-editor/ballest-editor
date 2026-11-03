// The game driver's plugin (tools/driver, docs/DRIVER.md): what the host's test channel has no command for, through
// the script API. The driver writes command.json into this plugin's folder:
//     { "nonce": "<unique>", "op": "spawn", ... }
// A nonce not seen before is run once, and answered with one log line the driver reads from host.log:
//     reply <nonce> <json>
// Ops: spawn {classes[], transforms[9 per piece], drop}, pieces, select {ids[]}, transform {id, x, y, z, pitch, yaw,
// roll}, camera {x, y, z, pitch, yaw, fov}, camera_release, hide_editor {on}, undo, redo, project {x, y, z}, ping.

[Setting name="Check every" min=0.05 max=5 description="Seconds between looks at command.json"]
float CheckEvery = 0.2;

bool watching = true;
double nextCheck = 0;
string lastNonce = "";

void Main()
{
    lastNonce = Storage::Get("nonce", "");
    Log::Info("watching command.json");
}

void OnDisabled()
{
    watching = false;
}

void Update(float dt)
{
    if (!watching)
        return;
    double now = Host::Time();
    if (now < nextCheck)
        return;
    nextCheck = now + CheckEvery;
    string text = Plugins::ReadFile("command.json");
    if (text == "" || !Json::Has(text, "nonce"))
        return;
    string nonce = Json::String(text, "nonce");
    if (nonce == "" || nonce == lastNonce)
        return;
    lastNonce = nonce;
    Storage::Set("nonce", nonce);
    string reply = Run(text);
    Log::Info("reply " + nonce + " " + reply);
}

string Run(const string &in c)
{
    string op = Json::String(c, "op");
    if (op == "ping")
        return "{\"ok\":true,\"editor\":" + (Editor::IsOpen() ? "true" : "false") + "}";
    if (op == "camera")
    {
        if (!Camera::IsTaken() && !Camera::Take())
            return Error("another plugin has the camera");
        bool ok = Camera::Set(Json::Number(c, "x"), Json::Number(c, "y"), Json::Number(c, "z"),
                              Json::Number(c, "pitch"), Json::Number(c, "yaw"), Json::Number(c, "fov", 90));
        return Ok(ok);
    }
    if (op == "camera_release")
    {
        Camera::Release();
        return Ok(true);
    }
    if (op == "hide_editor")
    {
        Hud::HideEditor(Json::Bool(c, "on", true));
        return Ok(true);
    }
    if (op == "project")
    {
        float sx, sy;
        bool on = Camera::Project(Json::Number(c, "x"), Json::Number(c, "y"), Json::Number(c, "z"), sx, sy);
        return "{\"ok\":" + (on ? "true" : "false") + ",\"x\":" + sx + ",\"y\":" + sy + "}";
    }
    if (!Editor::IsOpen())
        return Error("the track editor isn't open");
    if (op == "pieces")
        return Pieces(Editor::Pieces());
    if (op == "undo")
        return Ok(Editor::Undo());
    if (op == "redo")
        return Ok(Editor::Redo());
    if (op == "select")
    {
        Editor::Select(Ints(c, "ids"));
        return Ok(true);
    }
    if (op == "spawn")
    {
        array<string> classes;
        for (int i = 0; i < Json::Count(c, "classes"); i++)
            classes.insertLast(Json::String(c, "classes." + i));
        array<double> transforms;
        for (int i = 0; i < Json::Count(c, "transforms"); i++)
            transforms.insertLast(Json::Number(c, "transforms." + i));
        if (classes.length() == 0 || transforms.length() != classes.length() * 9)
            return Error("spawn needs classes and nine transform numbers per class");
        array<int>@ made = Editor::SpawnPieces(classes, transforms, Json::Bool(c, "drop", false));
        return Pieces(made);
    }
    if (op == "transform")
    {
        int id = int(Json::Number(c, "id", -1));
        bool moved = true;
        if (Json::Has(c, "x"))
            moved = Editor::SetLocation(id, Json::Number(c, "x"), Json::Number(c, "y"), Json::Number(c, "z"));
        bool turned = true;
        if (Json::Has(c, "pitch"))
            turned = Editor::SetRotation(id, Json::Number(c, "pitch"), Json::Number(c, "yaw"), Json::Number(c, "roll"));
        if (!moved || !turned)
            return Error("no piece " + id);
        array<int> one = {id};
        return Pieces(one);
    }
    return Error("unknown op " + op);
}

array<int> Ints(const string &in c, const string &in key)
{
    array<int> ids;
    for (int i = 0; i < Json::Count(c, key); i++)
        ids.insertLast(int(Json::Number(c, key + "." + i)));
    return ids;
}

string Ok(bool ok)
{
    return ok ? "{\"ok\":true}" : "{\"ok\":false}";
}

string Error(const string &in message)
{
    return "{\"ok\":false,\"error\":" + Json::Quote(message) + "}";
}

// The pieces as JSON: id, class, location, rotation (degrees) and scale.
string Pieces(const array<int>@ ids)
{
    string json = "{\"ok\":true,\"pieces\":[";
    for (uint i = 0; i < ids.length(); i++)
    {
        double x, y, z, pitch, yaw, roll, sx, sy, sz;
        if (!Editor::GetLocation(ids[i], x, y, z))
            continue;
        Editor::GetRotation(ids[i], pitch, yaw, roll);
        Editor::GetScale(ids[i], sx, sy, sz);
        if (i > 0)
            json += ",";
        json += "{\"id\":" + ids[i] + ",\"class\":" + Json::Quote(Editor::PieceClass(ids[i]))
            + ",\"location\":[" + x + "," + y + "," + z + "]"
            + ",\"rotation\":[" + pitch + "," + yaw + "," + roll + "]"
            + ",\"scale\":[" + sx + "," + sy + "," + sz + "]}";
    }
    return json + "]}";
}
