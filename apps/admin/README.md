# Stats dashboard

`@ballest/admin` is the maintainer's page over the collect endpoint's database (`apps/collect`): active installs and sessions per day for the last 30 days, median and p90 session length, versions in use, the platform split, the latest errors grouped by message, and feedback per week with links to its issues and who to reply to. It is one server-rendered page at `/`, with no client script, in its own Vercel project. Ballest Editor never links to it.

The page reads only the views in `apps/collect/schema.sql`, as the read-only `ballest_admin` role. Everything from the database is HTML-escaped, and only links to this repository's issues are links.

## Setting up

1. Import the repository as a second Vercel project with Root Directory `apps/admin`; `vercel.json` sets the build.
2. Turn on Vercel Authentication for **all deployments** (Settings › Deployment Protection › Vercel Authentication › All Deployments), production included. The page shows Discord and creator names, so nobody outside the team may see it.
3. Connect the Neon database the collect endpoint uses, then set `DATABASE_URL` to the `ballest_admin` role's connection string (the owner's string with that role's user and password), replacing the one the integration added. It is the only env var; `.env.example` lists it.

## Working on it

`pnpm --filter @ballest/admin test` renders the page against a fake `Stats` service. `pnpm --filter @ballest/admin build` bundles `src/functions/index.ts` into `.vercel/output/functions/index.func/` with `apps/collect/build/vercelBuild.ts`.
