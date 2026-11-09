import type { FeedbackKind, FeedbackSubmission } from "@ballest/contracts"
import type { NewIssue } from "./GitHub"
import { firstLine, sanitise } from "./sanitise"

/** The label each kind adds beside `feedback`; `other` adds none. */
export const KIND_LABELS: Record<FeedbackKind, string | undefined> = {
  bug: "bug",
  idea: "enhancement",
  mismatch: "parity",
  other: undefined
}

/** A fact the app sent, as a code span: in one, nothing is a mention, a reference or markup. */
const fact = (text: string) => `\`${text.replace(/[`\n\r]/g, " ").trim() || "unknown"}\``

/**
 * The public issue a submission becomes: only the message, sanitised, and the app's facts. The Discord and creator
 * names are kept in the database for the maintainer, never written here.
 */
export const issueFor = (submission: FeedbackSubmission): NewIssue => {
  const message = sanitise(submission.message)
  const label = KIND_LABELS[submission.kind]
  return {
    title: `[Feedback] ${firstLine(message) ?? submission.kind}`,
    body: [
      message || "_(no text)_",
      "",
      "---",
      "",
      `Ballest Editor ${fact(submission.appVersion)} · ${fact(submission.platform)} ${fact(submission.osVersion)}`
    ].join("\n"),
    labels: label === undefined ? ["feedback"] : ["feedback", label]
  }
}
