// Modes:
//   export  --meshes FILE [--include-dir DIR]... --out DIR --report FILE
//           Each line of FILE is a UE object path (/Game/X/SM_Y.SM_Y). Writes one
//           .glb per mesh to DIR/<path without /Game/>.glb and a JSON report.
//   classes --classes FILE --report FILE
//           Each line of FILE is a BlueprintGeneratedClass object path
//           (/Game/X/BP_Y.BP_Y_C). Resolves the SimpleConstructionScript +
//           InheritableComponentHandler overrides of the class and its BP parents
//           and reports every StaticMeshComponent (mesh, materials, transform).
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.Engine;
using CUE4Parse.UE4.Objects.UObject;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace BallestExtract;

public static partial class Program
{
    internal static int Run(string mode, string[] args, DefaultFileProvider provider) => mode switch
    {
        "export" => ExportMeshes(args, provider),
        "classes" => ResolveClasses(args, provider),
        "dump" => DumpPackages(args, provider),
        "materials" => ExportMaterials(args, provider),
        "imports" => DumpImports(args, provider),
        "textures" => ExportTextures(args, provider),
        "locres" => DumpLocres(args, provider),
        _ => Usage(mode),
    };

    static int Usage(string mode)
    {
        Console.Error.WriteLine($"unknown mode {mode}");
        return 2;
    }

    static IEnumerable<string> ReadLines(string file) =>
        File.ReadAllLines(file).Select(l => l.Trim()).Where(l => l.Length > 0 && !l.StartsWith('#'));

    static string? PathOf(FPackageIndex? idx) =>
        idx == null || idx.IsNull ? null : idx.ResolvedObject?.GetPathName();

    static JArray Vec(FVector v) => new(R(v.X), R(v.Y), R(v.Z));
    static double R(double d) => Math.Round(d, 4);

