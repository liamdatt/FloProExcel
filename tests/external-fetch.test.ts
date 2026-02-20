import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getEnabledProxyBaseUrl,
  resolveOutboundRequestUrl,
  type ProxyAwareSettingsStore,
} from "../src/tools/external-fetch.ts";

class MemorySettingsStore implements ProxyAwareSettingsStore {
  private readonly values = new Map<string, unknown>();

  get(key: string): Promise<unknown> {
    const value = this.values.has(key) ? this.values.get(key) ?? null : null;
    return Promise.resolve(value);
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

void test("getEnabledProxyBaseUrl falls back to localhost:3003 when enabled and URL missing", async () => {
  const settings = new MemorySettingsStore();
  settings.set("proxy.enabled", true);

  const proxyUrl = await getEnabledProxyBaseUrl(settings);
  assert.equal(proxyUrl, "https://localhost:3003");
});

void test("getEnabledProxyBaseUrl ignores proxy URL when disabled", async () => {
  const settings = new MemorySettingsStore();
  settings.set("proxy.enabled", false);
  settings.set("proxy.url", "https://localhost:3004");

  const proxyUrl = await getEnabledProxyBaseUrl(settings);
  assert.equal(proxyUrl, undefined);
});

void test("resolveOutboundRequestUrl wraps target URL when proxy is enabled", () => {
  const resolved = resolveOutboundRequestUrl({
    targetUrl: "https://example.com/resource?q=1",
    proxyBaseUrl: "https://localhost:3003",
  });

  assert.equal(resolved.proxied, true);
  assert.equal(
    resolved.requestUrl,
    "https://localhost:3003/?url=https%3A%2F%2Fexample.com%2Fresource%3Fq%3D1",
  );
});
