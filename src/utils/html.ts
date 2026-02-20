/**
 * HTML escaping helpers.
 *
 * Use whenever we must interpolate dynamic text into `innerHTML`.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(text: string): string {
  // Attribute context escape: also escape backticks.
  return escapeHtml(text).replace(/`/g, "&#96;");
}
