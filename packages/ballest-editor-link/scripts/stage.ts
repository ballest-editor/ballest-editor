// Stages a plugin as it is installed: info.toml and the script files it lists, in dist/<id>/ (the folder name is
// the plugin's id). The plugin's folder is this package's, or the one given (packages/ballest-driver runs this too).
// apps/desktop installs ballest-editor-link from there, or from the packaged app's resources/plugins/.
import * as fs from "node:fs"
import * as path from "node:path"

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, ".."))
const out = path.join(root, "dist", path.basename(root))
const manifest = fs.readFileSync(path.join(root, "info.toml"), "utf8")
// The plugin manager's default when [script] has no files.
const listed = /^\s*files\s*=\s*\[(.*)\]/m.exec(manifest)?.[1] ?? "\"main.as\""
const files = listed.split(",").map((item) => item.trim().replace(/^"|"$/g, "")).filter((item) => item.length > 0)

fs.rmSync(path.join(root, "dist"), { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
for (const file of ["info.toml", ...files]) fs.copyFileSync(path.join(root, file), path.join(out, file))
console.log(`staged ${["info.toml", ...files].join(", ")} in ${path.relative(root, out)}`)
