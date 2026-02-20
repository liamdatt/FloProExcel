/**
 * Small type guards shared across the app.
 *
 * Keep this file minimal: only add helpers when they are used in multiple places.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
