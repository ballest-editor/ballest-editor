// `pnpm check:changed [ref]`: the fast checks for what this branch changed, against its merge base with origin/main or
// with `ref`, uncommitted and untracked files included. Format and lint take the changed files, typecheck the affected
// packages and their dependents, tests only those the changes reach, knip and dupes the repo (turbo replays them when
// nothing they read changed). The build and the full suites stay with pre-push and CI. Prints a line per check, and the
// output of what failed.
import { execFileSync, spawn } from "node:child_process"
import { formattedFiles, lintedFiles } from "./changedChecks.ts"

interface Check {
  readonly name: string
  readonly args: ReadonlyArray<string>
}

const MAX_OUTPUT_LINES = 200

const git = (...args: ReadonlyArray<string>) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()

const lines = (text: string) => text.split("\n").filter((line) => line.length > 0)

const base = git("merge-base", "HEAD", process.argv[2] ?? "origin/main")
const existing = [
  ...lines(git("diff", "--name-only", "--diff-filter=d", base)),
  ...lines(git("ls-files", "--others", "--exclude-standard"))
]
const anythingChanged = existing.length > 0 || lines(git("diff", "--name-only", base)).length > 0

if (!anythingChanged) {
  console.log(`No changes against ${base.slice(0, 9)}.`)
  process.exit(0)
}

const turbo = ["exec", "turbo", "run", "--continue", "--output-logs=errors-only", "--ui=stream"]

const run = ({ args, name }: Check) =>
  new Promise<boolean>((resolve) => {
    const started = Date.now()
    const child = spawn("pnpm", args, {
      env: { ...process.env, TURBO_SCM_BASE: base },
      stdio: ["ignore", "pipe", "pipe"]
    })
    let output = ""
    child.stdout.on("data", (chunk) => (output += String(chunk)))
    child.stderr.on("data", (chunk) => (output += String(chunk)))
    child.on("close", (code) => {
      const ok = code === 0
      console.log(`${ok ? "pass" : "FAIL"}  ${name}  ${((Date.now() - started) / 1000).toFixed(1)}s`)
      if (!ok) console.log(lines(output).slice(-MAX_OUTPUT_LINES).join("\n"))
      resolve(ok)
    })
  })

const format = formattedFiles(existing)
const lint = lintedFiles(existing)

const first: ReadonlyArray<Check> = [
  ...(format.length > 0 ? [{ name: "format", args: ["exec", "dprint", "check", "--allow-no-files", ...format] }] : []),
  ...(lint.length > 0 ? [{ name: "lint", args: ["lint:files", ...lint] }] : []),
  { name: "knip and dupes", args: [...turbo, "knip", "dupes"] },
  { name: "typecheck", args: [...turbo, "typecheck", "--affected"] }
]
const tests: Check = {
  name: "tests",
  args: [...turbo, "test", "--affected", "--", `--changed=${base}`, "--passWithNoTests"]
}

console.log(`Checking ${existing.length} changed files against ${base.slice(0, 9)}`)
const results = [...await Promise.all(first.map(run)), await run(tests)]
console.log("The build and the full test suites run on push and in CI.")
process.exit(results.every(Boolean) ? 0 : 1)
