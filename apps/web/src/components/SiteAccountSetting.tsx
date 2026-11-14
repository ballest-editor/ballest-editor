import type { SiteAccount } from "@ballest/contracts"
import { Button } from "@workspace/ui/components/button"
import { useState } from "react"
import { signInToSite, signOutOfSite } from "../editor/actions"
import type { SettingsCategory } from "../editor/store"
import type { SettingsRow } from "./SettingsShell"

const day = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: "medium" })

function SiteAccountControl({ signedIn }: { readonly signedIn: boolean }) {
  const [signingIn, setSigningIn] = useState(false)
  return signedIn
    ? <Button variant="outline" size="sm" onClick={() => void signOutOfSite()}>Sign out</Button>
    : (
      <Button
        variant="outline"
        size="sm"
        disabled={signingIn}
        onClick={() => {
          setSigningIn(true)
          void signInToSite().finally(() => setSigningIn(false))
        }}
      >
        {signingIn ? "Waiting for the browser…" : "Sign in"}
      </Button>
    )
}

/**
 * Settings › General › ballestrecords.com: whether the player is signed in to the site, until when, and the way in and
 * out. Only uploading needs it, and Upload to ballestrecords.com… asks by itself, so this is where to look it up.
 */
export const siteAccountSettingsRow = (account: SiteAccount): SettingsRow<SettingsCategory> => ({
  id: "siteAccount",
  category: "general",
  label: "ballestrecords.com",
  description: account._tag === "SignedOut"
    ? "Not signed in. Only uploading prefabs needs it."
    : account.remembered
    ? `Signed in until ${day(account.expiresAt)}.`
    : "Signed in until Ballest Editor closes.",
  info: account._tag === "SignedIn" && !account.remembered
    ? "This system has no keystore to keep the sign-in safe, so it isn't kept after the app closes."
    : "Sign-in is with Steam, in the browser. Browsing and placing players' prefabs needs none.",
  keywords: "account steam login sign in sign out upload prefabs",
  control: <SiteAccountControl signedIn={account._tag === "SignedIn"} />
})
