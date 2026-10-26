// Minimal glTF 2.0 binary writer for UStaticMesh LOD0. Coordinates are written
// RAW: Unreal units (cm), left-handed, Z-up, X-forward. Triangle winding is
// reversed relative to UE so faces are CCW-outward (glTF front faces).
// See tools/extract/README.md for the conversion to three.js.
using System.Text;
using CUE4Parse.UE4.Assets.Exports.StaticMesh;
using CUE4Parse.UE4.Objects.Core.Math;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace BallestExtract;

public static class Glb
{
    const int FLOAT = 5126, UINT = 5125, USHORT = 5123;
    const int ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

    public static JObject WriteStaticMesh(UStaticMesh mesh, string assetPath, string file)
    {
        var lods = mesh.RenderData?.LODs ?? [];
        var lodIndex = Array.FindIndex(lods, l => !l.SkipLod);
        if (lodIndex < 0)
        {
            var nanite = mesh.RenderData?.NaniteResources?.PageStreamingStates.Length > 0;
            throw new InvalidDataException(nanite ? "no fallback LOD (Nanite-only mesh)" : "no LOD with buffers");
        }
        var lod = lods[lodIndex];
        var pos = lod.PositionVertexBuffer!.Verts;
        var uvs = lod.VertexBuffer!.UV;
        var idx = lod.IndexBuffer!.Buffer!;
        var n = pos.Length;

        var bin = new MemoryStream();
        var w = new BinaryWriter(bin);
        var bufferViews = new JArray();
        var accessors = new JArray();

        int View(long start, int target, int? stride = null)
        {
            var v = new JObject { ["buffer"] = 0, ["byteOffset"] = start, ["byteLength"] = bin.Length - start, ["target"] = target };
            if (stride != null) v["byteStride"] = stride;
            bufferViews.Add(v);
            while (bin.Length % 4 != 0) w.Write((byte)0);
            return bufferViews.Count - 1;
        }
        int Accessor(int view, int componentType, int count, string type, JArray? min = null, JArray? max = null)
        {
            var a = new JObject { ["bufferView"] = view, ["componentType"] = componentType, ["count"] = count, ["type"] = type };
            if (min != null) { a["min"] = min; a["max"] = max; }
            accessors.Add(a);
            return accessors.Count - 1;
        }

        // POSITION
        var min = new FVector(float.MaxValue, float.MaxValue, float.MaxValue);
        var max = new FVector(float.MinValue, float.MinValue, float.MinValue);
        var start = bin.Length;
        foreach (var p in pos)
        {
            w.Write(p.X); w.Write(p.Y); w.Write(p.Z);
            min = new FVector(Math.Min(min.X, p.X), Math.Min(min.Y, p.Y), Math.Min(min.Z, p.Z));
            max = new FVector(Math.Max(max.X, p.X), Math.Max(max.Y, p.Y), Math.Max(max.Z, p.Z));
        }
        var aPos = Accessor(View(start, ARRAY_BUFFER), FLOAT, n, "VEC3",
            new JArray(min.X, min.Y, min.Z), new JArray(max.X, max.Y, max.Z));

        // NORMAL (TangentZ)
        start = bin.Length;
        for (var i = 0; i < n; i++)
        {
            var nv = (FVector)uvs[i].Normal[2];
            var len = MathF.Sqrt(nv.X * nv.X + nv.Y * nv.Y + nv.Z * nv.Z);
            if (len < 1e-6f) { w.Write(0f); w.Write(0f); w.Write(1f); }
            else { w.Write(nv.X / len); w.Write(nv.Y / len); w.Write(nv.Z / len); }
        }
        var aNrm = Accessor(View(start, ARRAY_BUFFER), FLOAT, n, "VEC3");

        // TEXCOORD_0 (UE and glTF both use a top-left UV origin; copied as-is)
        start = bin.Length;
        for (var i = 0; i < n; i++)
        {
            var uv = uvs[i].UV.Length > 0 ? uvs[i].UV[0] : default;
            w.Write(uv.U); w.Write(uv.V);
        }
        var aUv = Accessor(View(start, ARRAY_BUFFER), FLOAT, n, "VEC2");

        // Materials: one glTF material per UE material slot, same index.
        var slots = mesh.StaticMaterials;
        var materials = new JArray();
        var slotInfo = new JArray();
        var slotCount = Math.Max(slots.Length, lod.Sections.Select(s => s.MaterialIndex + 1).DefaultIfEmpty(0).Max());
        for (var i = 0; i < slotCount; i++)
        {
            var s = i < slots.Length ? slots[i] : null;
            var slotName = s?.MaterialSlotName.Text ?? $"Slot{i}";
            var matPath = s?.MaterialInterface is { IsNull: false } m ? m.ResolvedObject?.GetPathName() : null;
            materials.Add(new JObject
            {
                ["name"] = $"{i}:{slotName}",
                ["doubleSided"] = false,
                ["pbrMetallicRoughness"] = new JObject { ["metallicFactor"] = 0, ["roughnessFactor"] = 0.8 },
                ["extras"] = new JObject { ["ueSlotIndex"] = i, ["ueSlotName"] = slotName, ["ueMaterial"] = matPath },
            });
            slotInfo.Add(new JObject { ["index"] = i, ["slotName"] = slotName, ["defaultMaterial"] = matPath });
        }

        // One primitive per section (winding reversed, see below).
        var primitives = new JArray();
        var sectionInfo = new JArray();
        var useShort = n <= ushort.MaxValue;
        var tris = 0;
        foreach (var sec in lod.Sections)
        {
            if (sec.NumTriangles <= 0) continue;
            start = bin.Length;
            // UE cooks triangles clockwise-outward when the (left-handed) positions are
            // read with right-handed math (signed volume < 0). glTF/three.js treat
            // local CCW as front, so swap the last two indices: outward faces become
            // CCW and the file is glTF-conformant regardless of the app's root matrix.
            for (var t = 0; t < sec.NumTriangles; t++)
            {
                var tri = sec.FirstIndex + t * 3;
                foreach (var v in (ReadOnlySpan<uint>)[idx[tri], idx[tri + 2], idx[tri + 1]])
                    if (useShort) w.Write((ushort)v); else w.Write(v);
            }
            var aIdx = Accessor(View(start, ELEMENT_ARRAY_BUFFER), useShort ? USHORT : UINT, sec.NumTriangles * 3, "SCALAR");
            primitives.Add(new JObject
            {
                ["attributes"] = new JObject { ["POSITION"] = aPos, ["NORMAL"] = aNrm, ["TEXCOORD_0"] = aUv },
                ["indices"] = aIdx,
                ["material"] = sec.MaterialIndex,
                ["mode"] = 4,
                ["extras"] = new JObject { ["ueMaterialIndex"] = sec.MaterialIndex },
            });
            sectionInfo.Add(new JObject { ["materialIndex"] = sec.MaterialIndex, ["triangles"] = sec.NumTriangles });
            tris += sec.NumTriangles;
        }

        var name = assetPath[(assetPath.LastIndexOf('.') + 1)..];
        var coord = "Unreal Engine native: centimetres, left-handed, +X forward, +Y right, +Z up";
        var gltf = new JObject
        {
            ["asset"] = new JObject
            {
                ["version"] = "2.0",
                ["generator"] = "ballest-editor tools/extract (CUE4Parse)",
                ["extras"] = new JObject { ["ueAssetPath"] = assetPath, ["coordinateSystem"] = coord, ["lod"] = lodIndex },
            },
            ["scene"] = 0,
            ["scenes"] = new JArray(new JObject { ["nodes"] = new JArray(0) }),
            ["nodes"] = new JArray(new JObject { ["name"] = name, ["mesh"] = 0 }),
            ["meshes"] = new JArray(new JObject { ["name"] = name, ["primitives"] = primitives, ["extras"] = new JObject { ["ueAssetPath"] = assetPath } }),
            ["materials"] = materials,
            ["accessors"] = accessors,
            ["bufferViews"] = bufferViews,
            ["buffers"] = new JArray(new JObject { ["byteLength"] = bin.Length }),
        };

        var json = Encoding.UTF8.GetBytes(gltf.ToString(Formatting.None));
        var jsonPad = (4 - json.Length % 4) % 4;
        var binBytes = bin.ToArray();
        using (var fs = File.Create(file))
        using (var o = new BinaryWriter(fs))
        {
            o.Write(0x46546C67u); o.Write(2u);
            o.Write((uint)(12 + 8 + json.Length + jsonPad + 8 + binBytes.Length));
            o.Write((uint)(json.Length + jsonPad)); o.Write(0x4E4F534Au);
            o.Write(json); for (var i = 0; i < jsonPad; i++) o.Write((byte)0x20);
            o.Write((uint)binBytes.Length); o.Write(0x004E4942u);
            o.Write(binBytes);
        }

        var b = mesh.RenderData!.Bounds;
        return new JObject
        {
            ["lod"] = lodIndex,
            ["lodCount"] = lods.Length,
            ["vertices"] = n,
            ["triangles"] = tris,
            ["bounds"] = new JObject { ["min"] = new JArray(R(min.X), R(min.Y), R(min.Z)), ["max"] = new JArray(R(max.X), R(max.Y), R(max.Z)) },
            ["renderBounds"] = b == null ? null : new JObject
            {
                ["origin"] = new JArray(R(b.Origin.X), R(b.Origin.Y), R(b.Origin.Z)),
                ["boxExtent"] = new JArray(R(b.BoxExtent.X), R(b.BoxExtent.Y), R(b.BoxExtent.Z)),
            },
            ["materialSlots"] = slotInfo,
            ["sections"] = sectionInfo,
            ["bytes"] = new FileInfo(file).Length,
        };
    }

    static double R(double d) => Math.Round(d, 4);
}
