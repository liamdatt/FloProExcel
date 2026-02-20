/**
 * Welcome/login overlay is retired for managed OpenRouter mode.
 */

import type { ProviderKeysStore } from "@mariozechner/pi-web-ui/dist/storage/stores/provider-keys-store.js";

export async function showWelcomeLogin(_providerKeys: ProviderKeysStore): Promise<void> {
  // Managed mode: no per-user provider onboarding.
}
