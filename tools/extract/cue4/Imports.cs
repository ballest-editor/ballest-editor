// imports [--prefix DIR]... [--props PKG]... --out FILE
// Header-level dependency dump that works without any property mappings: for
// every package under the prefixes, its import table (resolved object paths and
// classes), the packages it imports, its exports (name/class/super), and every
// name-map entry that looks like an object path (soft references such as
// TSoftClassPtr/FSoftObjectPath live in the name map, not the import table).
// --props PKG additionally dumps that package's exports as JSON (best effort).
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets;
using CUE4Parse.UE4.Objects.UObject;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace BallestExtract;

public static partial class Program
{
    // locres --file Ballest/Content/Localization/Game/en/Game.locres --out FILE
    // Dumps a .locres as { namespace: { key: text } }.
    internal static int DumpLocres(string[] args, DefaultFileProvider provider)
    {
        var file = Opt(args, "--file") ?? throw new ArgumentException("--file required");
        var outPath = Opt(args, "--out") ?? throw new ArgumentException("--out required");
        var res = new CUE4Parse.UE4.Localization.FTextLocalizationResource(provider.CreateReader(file));
        var o = new JObject();
        var n = 0;
        foreach (var (ns, entries) in res.Entries.OrderBy(e => e.Key.Str))
        {
            var j = new JObject();
            foreach (var (k, v) in entries.OrderBy(e => e.Key.Str)) { j[k.Str] = v.LocalizedString; n++; }
            o[ns.Str ?? ""] = j;
        }
        File.WriteAllText(outPath, o.ToString(Formatting.Indented));
        Console.Error.WriteLine($"[locres] {n} strings in {o.Count} namespaces");
        return 0;
    }

    internal static int DumpImports(string[] args, DefaultFileProvider provider)
    {
        var outPath = Opt(args, "--out") ?? throw new ArgumentException("--out required");
        var props = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var prefixes = new List<string>();
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--prefix") prefixes.Add(args[i + 1].TrimEnd('/') + "/");
            if (args[i] == "--props") props.Add(args[i + 1]);
        }
        var files = provider.Files.Keys
            .Where(k => (k.EndsWith(".uasset") || k.EndsWith(".umap")) &&
                        (prefixes.Any(p => k.StartsWith(p, StringComparison.OrdinalIgnoreCase)) || props.Contains(k[..k.LastIndexOf('.')])))
            .Order().ToList();
        var result = new JObject();
        foreach (var f in files)
        {
            var pkgPath = f[..f.LastIndexOf('.')];
            var entry = new JObject();
            result[pkgPath] = entry;
            Errors.Context = pkgPath;
            var before = Errors.Items.Count;
            try
            {
                var pkg = provider.LoadPackage(f);
                if (pkg is IoPackage io)
                {
                    entry["imports"] = new JArray(io.ImportMap.Select(ix => io.ResolveObjectIndex(ix))
                        .Where(r => r != null)
                        .Select(r => new JObject { ["path"] = r!.GetPathName(), ["class"] = r.Class?.Name.Text }));
                    entry["importedPackages"] = new JArray(io.ImportedPackages.Value.Where(p => p != null).Select(p => p!.Name).Distinct());
                }
                entry["exports"] = new JArray(pkg.ExportsLazy.Select((_, idx) => new FPackageIndex(pkg, idx + 1).ResolvedObject)
                    .Where(r => r != null)
                    .Select(r => new JObject { ["name"] = r!.Name.Text, ["class"] = r.Class?.Name.Text, ["super"] = r.Super?.GetPathName() }));
                entry["namePaths"] = new JArray(pkg.NameMap.Select(n => n.Name).Where(n => n != null && n.StartsWith('/') && n.Length > 1).Distinct().Order());
                if (props.Contains(pkgPath))
                    entry["properties"] = JToken.FromObject(pkg.GetExports().ToList(), Json);
            }
            catch (Exception e)
            {
                entry["error"] = $"{e.GetType().Name}: {e.Message}";
            }
            var errs = Errors.Items.Skip(before).Select(e => e.Message).ToList();
            if (errs.Count > 0) entry["parseErrors"] = new JArray(errs);
        }
        File.WriteAllText(outPath, result.ToString(Formatting.Indented));
        Console.Error.WriteLine($"[imports] {result.Count} packages");
        return 0;
    }
}
