import { createCn } from "cn/config"

/**
 * `cn` taught the system's scales (globals.css). Out of the box it takes `text-caption` for a colour and drops it beside
 * `text-fg-tertiary`, and doesn't see that `rounded-control` and `p-dialog` replace `rounded-md` and `p-4`.
 */
export const cn = createCn({
  extend: {
    theme: {
      radius: ["control", "surface"],
      spacing: ["dialog"],
      text: ["caption", "body", "body-strong", "title"]
    }
  }
})
