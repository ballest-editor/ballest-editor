import { Effect, Layer, type Option } from "effect"
import { DesktopEnvironment } from "../app/DesktopEnvironment"
import { Backups } from "./Backups"
import { MapExports } from "./MapExports"
import { MapFiles } from "./MapFiles"
import { MapLinks } from "./MapLinks"
import { Prefabs } from "./Prefabs"
import { Projects } from "./Projects"

/**
 * `Projects`, `MapFiles`, `Prefabs` and `MapExports` over the given folders (`exportBackups` keeps what Export wrote
 * over), and over one `MapLinks` and one `Backups`: each runs its writes one at a time, so they must share them.
 * `launchProject` is the `--project` the window was started with.
 */
export const layerProjectsAt = (
  projectsFolder: string,
  platform: NodeJS.Platform,
  exportBackups: string,
  launchProject?: Option.Option<string>
) =>
  Layer.effect(MapExports, MapExports.make(platform, exportBackups)).pipe(
    Layer.provideMerge(Layer.effect(MapFiles, MapFiles.make(platform, exportBackups))),
    Layer.provideMerge(Layer.effect(Prefabs, Prefabs.make(exportBackups))),
    Layer.provideMerge(Layer.effect(Projects, Projects.make(projectsFolder, platform, launchProject))),
    Layer.provide(Layer.mergeAll(MapLinks.layer, Backups.layer))
  )

/** `layerProjectsAt` the folders `DesktopEnvironment` names. */
export const layerProjects = Layer.unwrap(
  Effect.gen(function*() {
    const { projectsDir, platform, exportBackupsDir, launchProject } = yield* DesktopEnvironment
    return layerProjectsAt(projectsDir, platform, exportBackupsDir, launchProject)
  })
)
