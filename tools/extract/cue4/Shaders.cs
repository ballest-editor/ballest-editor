// shaders --list FILE --out DIR [--platform PCD3D_SM6]
// For every material (instance) object path in FILE, finds its cooked shader map in the
// IoStore shader library (ShaderArchive-Ballest-<platform>.ushaderbytecode + shader-group
// chunks in the ucas) and writes each vertex and pixel shader's bytecode to DIR/<asset>/<n>.dxil, plus
// DIR/index.json describing them (shader type/vertex-factory hashes, sizes, and the shader
// map's MaterialCompilationOutput: uniform expression set, texture parameters). The cooked
// material has no expression graph; the compiled shader is the only place the graph's
// constants (UV scales, which textures feed which output) survive.
using CUE4Parse.Compression;
using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Material;
using CUE4Parse.UE4.IO;
using CUE4Parse.UE4.IO.Objects;
using CUE4Parse.UE4.Readers;
using CUE4Parse.UE4.Shaders;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace BallestExtract;

public static partial class Program
{
    internal static int ExportShaders(string[] args, DefaultFileProvider provider)
    {
        var list = Opt(args, "--list") ?? throw new ArgumentException("--list required");
        var outDir = Opt(args, "--out") ?? throw new ArgumentException("--out required");
        var platform = Opt(args, "--platform") ?? "PCD3D_SM6";
        provider.ReadShaderMaps = true;
        Directory.CreateDirectory(outDir);

        var archivePath = $"Ballest/Content/ShaderArchive-Ballest-{platform}-{platform}.ushaderbytecode";
        if (!provider.TrySaveAsset(archivePath, out var archiveBytes)) throw new FileNotFoundException(archivePath);
        var archive = new FShaderCodeArchive(new FByteArchive(archivePath, archiveBytes, provider.Versions));
        var io = archive.SerializedShaders as FIoStoreShaderCodeArchive ?? throw new InvalidDataException("not an IoStore shader library");
        var mapIndex = new Dictionary<string, int>();
        for (var i = 0; i < io.ShaderMapHashes.Length; i++) mapIndex[io.ShaderMapHashes[i].ToString()] = i;
        Console.Error.WriteLine($"[shaders] {archivePath}: {io.ShaderMapHashes.Length} shader maps, {io.ShaderEntries.Length} shaders, {io.ShaderGroupEntries.Length} groups");

        var readers = provider.MountedVfs.OfType<IoStoreReader>().ToList();
        byte[] ReadChunk(FIoChunkId id)
        {
            foreach (var r in readers)
                if (r.TryResolve(id, out _)) return r.Read(id);
            throw new KeyNotFoundException($"chunk {id} not in any mounted IoStore");
        }
        var groups = new Dictionary<uint, byte[]>();
        byte[] Group(uint g)
        {
            if (groups.TryGetValue(g, out var cached)) return cached;
            var entry = io.ShaderGroupEntries[g];
            var raw = ReadChunk(io.ShaderGroupIoHashes[g]);
            var bytes = entry.CompressedSize == entry.UncompressedSize
                ? raw
                : Compression.Decompress(raw, 0, (int) entry.CompressedSize, (int) entry.UncompressedSize, CompressionMethod.Oodle);
            groups[g] = bytes;
            return bytes;
        }
        // Uncompressed size of shader `shaderIndex`: up to the next shader in its group, else the group's end.
        int ShaderSize(uint shaderIndex)
        {
            var e = io.ShaderEntries[shaderIndex];
            var g = io.ShaderGroupEntries[e.ShaderGroupIndex];
            var next = (long) g.UncompressedSize;
            for (var k = 0; k < g.NumShaders; k++)
            {
                var other = io.ShaderEntries[io.ShaderIndices[g.ShaderIndicesOffset + k]];
                var off = (long) other.UncompressedOffsetInGroup;
                if (off > e.UncompressedOffsetInGroup && off < next) next = off;
            }
            return (int) (next - e.UncompressedOffsetInGroup);
        }

        var index = new JObject();
        foreach (var path in ReadLines(list).Distinct())
        {
            var entry = new JObject();
            index[path] = entry;
            try
            {
                var obj = provider.LoadPackageObject(path) as UMaterialInterface ?? throw new InvalidDataException("not a material");
                var resources = obj.LoadedMaterialResources;
                entry["resources"] = resources.Count;
                var maps = new JArray();
                entry["shaderMaps"] = maps;
                var assetName = path.Split('.').Last();
                var written = 0;
                for (var ri = 0; ri < resources.Count; ri++)
                {
                    var sm = resources[ri].LoadedShaderMap;
                    if (sm == null) continue;
                    var m = new JObject { ["platform"] = sm.ShaderPlatform.ToString() };
                    maps.Add(m);
                    var hash = sm.ResourceHash?.ToString();
                    m["resourceHash"] = hash;
                    var content = sm.Content as FMaterialShaderMapContent ?? throw new InvalidDataException("not a material shader map");
                    m["compilationOutput"] = JToken.FromObject(content.MaterialCompilationOutput, Json);
                    if (hash == null || !mapIndex.TryGetValue(hash, out var mi))
                    {
                        m["error"] = "shader map not in the library";
                        continue;
                    }
                    var mapEntry = io.ShaderMapEntries[mi];
                    var shaderIndices = io.ShaderIndices.AsSpan((int) mapEntry.ShaderIndicesOffset, (int) mapEntry.NumShaders).ToArray();
                    m["numShaders"] = shaderIndices.Length;
                    var shaders = new JArray();
                    m["shaders"] = shaders;
                    IEnumerable<(FShader shader, string vf)> All()
                    {
                        foreach (var s in sm.Content.Shaders) yield return (s, "");
                        foreach (var mesh in content.OrderedMeshShaderMaps ?? [])
                            foreach (var s in mesh.Shaders) yield return (s, mesh.VertexFactoryTypeName.ToString());
                    }
                    foreach (var (shader, vf) in All())
                    {
                        if (shader.Target.Frequency is not (EShaderFrequency.SF_Pixel or EShaderFrequency.SF_Vertex)) continue;
                        if (shader.ResourceIndex < 0 || shader.ResourceIndex >= shaderIndices.Length) continue;
                        var si = shaderIndices[shader.ResourceIndex];
                        var se = io.ShaderEntries[si];
                        var size = ShaderSize(si);
                        var code = Group(se.ShaderGroupIndex).AsSpan((int) se.UncompressedOffsetInGroup, size).ToArray();
                        var fileBase = $"{assetName}/{ri}_{(shader.Target.Frequency == EShaderFrequency.SF_Vertex ? "vs" : "ps")}_{written++}";
                        Directory.CreateDirectory(Path.Combine(outDir, assetName));
                        var rec = new JObject
                        {
                            ["file"] = fileBase,
                            ["type"] = shader.Type.ToString(),
                            ["frequency"] = shader.Target.Frequency.ToString(),
                            ["vertexFactory"] = vf,
                            ["size"] = size,
                            ["hash"] = io.ShaderHashes[si].ToString()
                        };
                        shaders.Add(rec);
                        // FShaderCode: bytecode, optional data, int32 optional-data size. The D3D bytecode is a
                        // DXBC container whose total size sits at byte 24.
                        var magic = code.AsSpan().IndexOf("DXBC"u8);
                        if (magic >= 0 && code.Length >= magic + 28)
                        {
                            var total = BitConverter.ToInt32(code, magic + 24);
                            if (total > 0 && magic + total <= code.Length)
                            {
                                File.WriteAllBytes(Path.Combine(outDir, fileBase + ".dxil"), code.AsSpan(magic, total).ToArray());
                                rec["dxil"] = total;
                                continue;
                            }
                        }
                        File.WriteAllBytes(Path.Combine(outDir, fileBase + ".bin"), code);
                    }
                }
                entry["written"] = written;
            }
            catch (Exception e)
            {
                entry["error"] = $"{e.GetType().Name}: {e.Message}";
                Console.Error.WriteLine($"[shaders] {path}: {e.GetType().Name}: {e.Message}");
            }
        }
        File.WriteAllText(Path.Combine(outDir, "index.json"), index.ToString(Formatting.Indented));
        Console.Error.WriteLine($"[shaders] wrote {outDir}/index.json");
        return 0;
    }
}
