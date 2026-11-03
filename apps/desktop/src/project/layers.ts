import { Effect, Layer } from "effect"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { Backups } from "./Backups"
import { MapExports } from "./MapExports"
import { MapFiles } from "./MapFiles"
import { MapLinks } from "./MapLinks"
import { Projects } from "./Projects"

/**
 * `Projects`, `MapFiles` and `MapExports` over the given folders (`exportBackups` keeps what Export wrote over), and
 * over one `MapLinks` and one `Backups`: each runs its writes one at a time, so the three must share them.
 */
export const layerProjectsAt = (projectsFolder: string, platform: NodeJS.Platform, exportBackups: string) =>
  Layer.effect(MapExports, MapExports.make(platform, exportBackups)).pipe(
    Layer.provideMerge(Layer.effect(MapFiles, MapFiles.make(platform, exportBackups))),
    Layer.provideMerge(Layer.effect(Projects, Projects.make(projectsFolder, platform))),
    Layer.provide(Layer.mergeAll(MapLinks.layer, Backups.layer))
  )

/** `layerProjectsAt` the folders `DesktopEnvironment` names. */
export const layerProjects = Layer.unwrap(
  Effect.gen(function*() {
    const { projectsDir, platform, exportBackupsDir } = yield* DesktopEnvironment
    return layerProjectsAt(projectsDir, platform, exportBackupsDir)
  })
)
