# Collect endpoint

`@ballest/collect` is the public endpoint Ballest Editor sends feedback and anonymous usage statistics to (issues #198 and #199). It is its own Vercel project, deployed at `https://ballest-collect.vercel.app` (`COLLECT_URL` in `@ballest/contracts`). The desktop app holds no credential; the secrets below live only here.

| Route                | Takes                                                                     | Answers                                    |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| `POST /api/feedback` | `FeedbackSubmission` (`packages/contracts/src/collect.ts`), at most 16 KB | `FeedbackReceipt` JSON: the issue it filed |
| `POST /api/events`   | `UsageBatch`, at most 256 KB                                              | 204                                        |

- A body is decoded with the contract's schema, extra keys included, and anything it refuses is a 400. A larger body is a 413, another method a 405, and any other path Vercel's own 404.
- Each client gets 5 feedback submissions and 60 usage batches an hour, then 429. A client is an HMAC of its address (`x-forwarded-for`, which Vercel sets) keyed with `IP_HASH_SALT`; the address itself is never stored.
- Feedback becomes an issue in `ballest-editor/ballest-editor`, filed as the GitHub App. The title is `[Feedback]` and the message's first line, the body the message and the app's version, platform and OS version. Labels: `feedback`, plus `bug`, `enhancement` or `parity` for the kinds bug, idea and mismatch. `src/sanitise.ts` defuses mentions and issue references, and strips raw HTML and images. The Discord and creator names are stored in the database for the maintainer to reply, and never written into the issue.
- Every usage event is one row in `usage_events`; `schema.sql` has the tables, the two roles and the views `apps/admin` reads. Raw events are kept forever for now.
- No CORS headers: the desktop app's main process calls this, never a page.

## Environment variables

Set in the Vercel project, for Production (and Preview if previews should work). Values never go in the repo; `.env.example` lists the names.

| Name                         | Is                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | The `ballest_collect` role's Neon connection string                                   |
| `IP_HASH_SALT`               | A long random string; changing it resets every rate limit                             |
| `GITHUB_APP_ID`              | The GitHub App's id                                                                   |
| `GITHUB_APP_INSTALLATION_ID` | Its installation on `ballest-editor/ballest-editor`                                   |
| `GITHUB_APP_PRIVATE_KEY`     | Its private key, the whole PEM; mark it Sensitive. Newlines written as `\n` also work |

## Setting up

1. **GitHub App.** In the `ballest-editor` organisation's settings, create a GitHub App with no webhook (untick Active) and one permission, Repository › Issues: Read and write. Install it on `ballest-editor/ballest-editor` only. The App's id is on its settings page, and the installation id is the number at the end of the installation's settings URL. Generate a private key and put the PEM in `GITHUB_APP_PRIVATE_KEY` as a Sensitive env var.
2. **Labels.** Make sure the repository has `feedback`, `bug`, `enhancement` and `parity`. GitHub creates a missing one on first use, but without a colour or description.
3. **Database.** Add Neon from the Vercel Marketplace (Storage › Create Database) and connect it to both this project and `apps/admin`'s. Then, with the owner's connection string from the Neon console, run the schema once, choosing the two roles' passwords:

   ```sh
   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -v collect_password=... -v admin_password=... -f apps/collect/schema.sql
   ```

   Roles made in the Neon console are members of `neon_superuser`, so the script makes its own. Set `DATABASE_URL` here to the owner's string with the user and password swapped for `ballest_collect`'s, replacing the one the integration added.
4. **Vercel project.** Import the repository with Root Directory `apps/collect`; `vercel.json` sets the build. Turn deployment protection **off** (Settings › Deployment Protection › Vercel Authentication: Disabled): the app POSTs here without a login. The production domain must be `ballest-collect.vercel.app`.

## Working on it

`pnpm --filter @ballest/collect test` runs the tests against fake services (`src/test/fakes.ts`). `pnpm --filter @ballest/collect build` writes `.vercel/output/` with Vercel's Build Output API: `build/vercelBuild.ts` bundles each `src/functions/*.ts` with esbuild into `functions/api/<name>.func/`, so Vercel deploys the bundle as it is and never compiles the workspace itself. `apps/admin` builds with the same script and serves its page with the same Node adapter (`src/vercel.ts`).
