import { createCn } from "cn/config"

/**
 * `cn` taught the system's scales (globals.css). Out of the box it takes `text-caption` for a colour and drops it beside
 * `text-fg-tertiary`, and doesn't see that `rounded-control` and `p-dialog` replace Tailwind's own radii and spacing.
 */
export const cn = createCn({
  extend: {
    theme: {
      radius: ["control", "surface", "sheet"],
      spacing: ["dialog"],
      text: ["caption", "label", "body", "body-strong", "title"]
    }
  }
})
