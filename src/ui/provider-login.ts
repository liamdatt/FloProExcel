/**
 * Provider login UI retired in managed OpenRouter mode.
 */

export interface ProviderDef {
  id: string;
  label: string;
  oauth?: string;
  desc?: string;
}

export const ALL_PROVIDERS: ProviderDef[] = [];

export interface ProviderRowCallbacks {
  onConnected: (row: HTMLElement, id: string, label: string) => void;
  onDisconnected?: (row: HTMLElement, id: string, label: string) => void;
}

export function buildProviderRow(_provider: ProviderDef, _callbacks: ProviderRowCallbacks & {
  isActive: boolean;
  expandedRef: { current: HTMLElement | null };
}): HTMLElement {
  const row = document.createElement("div");
  row.className = "pi-provider-row";
  row.textContent = "Provider login is disabled in managed mode.";
  return row;
}
