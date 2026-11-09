import { FeedbackKind } from "@ballest/contracts"
import { describe, expect, it } from "@effect/vitest"
import { issueFor, KIND_LABELS } from "./issue"
import { submission } from "./test/fakes"

describe("issueFor", () => {
  it.each(
    [
      ["bug", ["feedback", "bug"]],
      ["idea", ["feedback", "enhancement"]],
      ["mismatch", ["feedback", "parity"]],
      ["other", ["feedback"]]
    ] as const
  )("labels %s feedback %j", (kind, labels) => {
    expect(issueFor(submission({ kind })).labels).toEqual(labels)
  })

  it("has a label for every kind the form offers", () => {
    expect(Object.keys(KIND_LABELS).sort()).toEqual([...FeedbackKind.literals].sort())
  })

  it("never writes the Discord or creator name", () => {
    const issue = issueFor(submission({ discord: "secret-discord-name", creator: "SecretCreator" }))
    for (const text of [issue.title, issue.body]) {
      expect(text).not.toContain("secret-discord-name")
      expect(text).not.toContain("SecretCreator")
    }
  })

  it("titles the issue with the message's first line and puts the app's facts in code spans", () => {
    const issue = issueFor(submission({ appVersion: "0.4.0 @octocat `x`", osVersion: "" }))
    expect(issue.title).toBe("[Feedback] The ramp floats above the floor")
    expect(issue.body).toContain("Steps: place it, save, open in game.")
    expect(issue.body).toContain("Ballest Editor `0.4.0 @octocat  x` · `win32` `unknown`")
  })

  it("sanitises the title as well as the body", () => {
    const issue = issueFor(submission({ message: "@octocat broke #12" }))
    expect(issue.title).toBe("[Feedback] @⁠octocat broke #⁠12")
    expect(issue.body).not.toMatch(/@octocat|#12/)
  })

  it("falls back to the kind when the message has no text left", () => {
    const issue = issueFor(submission({ kind: "idea", message: "![x](https://e.example/a.png)" }))
    expect(issue.title).toBe("[Feedback] idea")
    expect(issue.body.startsWith("_(no text)_")).toBe(true)
  })
})
