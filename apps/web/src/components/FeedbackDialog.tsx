import { FEEDBACK_MESSAGE_LIMIT, FEEDBACK_NAME_LIMIT } from "@ballest/contracts"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import { useState } from "react"
import { usableCreatorName } from "../domain/creator"
import { sendFeedback } from "../editor/actions"
import { type FeedbackKind, useCreator } from "../editor/store"
import { useOnOpen } from "./useOnOpen"

/** Each kind as the form offers it; the issue gets its label. */
const KINDS: Readonly<Record<FeedbackKind, string>> = {
  bug: "Something's broken",
  mismatch: "Looks different in the game",
  idea: "An idea",
  other: "Something else"
}

/**
 * Help › Send feedback (desktop): what kind, the message, and optionally who to reply to. The message becomes a public
 * GitHub issue, which the form says; the Discord and creator names go to the maintainer only. A failed send keeps the
 * form as it was, so nothing typed is lost.
 */
export function FeedbackDialog({ open, onClose }: { readonly open: boolean; readonly onClose: () => void }) {
  const creator = usableCreatorName(useCreator()).slice(0, FEEDBACK_NAME_LIMIT)
  const [kind, setKind] = useState<FeedbackKind>("bug")
  const [message, setMessage] = useState("")
  const [discord, setDiscord] = useState("")
  const [creatorName, setCreatorName] = useState(creator)
  const [sending, setSending] = useState(false)
  // A sent form starts again empty; one closed unsent keeps its text for the next time it opens.
  useOnOpen(open, () => {
    if (message === "") setCreatorName(creator)
  })

  const trimmed = message.trim()
  const canSend = trimmed !== "" && message.length <= FEEDBACK_MESSAGE_LIMIT && !sending
  const optional = (text: string) => text.trim() === "" ? null : text.trim()
  const submit = async () => {
    setSending(true)
    const sent = await sendFeedback({
      kind,
      message: trimmed,
      discord: optional(discord),
      creator: optional(creatorName)
    })
    setSending(false)
    if (!sent) return
    setMessage("")
    setKind("bug")
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSend) void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>
              Your message becomes a public issue on GitHub that anyone can read. Leave out anything private.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feedback-kind">What is it about?</Label>
            <Select value={kind} items={KINDS} onValueChange={(v: FeedbackKind | null) => v !== null && setKind(v)}>
              <SelectTrigger id="feedback-kind" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries<string>(KINDS).map(([id, label]) => <SelectItem key={id} value={id}>{label}
                </SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="feedback-message">Message</Label>
              <span
                className={message.length > FEEDBACK_MESSAGE_LIMIT
                  ? "text-caption text-destructive"
                  : "text-caption text-fg-tertiary"}
              >
                {message.length.toLocaleString()} / {FEEDBACK_MESSAGE_LIMIT.toLocaleString()}
              </span>
            </div>
            <Textarea
              id="feedback-message"
              autoFocus
              rows={6}
              value={message}
              aria-invalid={message.length > FEEDBACK_MESSAGE_LIMIT}
              placeholder="What happened, and what you expected. For a map, say which piece."
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feedback-discord">Discord name (optional)</Label>
              <Input
                id="feedback-discord"
                maxLength={FEEDBACK_NAME_LIMIT}
                value={discord}
                onChange={(e) => setDiscord(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feedback-creator">Creator name (optional)</Label>
              <Input
                id="feedback-creator"
                maxLength={FEEDBACK_NAME_LIMIT}
                value={creatorName}
                onChange={(e) => setCreatorName(e.target.value)}
              />
            </div>
          </div>
          <p className="text-caption text-fg-tertiary">
            Your Discord and creator names aren't published: only the maintainer sees them, to reply to you. The app's
            version and your operating system go with the message.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!canSend}>{sending ? "Sending…" : "Send"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
