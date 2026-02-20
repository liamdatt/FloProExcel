import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMcpServerConfig,
  loadEffectiveMcpServers,
  loadManagedMcpServers,
  loadMcpServers,
  saveMcpServers,
  setManagedMcpServerEnabled,
  validateMcpServerUrl,
} from "../src/tools/mcp-config.ts";

class MemorySettingsStore {
  private readonly values = new Map<string, unknown>();

  get(key: string): Promise<unknown> {
    return Promise.resolve(this.values.has(key) ? this.values.get(key) ?? null : null);
  }

  set(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

void test("validateMcpServerUrl accepts http(s) and rejects invalid schemes", () => {
  assert.equal(validateMcpServerUrl("https://example.com/mcp/"), "https://example.com/mcp");
  assert.equal(validateMcpServerUrl("http://localhost:4010"), "http://localhost:4010");
  assert.throws(() => validateMcpServerUrl("ftp://example.com"), /must use http:\/\//);
});

void test("mcp config store round-trips normalized server entries", async () => {
  const settings = new MemorySettingsStore();

  const first = createMcpServerConfig({
    name: "local",
    url: "https://localhost:4010/mcp",
    token: "secret",
  });

  await saveMcpServers(settings, [first]);
  const loaded = await loadMcpServers(settings);

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, "local");
  assert.equal(loaded[0].url, "https://localhost:4010/mcp");
  assert.equal(loaded[0].token, "secret");
  assert.equal(loaded[0].enabled, true);
});

void test("managed MCP servers load with default enabled state", async () => {
  const settings = new MemorySettingsStore();
  const managed = await loadManagedMcpServers(settings, "https://flopro.example");

  assert.equal(managed.length, 1);
  assert.equal(managed[0].source, "managed");
  assert.equal(managed[0].managedId, "jamaica-market");
  assert.equal(managed[0].enabled, true);
  assert.equal(managed[0].url, "https://flopro.example/api/mcp/jamaica-market");
});

void test("managed MCP enabled flags persist separately from custom servers", async () => {
  const settings = new MemorySettingsStore();

  const custom = createMcpServerConfig({
    name: "Custom one",
    url: "https://example.com/mcp",
  });
  await saveMcpServers(settings, [custom]);

  await setManagedMcpServerEnabled({
    settings,
    managedId: "jamaica-market",
    enabled: false,
  });

  const managed = await loadManagedMcpServers(settings, "https://flopro.example");
  assert.equal(managed[0].enabled, false);

  const customLoaded = await loadMcpServers(settings);
  assert.equal(customLoaded.length, 1);
  assert.equal(customLoaded[0].source, "custom");
});

void test("effective MCP list merges managed and custom servers", async () => {
  const settings = new MemorySettingsStore();

  await saveMcpServers(settings, [createMcpServerConfig({
    name: "Custom one",
    url: "https://example.com/mcp",
  })]);

  const effective = await loadEffectiveMcpServers(settings, "https://flopro.example");
  assert.equal(effective.length, 2);
  assert.equal(effective[0].source, "managed");
  assert.equal(effective[1].source, "custom");
});