    // ---------------------------------------------------------------- dump
    // dump --prefix DIR [--prefix DIR]... [--file PATH]... --out FILE
    // Every package under each prefix -> its exports as CUE4Parse JSON; each --file
    // (loose file in the .pak, e.g. Ballest/Config/DefaultInput.ini) -> its text.
    // A package that fails to load is recorded as { "error": "..." }.
    static int DumpPackages(string[] args, DefaultFileProvider provider)
    {
        var outPath = Opt(args, "--out") ?? throw new ArgumentException("--out required");
        var packages = new JObject();
        var files = new JObject();
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--prefix")
            {
                var single = args[i + 1].TrimEnd('/') + ".uasset"; // a package path also works
                var prefix = args[i + 1].TrimEnd('/') + "/";
                foreach (var f in provider.Files.Keys.Where(k => (k.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || k.Equals(single, StringComparison.OrdinalIgnoreCase)) && k.EndsWith(".uasset")).Order())
                {
                    var pkgPath = f[..^".uasset".Length];
                    Errors.Context = pkgPath;
                    try
                    {
                        var exports = provider.LoadPackage(f).GetExports().ToList();
                        packages[pkgPath] = JToken.FromObject(exports, JsonSerializer.Create(new JsonSerializerSettings { ReferenceLoopHandling = ReferenceLoopHandling.Ignore }));
                    }
                    catch (Exception e)
                    {
                        packages[pkgPath] = new JObject { ["error"] = $"{e.GetType().Name}: {e.Message}" };
                    }
                }
            }
            else if (args[i] == "--file")
            {
                var path = args[i + 1];
                files[path] = provider.TrySaveAsset(path, out var data)
                    ? System.Text.Encoding.UTF8.GetString(data).TrimStart('\uFEFF')
                    : null;
            }
        }
        var errors = new JArray(Errors.Items.Select(e => new JObject { ["package"] = e.Context, ["message"] = e.Message }));
        File.WriteAllText(outPath, new JObject { ["packages"] = packages, ["files"] = files, ["errors"] = errors }.ToString(Formatting.Indented));
        Console.Error.WriteLine($"[dump] {packages.Count} packages, {files.Count} files");
        return 0;
    }

    // ---------------------------------------------------------------- meshes

    static int ExportMeshes(string[] args, DefaultFileProvider provider)
    {
        var outDir = Opt(args, "--out") ?? throw new ArgumentException("--out required");
        var reportPath = Opt(args, "--report") ?? throw new ArgumentException("--report required");
        var paths = new List<string>();
        var meshesFile = Opt(args, "--meshes");
        if (meshesFile != null) paths.AddRange(ReadLines(meshesFile));

        // --include-dir Ballest/Content/Maps/_GENERATED/PC : every package directly in that dir.
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i] != "--include-dir") continue;
            var dir = args[i + 1].TrimEnd('/') + "/";
            foreach (var f in provider.Files.Keys.Where(k => k.StartsWith(dir, StringComparison.OrdinalIgnoreCase)
                                                             && k.EndsWith(".uasset") && !k[dir.Length..].Contains('/')))
            {
                var rel = f["Ballest/Content/".Length..^".uasset".Length];
                var name = rel[(rel.LastIndexOf('/') + 1)..];
                paths.Add($"/Game/{rel}.{name}");
            }
        }

        var report = new JArray();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int ok = 0, failed = 0, skipped = 0;
        foreach (var path in paths)
        {
            if (!seen.Add(path)) continue;
            var entry = new JObject { ["meshAssetPath"] = path };
            try
            {
                var obj = provider.LoadPackageObject(path);
                if (obj is not UStaticMesh mesh)
                {
                    entry["skipped"] = $"not a StaticMesh ({obj.ExportType})";
                    skipped++;
                    report.Add(entry);
                    continue;
                }
                var rel = GlbRelPath(path);
                var file = Path.Combine(outDir, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(file)!);
                var info = Glb.WriteStaticMesh(mesh, path, file);
                entry["glb"] = rel;
                foreach (var p in info) entry[p.Key] = p.Value;
                ok++;
            }
            catch (Exception e)
            {
                entry["error"] = $"{e.GetType().Name}: {e.Message}";
                failed++;
                Console.Error.WriteLine($"[export] {path}: {e.GetType().Name}: {e.Message}");
            }
            report.Add(entry);
        }
        File.WriteAllText(reportPath, report.ToString(Formatting.Indented));
        Console.Error.WriteLine($"[export] ok={ok} failed={failed} skipped(non-mesh)={skipped}");
        return 0;
    }

    static string GlbRelPath(string objectPath)
    {
        var pkg = objectPath.Split('.')[0];
        if (pkg.StartsWith("/Game/")) pkg = pkg["/Game/".Length..];
        else pkg = "_" + pkg.TrimStart('/'); // /Engine/BasicShapes/Sphere -> _Engine/BasicShapes/Sphere
        return pkg + ".glb";
    }

    // ---------------------------------------------------------------- classes

    sealed record Node(string Name, UObject? Template, string? ComponentClass, string? ParentName, string OwnerClass);

    static int ResolveClasses(string[] args, DefaultFileProvider provider)
    {
        var classesFile = Opt(args, "--classes") ?? throw new ArgumentException("--classes required");
        var reportPath = Opt(args, "--report") ?? throw new ArgumentException("--report required");
        var report = new JArray();
        foreach (var classPath in ReadLines(classesFile))
        {
            var entry = new JObject { ["classPath"] = classPath };
            try { ResolveClass(provider, classPath, entry); }
            catch (Exception e)
            {
                entry["error"] = $"{e.GetType().Name}: {e.Message}";
                Console.Error.WriteLine($"[classes] {classPath}: {e.GetType().Name}: {e.Message}");
            }
            report.Add(entry);
        }
        File.WriteAllText(reportPath, report.ToString(Formatting.Indented));
        return 0;
    }

    static void ResolveClass(DefaultFileProvider provider, string classPath, JObject entry)
    {
        // Class chain, most-derived first. Stops at the first native (/Script) class.
        var chain = new List<UBlueprintGeneratedClass>();
        var cls = provider.LoadPackageObject(classPath) as UBlueprintGeneratedClass
                  ?? throw new InvalidDataException("not a BlueprintGeneratedClass");
        string? native = null;
        while (cls != null)
        {
            chain.Add(cls);
            // UObject.Super comes from the export map; the BPGC's own tagged
            // properties are not reliable with a foreign .usmap (see README).
            var super = cls.Super;
            if (super == null) break;
            var superPath = super.GetPathName();
            if (superPath.StartsWith("/Script/")) { native = superPath; break; }
            cls = super.Load() as UBlueprintGeneratedClass;
            if (cls == null) { native = superPath; break; }
        }
        entry["blueprintChain"] = new JArray(chain.Select(c => c.GetPathName()));
        entry["nativeParent"] = native;

        // SCS nodes from every class in the chain (base classes first).
        var nodes = new Dictionary<string, Node>();
        var order = new List<string>();
        foreach (var c in Enumerable.Reverse(chain))
        {
            // All SCS_Node exports of the class's package (one BP class per package).
            var exports = c.Owner?.GetExports().ToList() ?? [];
            var loaded = exports.Where(e => e.ExportType == "SCS_Node").ToList();
            var parentOf = new Dictionary<string, string>();
            foreach (var n in loaded)
            foreach (var ch in n.GetOrDefault<FPackageIndex[]>("ChildNodes", []))
                if (ch.Load<UObject>() is { } cn)
                    parentOf[cn.GetOrDefault<FName>("InternalVariableName").Text] = n.GetOrDefault<FName>("InternalVariableName").Text;
            foreach (var n in loaded)
            {
                var name = n.GetOrDefault<FName>("InternalVariableName").Text;
                var parent = parentOf.GetValueOrDefault(name);
                if (parent == null)
                {
                    var p = n.GetOrDefault<FName>("ParentComponentOrVariableName").Text;
                    if (!string.IsNullOrEmpty(p) && p != "None") parent = p;
                }
                if (nodes.ContainsKey(name)) continue;
                nodes[name] = new Node(name, n.GetOrDefault<FPackageIndex>("ComponentTemplate")?.Load<UObject>(),
                    PathOf(n.GetOrDefault<FPackageIndex>("ComponentClass")), parent, c.GetPathName());
                order.Add(name);
            }
        }

        // ICH overrides: the most-derived class wins (its template's archetype chain
        // points back at the parent's template, which Lookup() follows).
        var overrides = new Dictionary<string, UObject>();
        foreach (var c in chain)
        {
            var ich = c.Owner?.GetExports().FirstOrDefault(e => e.ExportType == "InheritableComponentHandler");
            if (ich == null) continue;
            foreach (var rec in ich.GetOrDefault<FStructFallback[]>("Records", []))
            {
                var key = rec.GetOrDefault<FStructFallback>("ComponentKey");
                var varName = key?.GetOrDefault<FName>("SCSVariableName").Text;
                var tmpl = rec.GetOrDefault<FPackageIndex>("ComponentTemplate")?.Load<UObject>();
                if (varName == null || tmpl == null) continue;
                overrides.TryAdd(varName, tmpl);
            }
        }

        UObject? TemplateOf(string name) =>
            overrides.TryGetValue(name, out var o) ? o : nodes.TryGetValue(name, out var n) ? n.Template : null;

        // Root = first root node of the top-most BP class (its own relative transform
        // is replaced by the actor transform at spawn, so it is not applied).
        var root = order.FirstOrDefault(n => nodes[n].ParentName == null);

        (FVector T, FQuat Q, FVector S) WorldOf(string name, int depth = 0)
        {
            if (name == root || depth > 32 || TemplateOf(name) is not { } t)
                return (FVector.ZeroVector, FQuat.Identity, FVector.OneVector);
            var lt = Lookup(t, "RelativeLocation", FVector.ZeroVector);
            var lr = Lookup(t, "RelativeRotation", new FRotator(0, 0, 0)).Quaternion();
            var ls = Lookup(t, "RelativeScale3D", FVector.OneVector);
            var parent = nodes.TryGetValue(name, out var nd) ? nd.ParentName : null;
            if (parent == null || !nodes.ContainsKey(parent)) return (lt, lr, ls);
            var (pt, pq, ps) = WorldOf(parent, depth + 1);
            var t2 = pq.RotateVector(new FVector(lt.X * ps.X, lt.Y * ps.Y, lt.Z * ps.Z)) + pt;
            return (t2, pq * lr, new FVector(ls.X * ps.X, ls.Y * ps.Y, ls.Z * ps.Z));
        }

        // The map file's itemTransform is the world transform of the "Main"
        // component (see README), so also express every component relative to Main.
        var (mt, mq, ms) = nodes.ContainsKey("Main") ? WorldOf("Main") : (FVector.ZeroVector, FQuat.Identity, FVector.OneVector);
        var mqInv = new FQuat(-mq.X, -mq.Y, -mq.Z, mq.W);
        static float Div(float a, float b) => Math.Abs(b) < 1e-8f ? 0f : a / b;

        var comps = new JArray();
        foreach (var name in order)
        {
            var t = TemplateOf(name);
            if (t == null) continue;
            var meshIdx = Lookup<FPackageIndex?>(t, "StaticMesh", null);
            var isMeshComp = (nodes[name].ComponentClass ?? "").Contains("StaticMeshComponent") || meshIdx != null;
            if (!isMeshComp) continue;
            var (wt, wq, ws) = WorldOf(name);
            var rel = Lookup(t, "RelativeRotation", new FRotator(0, 0, 0));
            comps.Add(new JObject
            {
                ["name"] = name,
                ["componentClass"] = nodes[name].ComponentClass,
                ["definedIn"] = nodes[name].OwnerClass,
                ["overriddenInChild"] = overrides.ContainsKey(name),
                ["parent"] = nodes[name].ParentName,
                ["staticMesh"] = PathOf(meshIdx),
                ["overrideMaterials"] = new JArray(Lookup<FPackageIndex?[]>(t, "OverrideMaterials", []).Select(PathOf)),
                ["visible"] = Lookup(t, "bVisible", true),
                ["hiddenInGame"] = Lookup(t, "bHiddenInGame", false),
                ["relative"] = new JObject
                {
                    ["location"] = Vec(Lookup(t, "RelativeLocation", FVector.ZeroVector)),
                    ["rotation"] = new JObject { ["pitch"] = R(rel.Pitch), ["yaw"] = R(rel.Yaw), ["roll"] = R(rel.Roll) },
                    ["scale"] = Vec(Lookup(t, "RelativeScale3D", FVector.OneVector)),
                },
                ["actorSpace"] = new JObject
                {
                    ["location"] = Vec(wt),
                    ["quat"] = new JArray(R(wq.X), R(wq.Y), R(wq.Z), R(wq.W)),
                    ["scale"] = Vec(ws),
                },
                ["mainSpace"] = MainSpace(),
            });

            JObject MainSpace()
            {
                var d = mqInv.RotateVector(wt - mt);
                var q = mqInv * wq;
                return new JObject
                {
                    ["location"] = Vec(new FVector(Div(d.X, ms.X), Div(d.Y, ms.Y), Div(d.Z, ms.Z))),
                    ["quat"] = new JArray(R(q.X), R(q.Y), R(q.Z), R(q.W)),
                    ["scale"] = Vec(new FVector(Div(ws.X, ms.X), Div(ws.Y, ms.Y), Div(ws.Z, ms.Z))),
                };
            }
        }
        entry["rootComponent"] = root;
        entry["meshComponents"] = comps;
    }

    // Property lookup that follows the archetype (Template) chain.
    static T Lookup<T>(UObject obj, string name, T fallback)
    {
        for (var o = obj; o != null; o = o.Template?.Load() as UObject)
        {
            if (o.Properties.Any(p => p.Name.Text == name) && o.TryGetValue(out T v, name)) return v;
            if (o.Template == null) break;
        }
        return fallback;
    }
}
