import assert from "node:assert/strict";
import { test } from "node:test";

import { createJamaicaMarketTool } from "../src/tools/jamaica-market.ts";

const MANAGED_SERVER = {
  id: "mcp-managed-jamaica-market",
  name: "Jamaica Market Data",
  url: "https://flopro.example/api/mcp/jamaica-market",
  enabled: true,
  source: "managed" as const,
  managedId: "jamaica-market" as const,
};

void test("jamaica_market maps actions to managed jm_* calls with normalization", async () => {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const tool = createJamaicaMarketTool({
    getRuntimeConfig: () => Promise.resolve({
      server: MANAGED_SERVER,
    }),
    callJsonRpc: ({ method, params }) => {
      calls.push({ method, params });
      return Promise.resolve({
        payload: {
          result: {
            content: [{ type: "text", text: "ok" }],
            structuredContent: { ok: true },
          },
        },
        durationMs: 12,
      });
    },
  });

  await tool.execute("a1", {
    action: "get_statement",
    symbol: "gk",
    frequency: "annual",
    statement_type: "is",
    year: 2024,
  });

  await tool.execute("a2", {
    action: "get_price_data",
    symbol: "ncbfg",
    start_date: "2025-01-01",
    end_date: "2025-01-31",
  });

  const call1 = calls[0];
  assert.equal(call1?.method, "tools/call");
  assert.deepEqual(call1?.params, {
    name: "jm_get_statement",
    arguments: {
      symbol: "GK",
      frequency: "Annual",
      statement_type: "IS",
      year: 2024,
    },
  });

  const call2 = calls[1];
  assert.equal(call2?.method, "tools/call");
  assert.deepEqual(call2?.params, {
    name: "jm_get_price_data",
    arguments: {
      symbol: "NCBFG",
      start_date: "2025-01-01",
      end_date: "2025-01-31",
    },
  });
});

void test("jamaica_market supports object output with summary + structured content", async () => {
  const tool = createJamaicaMarketTool({
    getRuntimeConfig: () => Promise.resolve({
      server: MANAGED_SERVER,
    }),
    callJsonRpc: () => Promise.resolve({
      payload: {
        result: {
          content: [{ type: "text", text: "returned 2 records" }],
          structuredContent: [{ symbol: "GK" }, { symbol: "NCBFG" }],
        },
      },
      durationMs: 8,
    }),
  });

  const result = await tool.execute("a3", {
    action: "list_companies",
    limit: 2,
  });
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";

  assert.match(text, /Summary:/);
  assert.match(text, /Structured content:/);
  assert.match(text, /GK/);
});

void test("jamaica_market returns clear error when managed server is disabled", async () => {
  let called = false;
  const tool = createJamaicaMarketTool({
    getRuntimeConfig: () => Promise.resolve({
      server: {
        ...MANAGED_SERVER,
        enabled: false,
      },
    }),
    callJsonRpc: () => {
      called = true;
      return Promise.resolve({
        payload: {},
        durationMs: 0,
      });
    },
  });

  const result = await tool.execute("a4", {
    action: "get_company",
    symbol: "GK",
  });
  const text = result.content[0]?.type === "text" ? result.content[0].text : "";

  assert.match(text, /disabled/i);
  assert.equal(called, false);
});
