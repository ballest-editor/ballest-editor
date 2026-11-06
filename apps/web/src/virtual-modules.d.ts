/** The modules `buildFacts` makes (apps/web/build/buildFacts.ts). */
declare module "virtual:build-info" {
  export const buildInfo: { readonly commit: string; readonly builtAt: string }
}

declare module "virtual:third-party-notices" {
  import type { ThirdPartyNotice } from "@/domain/thirdPartyNotice"

  export const notices: ReadonlyArray<ThirdPartyNotice>
}
