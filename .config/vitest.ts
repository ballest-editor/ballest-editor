/**
 * Test settings every package's vitest config shares. Other agents share the machine, so a local run takes at most 4
 * workers instead of one per core; `pnpm check:changed` passes the share its budget grants (`--maxWorkers`), which
 * wins over this. CI keeps vitest's default.
 */
export const sharedTest = process.env["CI"] === undefined ? { maxWorkers: 4 } : {}
