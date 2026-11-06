import { Schema } from "effect"
import { execSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import type { ThirdPartyNotice } from "../src/domain/thirdPartyNotice"

/** What `pnpm licenses list --json` prints: packages by licence. */
const LicensedPackage = Schema.Struct({
  name: Schema.String,
  versions: Schema.Array(Schema.String),
  paths: Schema.Array(Schema.String),
  license: Schema.String,
  author: Schema.optionalKey(Schema.String),
  homepage: Schema.optionalKey(Schema.String)
})
const LicenseListing = Schema.Record(Schema.String, Schema.Array(LicensedPackage))
type LicenseListing = typeof LicenseListing.Type

/** The fields of a package's `package.json` that stand in for pnpm's listing. */
const PackageManifest = Schema.Struct({
  version: Schema.String,
  license: Schema.String,
  homepage: Schema.optionalKey(Schema.String)
})

/** The workspace packages that make up the app; `--prod` follows their runtime dependencies through the lockfile. */
const APP_PACKAGES = ["@ballest/web", "@ballest/desktop", "@ballest/contracts", "@workspace/ui"]

/** Never in what ships: the workspace's own packages, and type declarations. */
const isThirdParty = (name: string) => !/^@(ballest|workspace|types)\//.test(name)

/** The first of `dirs` that holds a licence file, read; `read` is `dir -> text`. */
const firstText = (dirs: ReadonlyArray<string>, read: (dir: string) => string | null): string | null => {
  for (const dir of dirs) {
    const text = read(dir)
    if (text !== null) return text
  }
  return null
}

/** The listing as the app shows it: one entry per package, by name. */
export const noticesOf = (
  listing: LicenseListing,
  readLicense: (dir: string) => string | null
): ReadonlyArray<ThirdPartyNotice> =>
  Object.values(listing)
    .flat()
    .filter((pkg) => isThirdParty(pkg.name))
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.versions.join(", "),
      license: pkg.license,
      author: pkg.author ?? null,
      homepage: pkg.homepage ?? null,
      text: firstText(pkg.paths, readLicense)
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name, "en"))

/** A package's licence file, by the names packages use. */
const readLicenseFile = (dir: string): string | null => {
  const file = fs.readdirSync(dir).find((name) => /^(licen[cs]e|copying)/i.test(name))
  return file === undefined ? null : fs.readFileSync(path.join(dir, file), "utf8").trim()
}

/** Electron ships as the app's runtime, so it's in no one's production dependencies. */
const electronListing = (repoRoot: string): LicenseListing => {
  const dir = path.join(repoRoot, "apps/desktop/node_modules/electron")
  const manifest = fs.readFileSync(path.join(dir, "package.json"), "utf8")
  const { version, ...rest } = Schema.decodeSync(Schema.fromJsonString(PackageManifest))(manifest)
  return { electron: [{ name: "electron", versions: [version], paths: [dir], ...rest }] }
}

/** The app's third-party packages, from the lockfile by way of pnpm. Fails the build rather than ship an empty list. */
export const readThirdPartyNotices = (repoRoot: string): ReadonlyArray<ThirdPartyNotice> => {
  const filters = APP_PACKAGES.map((name) => `--filter ${name}`).join(" ")
  const listing = execSync(`pnpm licenses list --json --prod ${filters}`, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  })
  const packages = Schema.decodeSync(Schema.fromJsonString(LicenseListing))(listing)
  return noticesOf({ ...packages, ...electronListing(repoRoot) }, readLicenseFile)
}
