/** One third-party package in the app, as Help › About › Open-source licences lists it. */
export interface ThirdPartyNotice {
  readonly name: string
  /** Every version in the lockfile, comma-separated. */
  readonly version: string
  /** The SPDX expression from its `package.json`. */
  readonly license: string
  readonly author: string | null
  readonly homepage: string | null
  /** Its licence file as published; null when the package has none. */
  readonly text: string | null
}
