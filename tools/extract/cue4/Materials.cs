// materials --list FILE --out FILE --tex-dir DIR [--tex-max 2048]
// Loads every material (instance) object path in FILE, follows Parent links to the
// root UMaterial, and writes each involved export as CUE4Parse JSON (merged and
// interpreted later by build-materials.mjs). Every Texture referenced by those
// exports is decoded (managed AssetRipper BCn decoder, no SkiaSharp natives) and
// written as PNG (largest mip <= --tex-max) to DIR/<path without /Game/>.png.
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse_Conversion.Textures;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace BallestExtract;

public static partial class Program
{
    static readonly JsonSerializer Json = JsonSerializer.Create(new JsonSerializerSettings { ReferenceLoopHandling = ReferenceLoopHandling.Ignore });

    // {"ObjectName": "Class'Name'", "ObjectPath": "/Game/Pkg.3"} -> "/Game/Pkg.Name"
    static string? RefPath(JToken? r)
    {
        if (r is not JObject o || o["ObjectName"]?.ToString() is not { } on || o["ObjectPath"]?.ToString() is not { } op) return null;
        var name = on.Split('\'').ElementAtOrDefault(1)?.Split(':').Last();
        var pkg = op.Contains('.') ? op[..op.LastIndexOf('.')] : op;
        return name == null ? null : $"{pkg}.{name}";
    }

    internal static int ExportMaterials(string[] args, DefaultFileProvider provider)
    {
        var list = Opt(args, "--list") ?? throw new ArgumentException("--list required");
        var outPath = Opt(args, "--out") ?? throw new ArgumentException("--out required");
        var texDir = Opt(args, "--tex-dir") ?? throw new ArgumentException("--tex-dir required");
        var texMax = int.Parse(Opt(args, "--tex-max") ?? "2048");
        TextureDecoder.UseAssetRipperTextureDecoder = true;

        // [CoreRedirects] +PackageRedirects from DefaultEngine.ini (old map files still
        // reference e.g. /Game/Art/Materials/Masters/M_BaseSurface_Metal).
        var redirects = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (provider.TrySaveAsset("Ballest/Config/DefaultEngine.ini", out var ini))
            foreach (System.Text.RegularExpressions.Match m in System.Text.RegularExpressions.Regex.Matches(
                         System.Text.Encoding.UTF8.GetString(ini), @"\+PackageRedirects=\(OldName=""([^""]+)"",NewName=""([^""]+)""\)"))
                redirects[m.Groups[1].Value] = m.Groups[2].Value;
        string Redirect(string objPath)
        {
            var pkg = objPath.Split('.')[0];
            return redirects.TryGetValue(pkg, out var np) ? np + objPath[pkg.Length..] : objPath;
        }

        var materials = new JObject();
        var textures = new JObject();
        var queue = new Queue<string>(ReadLines(list));
        var texQueue = new List<string>();
        while (queue.Count > 0)
        {
            var path = queue.Dequeue();
            if (materials.ContainsKey(path)) continue;
            Errors.Context = path;
            var before = Errors.Items.Count;
            try
            {
                var target = Redirect(path);
                var obj = provider.LoadPackageObject(target);
                var tok = JToken.FromObject(obj, Json);
                var entry = new JObject { ["export"] = tok };
                if (target != path) entry["redirectedTo"] = target;
                var errs = Errors.Items.Skip(before).Select(e => e.Message).ToList();
                if (errs.Count > 0) entry["errors"] = new JArray(errs);
                materials[path] = entry;
                if (RefPath(tok["Properties"]?["Parent"]) is { } parent) queue.Enqueue(parent);
                foreach (var r in tok.SelectTokens("$..ObjectName").Select(t => t.Parent!.Parent))
                    if (r?["ObjectName"]?.ToString().StartsWith("Texture") == true && RefPath(r) is { } tp && !texQueue.Contains(tp))
                        texQueue.Add(tp);
            }
            catch (Exception e)
            {
                materials[path] = new JObject { ["error"] = $"{e.GetType().Name}: {e.Message}" };
            }
        }

        foreach (var tp in texQueue) textures[tp] = ExportTexture(provider, tp, texDir, texMax, flat: false);

        File.WriteAllText(outPath, new JObject { ["materials"] = materials, ["textures"] = textures }.ToString(Formatting.Indented));
        Console.Error.WriteLine($"[materials] {materials.Count} material assets, {textures.Count} textures ({textures.Properties().Count(p => p.Value["png"] != null)} decoded)");
        return 0;
    }

