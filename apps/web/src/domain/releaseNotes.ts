/** How a release's notes (`UpdateState.releaseNotes` in @ballest/contracts) read in the update popover. */

/**
 * What a link shows when its text is its own address, as GitHub's generated notes write pull requests ("… by @name in
 * https://github.com/owner/repo/pull/209") and the Full Changelog: the short form GitHub's own pages show (#209,
 * v0.1.3...v0.2.0). Any other address shows as it is.
 */
export const linkTextOf = (text: string, href: string): string => {
  if (text.trim() !== href.trim()) return text
  const path = /^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(pull|issues|compare)\/([^\s?#]+)$/i.exec(href.trim())
  if (path === null) return text
  const [, kind, rest] = path
  if (kind === "compare") return rest ?? text
  return /^\d+$/.test(rest ?? "") ? `#${rest}` : text
}
