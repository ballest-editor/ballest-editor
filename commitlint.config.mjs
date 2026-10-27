/**
 * Conventional Commits (https://www.conventionalcommits.org) for commit messages, PR titles
 * and issue titles. PRs are squash-merged with the PR title as the commit subject, so the
 * title is what lands on main.
 */
export default {
  extends: ["@commitlint/config-conventional"]
}
