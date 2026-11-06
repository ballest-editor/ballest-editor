// oxlint-disable eslint/no-await-in-loop -- driving one browser is sequential: each step waits on the last
/** A stateless model review of one capture per call, for what checks can't see. Never in CI: it costs money. */
import { execFile } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseJson } from "./cdp.ts"
import { readResults, type ResultRow } from "./report.ts"

export interface Finding {
  readonly key: string
  readonly issue: string
  readonly severity: "high" | "medium" | "low"
}

const SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: { issue: { type: "string" }, severity: { type: "string", enum: ["high", "medium", "low"] } },
        required: ["issue", "severity"]
      }
    }
  },
  required: ["findings"]
}

/** Each of these was confirmed as intended; add to it when a review keeps reporting something that is fine. */
const INTENDED = [
  "a page screenshot leaves out the window controls, so a blank at one end of the top bar is expected",
  "fixture content, and the fixed clock and creator name of a test run",
  "pieces drawn plain or a mesh-failed badge when the asset pack lacks a piece"
]

export const promptFor = (row: ResultRow, dir: string): string =>
  [
    "You are reviewing a screenshot of Ballest Editor, a desktop map editor for a racing game, for visual bugs.",
    `State: ${row.id}. Shows: ${row.views.join(", ")}. Axes: ${JSON.stringify(row.axes)}.`,
    `Read the screenshot with the Read tool: ${path.join(dir, row.shot)}`,
    ...(row.a11y === undefined ? [] : [`The accessibility tree is at ${path.join(dir, row.a11y)}.`]),
    "Report only defects a user would notice: clipped or overlapping text, controls cut off, colours wrong for the theme or unreadable contrast, large unexplained gaps, misaligned layout, error banners.",
    `Never report: ${INTENDED.join("; ")}.`,
    "Prefer no finding to a speculative one. Severity: high = broken, medium = clearly wrong, low = polish."
  ].join("\n")

const askClaude = (prompt: string, dir: string) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      "claude",
      [
        "-p",
        prompt,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(SCHEMA),
        "--allowedTools",
        "Read",
        "--add-dir",
        dir,
        "--no-session-persistence",
        ...(process.env["BALLEST_REVIEW_MODEL"] === undefined ? [] : ["--model", process.env["BALLEST_REVIEW_MODEL"]])
      ],
      { cwd: dir, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => error === null ? resolve(stdout) : reject(new Error(error.message))
    )
  })

export const reviewRun = async (dir: string, keys: ReadonlyArray<string>): Promise<ReadonlyArray<Finding>> => {
  const rows = readResults(dir).filter((row) =>
    row.hash !== undefined && (keys.length === 0 || keys.includes(row.key) || keys.includes(row.id))
  )
  const findings: Array<Finding> = []
  for (const row of rows) {
    const output = parseJson<{
      readonly structured_output?: { readonly findings?: ReadonlyArray<Omit<Finding, "key">> }
    }>(await askClaude(promptFor(row, dir), dir))
    // No result isn't a clean review.
    const found = output.structured_output?.findings
    if (found === undefined) throw new Error(`the review of ${row.key} returned no findings list`)
    findings.push(...found.map((finding) => ({ ...finding, key: row.key })))
  }
  fs.writeFileSync(
    path.join(dir, "findings.jsonl"),
    findings.map((finding) => JSON.stringify(finding)).join("\n") + "\n"
  )
  if (findings.length > 0) {
    fs.appendFileSync(
      path.join(dir, "summary.md"),
      ["", "Review:", ...findings.map(({ issue, key, severity }) => `- ${severity} ${key}: ${issue}`), ""].join("\n")
    )
  }
  return findings
}
