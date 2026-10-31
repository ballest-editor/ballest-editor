// Stages the plugin as the desktop app ships it: info.toml and the script files it lists, in
// dist/ballest-editor-link/ (the folder name is the plugin's id). apps/desktop installs it from there, or from the
// packaged app's resources/plugins/ballest-editor-link.
import * as fs from "node:fs"
import * as path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const out = path.join(root, "dist", "ballest-editor-link")
const manifest = fs.readFileSync(path.join(root, "info.toml"), "utf8")
// The plugin manager's default when [script] has no files.
const listed = /^\s*files\s*=\s*\[(.*)\]/m.exec(manifest)?.[1] ?? "\"main.as\""
const files = listed.split(",").map((item) => item.trim().replace(/^"|"$/g, "")).filter((item) => item.length > 0)

fs.rmSync(path.join(root, "dist"), { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
for (const file of ["info.toml", ...files]) fs.copyFileSync(path.join(root, file), path.join(out, file))
console.log(`staged ${["info.toml", ...files].join(", ")} in ${path.relative(root, out)}`)
