/**
 * Commands that must run inside a user gesture on a DOM element the Editor component owns
 * (the hidden file input). Dialog state lives in the store (`openDialog`); this is only
 * what can't.
 *
 * TODO(menu-bar): a universal menu bar (File / Edit / View / ...) should call these same
 * entry points, e.g. File > Import… -> openImport(), Edit > Settings… -> openDialog("settings").
 */
export const commands = {
  /** Opens the file picker. Registered by the Editor component in an effect. */
  openImport: (): void => {}
}
