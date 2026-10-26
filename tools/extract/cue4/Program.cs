// Ballest piece extractor (CUE4Parse). See tools/extract/README.md.
using CUE4Parse.Compression;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Serilog;

namespace BallestExtract;

// Collects CUE4Parse error log events (export deserialization failures are logged,
// not thrown) so modes can attach them to their output.
public sealed class ErrorCollector : Serilog.Core.ILogEventSink
{
    public string? Context;
    public readonly List<(string? Context, string Message)> Items = [];

    public void Emit(Serilog.Events.LogEvent e)
    {
        if (e.Level < Serilog.Events.LogEventLevel.Error) return;
        var msg = e.RenderMessage();
        for (var ex = e.Exception; ex != null; ex = ex.InnerException)
            msg += " | " + ex.GetType().Name + ": " + ex.Message.Split('\n')[0];
        lock (Items) Items.Add((Context, msg));
    }
}

public static partial class Program
{
    internal static readonly ErrorCollector Errors = new();

    static string? Opt(string[] args, string name)
    {
        var i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    static DefaultFileProvider OpenProvider(string[] args)
    {
        var paks = Opt(args, "--paks") ?? throw new ArgumentException("--paks <dir> required");
        var gameName = Opt(args, "--game") ?? "GAME_UE5_8";
        var game = Enum.Parse<EGame>(gameName);
        var oodle = Opt(args, "--oodle"); // path to liboodle-data-shared.so (downloaded if missing)
        OodleHelper.Initialize(oodle);

        var provider = new DefaultFileProvider(paks, SearchOption.TopDirectoryOnly, true, new VersionContainer(game));
        var usmap = Opt(args, "--usmap");
        if (usmap != null)
        {
            provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap);
            if (!args.Contains("--no-usmap-patch")) PatchMappings(provider);
        }
        provider.Initialize();
        provider.SubmitKey(new CUE4Parse.UE4.Objects.Core.Misc.FGuid(), new CUE4Parse.Encryption.Aes.FAesKey(new byte[32]));
        provider.PostMount();
        Console.Error.WriteLine($"[provider] {game}, {provider.Files.Count} files, mounted {provider.MountedVfs.Count} containers");
        return provider;
    }

    // The only .usmap we have is Fortnite's (newer engine branch than 5.8).
    // Properties that exist there but not in UE 5.8.0-release are dropped so the
    // unversioned property indices line up with the game's cooked data.
    // Verified against the 5.8.0-release headers (see README).
    static readonly (string Type, string Prop)[] NotInUe58 =
    [
        ("StaticMeshComponent", "bOverrideNavAreaClass"),
        ("StaticMeshComponent", "NavAreaClass"),
        ("MaterialInstance", "ToonProfileParameterValues"),
        ("Material", "bEnableNewHLSLGeneratorOverridden"),
        ("Material", "bMaterialTranslatorProfileOverridden"),
        ("Material", "MaterialTranslatorProfile"),
        ("MaterialCachedExpressionData", "ToonProfileValues"),
        ("BlueprintGeneratedClass", "bIsNativePropertyInitFastPathDisabled"),
    ];

    // Fixed-size array properties whose dimension differs (UE 5.8 value).
    // RuntimeEntries[NumMaterialRuntimeParameterTypes]: 10 in 5.8 (Materials/MaterialParameters.h), 11 in Fortnite.
    static readonly (string Type, string Prop, int Dim)[] ArrayDimUe58 =
    [
        ("MaterialCachedExpressionData", "RuntimeEntries", 10),
    ];

    // Properties UE 5.8 has but Fortnite's mapping lacks: (type, new name, copy type from, insert after).
    static readonly (string Type, string Prop, string TypeLike, string After)[] OnlyInUe58 =
    [
        ("EnhancedActionKeyMapping", "bShouldBeIgnored", "bHasAlwaysTickTrigger", "Key"),
    ];