    // textures --list FILE --tex-dir DIR [--tex-max N] [--flat] --out FILE
    // Decode each texture object path in FILE to PNG. --flat names files by asset
    // name only (DIR/<Name>.png) instead of mirroring the UE path.
    internal static int ExportTextures(string[] args, DefaultFileProvider provider)
    {
        var list = Opt(args, "--list") ?? throw new ArgumentException("--list required");
        var outPath = Opt(args, "--out") ?? throw new ArgumentException("--out required");
        var texDir = Opt(args, "--tex-dir") ?? throw new ArgumentException("--tex-dir required");
        var texMax = int.Parse(Opt(args, "--tex-max") ?? "2048");
        TextureDecoder.UseAssetRipperTextureDecoder = true;
        var result = new JObject();
        foreach (var tp in ReadLines(list).Distinct())
            result[tp] = ExportTexture(provider, tp, texDir, texMax, args.Contains("--flat"));
        File.WriteAllText(outPath, result.ToString(Formatting.Indented));
        Console.Error.WriteLine($"[textures] {result.Count} textures ({result.Properties().Count(p => p.Value["png"] != null)} decoded)");
        return 0;
    }

    static JObject ExportTexture(DefaultFileProvider provider, string tp, string texDir, int texMax, bool flat)
    {
        var info = new JObject();
        try
        {
            var tex = provider.LoadPackageObject(tp) as UTexture ?? throw new InvalidDataException("not a UTexture");
            info["class"] = tex.ExportType;
            info["compression"] = tex.CompressionSettings.ToString();
            info["sRGB"] = tex.SRGB;
            info["format"] = tex.Format.ToString();
            var decoded = tex.Decode(texMax) ?? throw new InvalidDataException("decode returned null");
            var pkg = tp.Split('.')[0];
            var rel = flat ? pkg[(pkg.LastIndexOf('/') + 1)..] + ".png"
                : (pkg.StartsWith("/Game/") ? pkg["/Game/".Length..] : "_" + pkg.TrimStart('/')) + ".png";
            var file = Path.Combine(texDir, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            var (w, h) = WritePng(decoded, file, tex.IsNormalMap, texMax);
            info["png"] = rel;
            info["width"] = w;
            info["height"] = h;
            if (w != decoded.Width) info["sourceSize"] = new JArray(decoded.Width, decoded.Height);
            info["decodedFormat"] = decoded.PixelFormat.ToString();
            info["bytes"] = new FileInfo(file).Length;
        }
        catch (Exception e)
        {
            info["error"] = $"{e.GetType().Name}: {e.Message}";
            Console.Error.WriteLine($"[textures] {tp}: {e.Message}");
        }
        return info;
    }

    // Writes RGBA PNG; textures without a small-enough mip (e.g. single-mip UI
    // textures) are resized so the longest side is <= maxSize.
    static (int W, int H) WritePng(CTexture t, string file, bool normalMap, int maxSize)
    {
        var n = t.Width * t.Height;
        var rgba = new byte[n * 4];
        var d = t.Data;
        switch (t.PixelFormat)
        {
            case EPixelFormat.PF_R8G8B8A8:
                Array.Copy(d, rgba, n * 4);
                break;
            case EPixelFormat.PF_B8G8R8A8:
                for (var i = 0; i < n; i++) { rgba[i * 4] = d[i * 4 + 2]; rgba[i * 4 + 1] = d[i * 4 + 1]; rgba[i * 4 + 2] = d[i * 4]; rgba[i * 4 + 3] = d[i * 4 + 3]; }
                break;
            case EPixelFormat.PF_G8:
                for (var i = 0; i < n; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = d[i]; rgba[i * 4 + 3] = 255; }
                break;
            default:
                throw new NotSupportedException($"decoded pixel format {t.PixelFormat}");
        }
        if (normalMap)
        {
            // BC5 normal maps carry only X/Y; rebuild Z so the PNG is a standard tangent-space normal map.
            for (var i = 0; i < n; i++)
            {
                double x = rgba[i * 4] / 127.5 - 1, y = rgba[i * 4 + 1] / 127.5 - 1;
                var z = Math.Sqrt(Math.Max(0, 1 - x * x - y * y));
                rgba[i * 4 + 2] = (byte)Math.Round((z + 1) * 127.5);
                rgba[i * 4 + 3] = 255;
            }
        }
        using var img = Image.LoadPixelData<Rgba32>(rgba, t.Width, t.Height);
        if (Math.Max(t.Width, t.Height) > maxSize)
        {
            var scale = (double)maxSize / Math.Max(t.Width, t.Height);
            img.Mutate(x => x.Resize(Math.Max(1, (int)Math.Round(t.Width * scale)), Math.Max(1, (int)Math.Round(t.Height * scale))));
        }
        img.SaveAsPng(file);
        return (img.Width, img.Height);
    }
}
