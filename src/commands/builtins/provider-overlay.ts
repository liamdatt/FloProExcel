/**
 * Provider picker alias.
 *
 * Managed access now lives under Settings → Access.
 */

export async function showProviderPicker(): Promise<void> {
  const { showSettingsDialog } = await import("./settings-overlay.js");
  await showSettingsDialog({ section: "providers" });
}