    static void PatchMappings(DefaultFileProvider provider)
    {
        var types = provider.MappingsForGame?.Types;
        if (types == null) return;
        foreach (var (type, prop, dim) in ArrayDimUe58)
        {
            if (!types.TryGetValue(type, out var st)) continue;
            var list = st.Properties.OrderBy(kv => kv.Key).Select(kv => kv.Value).ToList();
            var elems = list.Where(p => p.Name == prop).ToList();
            if (elems.Count <= dim) continue;
            var removed = elems.Count - dim;
            list = list.Where(p => p.Name != prop || p.Index < dim).ToList();
            foreach (var p in list.Where(p => p.Name == prop)) p.ArraySize = dim;
            st.Properties.Clear();
            for (var i = 0; i < list.Count; i++) st.Properties[i] = list[i];
            st.PropertyCount -= removed;
            Console.Error.WriteLine($"[usmap] {type}: {prop}[{elems.Count}] -> [{dim}]");
        }
        foreach (var (type, prop, like, after) in OnlyInUe58)
        {
            if (!types.TryGetValue(type, out var st) || st.Properties.Values.Any(p => p.Name == prop)) continue;
            var list = st.Properties.OrderBy(kv => kv.Key).Select(kv => kv.Value).ToList();
            var template = list.FirstOrDefault(p => p.Name == like);
            var at = list.FindLastIndex(p => p.Name == after);
            if (template == null || at < 0) continue;
            var added = (CUE4Parse.MappingsProvider.PropertyInfo)template.Clone();
            added.Name = prop;
            added.Index = 0;
            list.Insert(at + 1, added);
            st.Properties.Clear();
            for (var i = 0; i < list.Count; i++) st.Properties[i] = list[i];
            st.PropertyCount += 1;
            Console.Error.WriteLine($"[usmap] {type}: added {prop}");
        }
        foreach (var group in NotInUe58.GroupBy(x => x.Type))
        {
            if (!types.TryGetValue(group.Key, out var st)) continue;
            var drop = group.Select(g => g.Prop).ToHashSet();
            // Keys are schema slots (array elements take one slot each). Own
            // properties come first; super properties are addressed past
            // PropertyCount, so shrinking it keeps the super chain aligned.
            var kept = st.Properties.OrderBy(kv => kv.Key).Select(kv => kv.Value)
                .Where(p => !drop.Contains(p.Name)).ToList();
            var removed = st.Properties.Count - kept.Count;
            if (removed == 0) continue;
            st.Properties.Clear();
            for (var i = 0; i < kept.Count; i++) st.Properties[i] = kept[i];
            st.PropertyCount -= removed;
            Console.Error.WriteLine($"[usmap] {group.Key}: dropped {string.Join(", ", drop)}");
        }
    }

    public static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.Error.WriteLine("usage: BallestExtract <list|probe|export> --paks DIR [...]");
            return 2;
        }
        Serilog.Log.Logger = new Serilog.LoggerConfiguration()
            .MinimumLevel.Is(args.Contains("--verbose") ? Serilog.Events.LogEventLevel.Debug : Serilog.Events.LogEventLevel.Warning)
            .WriteTo.Console(standardErrorFromLevel: Serilog.Events.LogEventLevel.Verbose)
            .WriteTo.Sink(Errors)
            .CreateLogger();
        CUE4Parse.CUE4ParseLog.UseLogger(Serilog.Log.Logger);
        var provider = OpenProvider(args);
        switch (args[0])
        {
            case "list":
            {
                var filter = Opt(args, "--filter") ?? "";
                foreach (var f in provider.Files.Keys.Where(k => k.Contains(filter, StringComparison.OrdinalIgnoreCase)).Order())
                    Console.WriteLine(f);
                return 0;
            }
            case "probe":
            {
                var path = args[^1];
                var pkg = provider.LoadPackage(path);
                Console.Error.WriteLine($"package flags: {pkg.Summary.PackageFlags}");
                var exports = pkg.GetExports().ToList();
                Console.WriteLine(JsonConvert.SerializeObject(exports, Formatting.Indented));
                return 0;
            }
            case "usmap-dump":
            {
                // Print the property layout a .usmap gives for one or more types.
                var types = provider.MappingsForGame?.Types ?? throw new ArgumentException("--usmap required");
                foreach (var name in args.SkipWhile(a => a != "--types").Skip(1).TakeWhile(a => !a.StartsWith("--")))
                {
                    if (!types.TryGetValue(name, out var st)) { Console.WriteLine($"{name}: missing"); continue; }
                    Console.WriteLine($"{name} : {st.SuperType} ({st.PropertyCount} props)");
                    foreach (var (i, p) in st.Properties.OrderBy(kv => kv.Key))
                        Console.WriteLine($"  {i,3} {p.Name} {p.MappingType.Type}{(p.ArraySize > 1 ? $"[{p.ArraySize}]" : "")}");
                }
                return 0;
            }
            default:
                return Run(args[0], args, provider);
        }
    }


}
