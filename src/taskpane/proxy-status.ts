/**
 * Proxy status polling retired in managed backend mode.
 */

export type ProxyState = "detected" | "not-detected" | "unknown";

export function getProxyState(): ProxyState {
  return "unknown";
}

interface ProxySettingsReader {
  get<T>(key: string): Promise<T | null>;
}

export function checkProxyOnce(_settings: ProxySettingsReader): Promise<ProxyState> {
  return Promise.resolve("unknown");
}

export function startProxyPolling(_settings: ProxySettingsReader): () => void {
  return () => {};
}
