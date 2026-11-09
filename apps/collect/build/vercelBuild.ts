// Bundles each function entry with esbuild into Vercel's Build Output API v3 (`.vercel/output/`), so Vercel deploys
// the output as it is and never compiles the workspace's TypeScript itself. Shared by apps/collect and apps/admin:
//
//   node build/vercelBuild.ts <route>=<entry> ...
//
// `<route>` is the function's path under functions/ (`api/feedback` serves /api/feedback, `index` serves /).
import { build } from "esbuild"
import { mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

/** The Node.js version the functions run on; the newest one Vercel supports that the repo's engines allow. */
const RUNTIME = "nodejs22.x"

const functions = process.argv.slice(2).map((arg) => {
  const [route, entry] = arg.split("=")
  if (!route || !entry) throw new Error(`expected <route>=<entry>, got ${arg}`)
  return { route, entry }
})
if (functions.length === 0) throw new Error("no functions to build")

const output = path.resolve(".vercel/output")
await rm(output, { recursive: true, force: true })

const bundle = async ({ entry, route }: { readonly entry: string; readonly route: string }) => {
  const folder = path.join(output, "functions", `${route}.func`)
  await mkdir(folder, { recursive: true })
  await build({
    entryPoints: [entry],
    outfile: path.join(folder, "index.js"),
    bundle: true,
    platform: "node",
    target: "node22",
    // CommonJS (the package.json below says so, over this package's "type": "module"), so the Nodejs launcher can
    // require() it, with the handler as the module itself rather than its `default`.
    format: "cjs",
    footer: { js: "module.exports = module.exports.default;" },
    sourcemap: true,
    logLevel: "warning"
  })
  const config = {
    runtime: RUNTIME,
    handler: "index.js",
    launcherType: "Nodejs",
    shouldAddHelpers: false,
    shouldAddSourcemapSupport: true,
    maxDuration: 15
  }
  await writeFile(path.join(folder, "package.json"), `${JSON.stringify({ type: "commonjs" })}\n`)
  await writeFile(path.join(folder, ".vc-config.json"), `${JSON.stringify(config, null, 2)}\n`)
}

await Promise.all(functions.map(bundle))

await writeFile(path.join(output, "config.json"), `${JSON.stringify({ version: 3 }, null, 2)}\n`)
console.log(`built ${functions.map((f) => f.route).join(", ")} into ${path.relative(process.cwd(), output)}`)
