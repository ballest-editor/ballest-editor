#!/usr/bin/env -S node --experimental-strip-types
// The TypeScript half of tools/extract (run.sh drives it): `shaders` and `materials list|build`; and `connectors`, the
// cap survey run by hand (docs/qa/connectors.md).
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { connectorSurvey } from "./connectorSurvey.ts"
import { materialsBuild, materialsList, materialsShaderList } from "./materials.ts"
import { shaders } from "./shaders.ts"

// The raw meshes when the game was extracted here, else the asset pack's: both hold pieces/**.glb at the same paths.
const repo = join(import.meta.dirname, "..", "..", "..")
const meshesDefault = existsSync(join(repo, "assets", "pieces")) ? join(repo, "assets") : join(repo, "web-assets")

const shadersCommand = Command.make(
  "shaders",
  {
    dump: Flag.String("dump").pipe(Flag.withDescription("the C# tool's `shaders` output dir (index.json + *.dxil)")),
    out: Flag.String("out").pipe(Flag.withDescription("shaders.json to write")),
    dxc: Flag.String("dxc").pipe(
      Flag.withDescription("path to dxc (DirectX Shader Compiler)"),
      Flag.withDefault("dxc")
    ),
    materials: Flag.String("materials").pipe(Flag.withDescription("WORK/materials-dump.json (parameter values)")),
    list: Flag.String("list").pipe(Flag.withDescription("WORK/materials.txt (materials to evaluate)")),
    textures: Flag.String("textures").pipe(Flag.withDescription("WORK/textures (decoded PNGs, read at their mean)"))
  },
  shaders
).pipe(Command.withDescription("Trace texture coordinates through the materials' compiled shaders"))

const work = Argument.String("work").pipe(Argument.withDescription("work dir (dumps)"))
const assets = Argument.String("assets").pipe(Argument.withDescription("assets dir"))
const list = Command.make("list", { work, assets }, materialsList).pipe(
  Command.withDescription("WORK/materials.txt: every material the samples, catalog and paint picker reference")
)
const build = Command.make("build", { work, assets }, materialsBuild).pipe(
  Command.withDescription("ASSETS/materials.json from WORK/materials-dump.json, paint-dump.json and shaders.json")
)
const shaderList = Command.make("shader-list", { work }, materialsShaderList).pipe(
  Command.withDescription("WORK/shader-materials.txt: every material in materials-dump.json, for the C# `shaders` mode")
)
const materialsCommand = Command.make("materials").pipe(Command.withSubcommands([list, shaderList, build]))

const connectorsCommand = Command.make(
  "connectors",
  {
    meshes: Flag.String("meshes").pipe(
      Flag.withDescription(
        "the folder that holds pieces/**.glb: assets/ after an extract, or the asset pack's web-assets/"
      ),
      Flag.withDefault(meshesDefault)
    ),
    write: Flag.Boolean("write").pipe(
      Flag.withDescription("write connectors.json and the catalog's connectors"),
      Flag.withDefault(false)
    )
  },
  connectorSurvey
).pipe(Command.withDescription("Read every directional piece's ends off its mesh (docs/qa/connectors.md)"))

Command.make("extract").pipe(
  Command.withSubcommands([shadersCommand, materialsCommand, connectorsCommand]),
  Command.run({ version: "0.1.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
