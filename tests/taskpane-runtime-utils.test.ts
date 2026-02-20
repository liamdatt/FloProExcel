import assert from "node:assert/strict";
import { test } from "node:test";

import {
  awaitWithTimeout,
  isLikelyCorsErrorMessage,
  normalizeRuntimeTools,
} from "../src/taskpane/runtime-utils.ts";
import {
  NoActionRetryBudget,
  NO_ACTION_RETRY_MESSAGE,
  hasTrailingNoActionRetryMarker,
  isNoActionAssistantTurn,
} from "../src/taskpane/no-action-retry.ts";
import {
  applyNoActionRetryStreamOptions,
  normalizeManagedBaseUrl,
} from "../src/auth/stream-proxy.ts";

function createAssistantThinkingOnly() {
  return {
    role: "assistant" as const,
    content: [{ type: "thinking" as const, thinking: "Plan the next action" }],
    api: "openai-completions" as const,
    provider: "openrouter",
    model: "openai/gpt-5.2-codex",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

void test("isLikelyCorsErrorMessage detects known cors/network signatures", () => {
  assert.equal(isLikelyCorsErrorMessage("Failed to fetch"), true);
  assert.equal(isLikelyCorsErrorMessage("Load failed"), true);
  assert.equal(isLikelyCorsErrorMessage("CORS requests are not allowed"), true);
  assert.equal(isLikelyCorsErrorMessage("Cross-Origin policy blocked request"), true);
  assert.equal(isLikelyCorsErrorMessage("provider overloaded"), false);
});

void test("normalizeRuntimeTools drops invalid and duplicate entries", () => {
  const firstTool = {
    name: "alpha",
    label: "Alpha",
    description: "alpha tool",
    parameters: { type: "object", properties: {} },
    execute: () => ({ content: [{ type: "text", text: "ok" }] }),
  };

  const duplicateByName = {
    name: "alpha",
    label: "Alpha duplicate",
    description: "duplicate",
    parameters: { type: "object", properties: {} },
    execute: () => ({ content: [{ type: "text", text: "dup" }] }),
  };

  const invalid = {
    name: "missing-execute",
    label: "Invalid",
    description: "invalid",
    parameters: { type: "object", properties: {} },
  };

  const normalized = normalizeRuntimeTools([
    invalid,
    firstTool,
    duplicateByName,
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0]?.name, "alpha");
  assert.equal(normalized[0]?.description, "alpha tool");
});

void test("awaitWithTimeout resolves when task finishes in time", async () => {
  const value = await awaitWithTimeout("quick task", 50, Promise.resolve("ok"));
  assert.equal(value, "ok");
});

void test("awaitWithTimeout rejects with label on timeout", async () => {
  await assert.rejects(
    awaitWithTimeout(
      "slow task",
      5,
      new Promise<string>(() => {
        // Never resolves; timeout controls completion.
      }),
    ),
    /slow task timed out after 5ms/,
  );
});

void test("no-action budget allows exactly one retry per user turn", () => {
  const budget = new NoActionRetryBudget();

  budget.beginUserTurn({
    role: "user",
    content: "Build a three-statement model",
    timestamp: 1,
  });

  assert.equal(budget.consumeRetry(), true);
  assert.equal(budget.consumeRetry(), false);

  budget.beginUserTurn({
    role: "user",
    content: NO_ACTION_RETRY_MESSAGE,
    timestamp: 2,
  });
  assert.equal(budget.consumeRetry(), false);

  budget.beginUserTurn({
    role: "user",
    content: "Now run quality check",
    timestamp: 3,
  });
  assert.equal(budget.consumeRetry(), true);
});

void test("isNoActionAssistantTurn detects thinking-only assistant turns", () => {
  const assistant = createAssistantThinkingOnly();
  assert.equal(isNoActionAssistantTurn({ message: assistant, toolResults: [] }), true);
  assert.equal(
    isNoActionAssistantTurn({
      message: {
        ...assistant,
        content: [...assistant.content, { type: "text", text: "Done." }],
      },
      toolResults: [],
    }),
    false,
  );
  assert.equal(
    isNoActionAssistantTurn({
      message: assistant,
      toolResults: [{
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read_range",
        content: [{ type: "text", text: "ok" }],
        isError: false,
        timestamp: 1,
      }],
    }),
    false,
  );
});

void test("retry stream options force toolChoice=required and low reasoning", () => {
  const options = applyNoActionRetryStreamOptions({
    temperature: 0.4,
  });

  assert.equal(options.toolChoice, "required");
  assert.equal(options.reasoning, "low");
  assert.equal(options.temperature, 0.4);
});

void test("hasTrailingNoActionRetryMarker ignores auto-context tail messages", () => {
  const hasMarker = hasTrailingNoActionRetryMarker([
    {
      role: "user",
      content: NO_ACTION_RETRY_MESSAGE,
      timestamp: 1,
    },
    {
      role: "user",
      content: "[Auto-context] Workbook snapshot",
      timestamp: 2,
    },
  ]);

  assert.equal(hasMarker, true);
});

void test("normalizeManagedBaseUrl resolves same-origin path and rejects invalid schemes", () => {
  const absolute = normalizeManagedBaseUrl("/api/openrouter/v1", {
    browserOrigin: "https://flo.pro",
  });
  assert.equal(absolute, "https://flo.pro/api/openrouter/v1");

  assert.throws(
    () => normalizeManagedBaseUrl("file:///tmp/openrouter"),
    /must be http\(s\) or same-origin path/,
  );
});
