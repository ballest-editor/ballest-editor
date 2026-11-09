/** Between two characters, invisible: it keeps GitHub from reading a mention or reference without changing the text. */
const JOINER = "\u2060"

/**
 * What the message must not do on GitHub, in the order they're undone: load anything from elsewhere when the issue is
 * viewed, notify anyone, or put a backlink on another issue or pull request.
 */
const RULES: ReadonlyArray<readonly [RegExp, string | ((match: string) => string)]> = [
  // Character references first: `&#64;user` renders as a mention, `&lt;` is fine either way.
  [/&(?=#?\w+;)/g, "&amp;"],
  // Raw HTML: comments (which hide text), then tags (an <img> that loads from anywhere, a <details>).
  [/<!--[\s\S]*?(?:-->|$)/g, ""],
  [/<\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?\/?>/g, ""],
  // Images, inline and by reference.
  [/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g, ""],
  // A link to an issue or pull request puts a backlink on it; in a code span it's only text.
  [/(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s<>`()[\]]*/gi, (url) => `\`${url}\``],
  // @user and @org/team notify them.
  [/@(?=[A-Za-z0-9])/g, `@${JOINER}`],
  // #123, owner/repo#123 and GH-123 reference that issue.
  [/#(?=\d)/g, `#${JOINER}`],
  [/\b(GH)-(?=\d)/gi, `$1-${JOINER}`]
]

/** `message` made safe to post as a public issue body: see {@link RULES}. */
export const sanitise = (message: string): string =>
  RULES.reduce<string>(
    (text, [pattern, replacement]) =>
      typeof replacement === "string" ? text.replace(pattern, replacement) : text.replace(pattern, replacement),
    message.replace(/\r\n?/g, "\n")
  ).trim()

/** The longest issue title made from the message, in characters, after the `[Feedback] ` prefix. */
export const TITLE_LIMIT = 72

/** The first line of an already sanitised message with any text, cut to {@link TITLE_LIMIT}. */
export const firstLine = (sanitised: string): string | undefined => {
  const line = sanitised.split("\n").map((each) => each.trim()).find((each) => each.length > 0)
  if (line === undefined) return undefined
  const chars = Array.from(line)
  return chars.length <= TITLE_LIMIT ? line : `${chars.slice(0, TITLE_LIMIT - 1).join("").trimEnd()}…`
}
