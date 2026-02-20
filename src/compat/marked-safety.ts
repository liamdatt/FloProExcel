/**
 * Marked/Markdown safety hardening.
 *
 * pi-web-ui uses <markdown-block> (from @mariozechner/mini-lit), which:
 * - parses markdown via `marked`
 * - renders HTML via Lit's `unsafeHTML`
 * - escapes raw HTML tags in the input (good)
 *
 * Remaining risks we harden here:
 * - `javascript:` / `data:` links in markdown
 * - automatic network requests via markdown images: ![alt](https://...)
 *
 * We patch marked's Renderer prototype once at boot.
 */

import { marked, type Tokens } from "marked";

import {
  createMarkdownImageRenderPlan,
  isAllowedMarkdownUrl,
} from "./marked-safety-policy.js";
import { escapeAttr, escapeHtml } from "../utils/html.js";

let installed = false;

export function installMarkedSafetyPatch(): void {
  if (installed) return;
  installed = true;

  // Defensive: marked's types are permissive, but we still narrow token shapes.
  const rendererProto = marked.Renderer.prototype;

  const originalLink = rendererProto.link;
  rendererProto.link = function patchedLink(token: Tokens.Link): string {
    const href = typeof token.href === "string" ? token.href : "";

    // Block javascript:, data:, file:, etc.
    if (!isAllowedMarkdownUrl(href)) {
      // Render as plain text (do not emit a link tag).
      // token.text may contain nested markdown that is already rendered elsewhere;
      // here we keep it simple and escape.
      const text = typeof token.text === "string" && token.text.trim().length > 0
        ? token.text
        : href;
      return escapeHtml(text);
    }

    return originalLink.call(this, token);
  };

  rendererProto.image = function patchedImage(token: Tokens.Image): string {
    const href = typeof token.href === "string" ? token.href : "";
    const alt = typeof token.text === "string" ? token.text : "";

    // SECURITY: never render <img> from markdown.
    // Inline images cause automatic network requests which can be used for tracking
    // or exfiltration (e.g. embedding sensitive context into an image URL).
    // We instead render a regular link (click-to-open) or plain text fallback.
    const plan = createMarkdownImageRenderPlan(href, alt);
    if (plan.kind === "link") {
      return `<a href="${escapeAttr(plan.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(plan.label)}</a>`;
    }

    return escapeHtml(plan.label);

    // Note: we intentionally do NOT call originalImage.
    // return originalImage.call(this, token);
  };
}
