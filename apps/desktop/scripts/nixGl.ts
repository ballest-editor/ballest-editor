// A prebuilt Electron opens the system's GL at runtime: libEGL.so.1 on Wayland, libGL.so.1 on X11. NixOS has neither
// where the binary looks, since nix-ld's default libraries hold Mesa's drivers but not libglvnd, the loader in front of
// them. Without it the GPU process exits and the editor gets no WebGL, so the launchers put the flake's libglvnd on the
// library path. An AppImage doesn't need this: appimage-run provides its own /usr/lib.
import * as fs from "node:fs"
import * as path from "node:path"

const libraryPaths = (env: NodeJS.ProcessEnv) =>
  [env["LD_LIBRARY_PATH"], env["NIX_LD_LIBRARY_PATH"]].flatMap((list) => list?.split(":") ?? [])

/**
 * What to add to Electron's environment on NixOS. Nothing when the system already provides libEGL.so.1, or when
 * `buildLibglvnd` (which returns the store path) fails: the app still opens, without WebGL, so that's only a warning.
 */
export const nixGlEnv = (env: NodeJS.ProcessEnv, buildLibglvnd: () => string): NodeJS.ProcessEnv => {
  if (libraryPaths(env).some((dir) => fs.existsSync(path.join(dir, "libEGL.so.1")))) return {}
  try {
    const libraryPath = [path.join(buildLibglvnd(), "lib"), env["LD_LIBRARY_PATH"]].filter(Boolean).join(":")
    return { LD_LIBRARY_PATH: libraryPath }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(
      `[electron] no libEGL.so.1 and couldn't build the flake's libglvnd, so the editor won't have WebGL: ${reason}\n` +
        "[electron] Enable flakes, or add libglvnd to programs.nix-ld.libraries."
    )
    return {}
  }
}
