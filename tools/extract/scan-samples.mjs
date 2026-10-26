#!/usr/bin/env node
// Scan .ballmap/.balledit files and list every actorToSpawn class with the mesh
// and material paths the game recorded for it.
// usage: node scan-samples.mjs --out WORKDIR SAMPLE_DIR_OR_FILE...
// writes WORKDIR/samples.json, WORKDIR/classes.txt, WORKDIR/sample-meshes.txt
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
if (outIdx < 0 || args.length < 3) {
  console.error("usage: scan-samples.mjs --out WORKDIR SAMPLES...");
  process.exit(2);
}
const out = args[outIdx + 1];
const inputs = args.filter((_, i) => i !== outIdx && i !== outIdx + 1);

function* walk(p) {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p)) yield* walk(join(p, e));
  else if (/\.(ballmap|balledit)$/i.test(p)) yield p;
}

const bump = (obj, k, n = 1) => (obj[k] = (obj[k] ?? 0) + n);
const classes = new Map();
let files = 0, items = 0;
for (const input of inputs) {
  for (const file of walk(input)) {
    const doc = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
    files++;
    for (const it of doc.items ?? []) {
      items++;
      const classPath = it.actorToSpawn;
      const m = /'([^']+)'/.exec(classPath);
      const objectPath = m ? m[1] : classPath;
      let c = classes.get(classPath);
      if (!c) {
        c = { classPath, objectPath, className: objectPath.split(".").pop(), seenInSamples: 0, meshes: {}, materials: {}, propertyNames: {} };
        classes.set(classPath, c);
      }
      c.seenInSamples++;
      for (const mc of it.meshComponents ?? []) {
        if (mc.meshAssetPath !== undefined) bump(c.meshes, mc.meshAssetPath);
        for (const mat of mc.materials ?? []) {
          const slot = (c.materials[mat.materialIndex] ??= {});
          bump(slot, /'([^']+)'/.exec(mat.material)?.[1] ?? mat.material);
        }
      }
      for (const kind of ["bool", "float", "int", "text", "name", "string"])
        for (const p of it[`${kind}Properties`] ?? []) bump(c.propertyNames, `${p.propertyName}:${p.propertyType ?? kind}`);
    }
  }
}

const list = [...classes.values()].sort((a, b) => b.seenInSamples - a.seenInSamples);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "samples.json"), JSON.stringify({ files, items, classes: list }, null, 2));
writeFileSync(join(out, "classes.txt"), list.map((c) => c.objectPath).join("\n") + "\n");
const meshes = new Set(list.flatMap((c) => Object.keys(c.meshes)).filter((p) => p.startsWith("/")));
writeFileSync(join(out, "sample-meshes.txt"), [...meshes].sort().join("\n") + "\n");
console.error(`[samples] ${files} files, ${items} items, ${list.length} classes, ${meshes.size} distinct meshes`);
