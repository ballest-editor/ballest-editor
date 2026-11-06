import { Schema } from "effect"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Catalog } from "../domain/Catalog"

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
export const samplesDir = path.join(repoRoot, "samples")

const catalogPath = path.join(repoRoot, "assets", "catalog.json")

/** Whether the extracted catalog is here, for tests that check it against what the game measured. */
export const hasCatalog = fs.existsSync(catalogPath)

export const readCatalog = (): Catalog =>
  Schema.decodeSync(Schema.fromJsonString(Catalog))(fs.readFileSync(catalogPath, "utf8"))

export interface SampleFile {
  readonly name: string
  readonly path: string
  readonly kind: "balledit" | "ballmap"
}

export const listSamples = (): ReadonlyArray<SampleFile> =>
  (["UserSavedMaps", "Workshop"] as const).flatMap((dir) =>
    fs
      .readdirSync(path.join(samplesDir, dir))
      .filter((name) => name.endsWith(".balledit") || name.endsWith(".ballmap"))
      .sort()
      .map((name) => ({
        name: `${dir}/${name}`,
        path: path.join(samplesDir, dir, name),
        kind: name.endsWith(".balledit") ? "balledit" as const : "ballmap" as const
      }))
  )

export const readSample = (file: SampleFile): string => fs.readFileSync(file.path, "utf8")
