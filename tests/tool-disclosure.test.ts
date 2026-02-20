import assert from "node:assert/strict";
import { test } from "node:test";

import type { Context, Tool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

import { selectToolBundle } from "../src/context/tool-disclosure.ts";
import { TOOL_DISCLOSURE_BUNDLES } from "../src/tools/capabilities.ts";
import { CORE_TOOL_NAMES } from "../src/tools/names.ts";

function createTool(name: string): Tool {
  return {
    name,
    description: `${name} tool`,
    parameters: Type.Object({}),
  };
}

function createContext(args: {
  prompt?: string;
  tools?: readonly Tool[];
  includeAutoContextMessage?: boolean;
}): Context {
  const messages: Context["messages"] = [];

  if (args.prompt) {
    messages.push({
      role: "user",
      content: args.prompt,
      timestamp: 1,
    });
  }

  if (args.includeAutoContextMessage) {
    messages.push({
      role: "user",
      content: "[Auto-context] Workbook snapshot",
      timestamp: 2,
    });
  }

  return {
    messages,
    tools: args.tools ? [...args.tools] : undefined,
  };
}

function createCoreToolSet(): Tool[] {
  return CORE_TOOL_NAMES.map((name) => createTool(name));
}

void test("selectToolBundle chooses formatting bundle for formatting intents", () => {
  const context = createContext({
    prompt: "Please format this table with borders and color.",
    tools: createCoreToolSet(),
  });

  const result = selectToolBundle(context);

  assert.equal(result.bundleId, "formatting");
  assert.deepEqual(
    result.tools?.map((tool) => tool.name),
    [...TOOL_DISCLOSURE_BUNDLES.formatting],
  );
});

void test("selectToolBundle chooses analysis bundle for dependency intents", () => {
  const context = createContext({
    prompt: "Trace precedents and explain this formula.",
    tools: createCoreToolSet(),
  });

  const result = selectToolBundle(context);

  assert.equal(result.bundleId, "analysis");
  assert.deepEqual(
    result.tools?.map((tool) => tool.name),
    [...TOOL_DISCLOSURE_BUNDLES.analysis],
  );
});

void test("selectToolBundle falls back to full for mixed-intent prompts", () => {
  const context = createContext({
    prompt: "Insert a row and add a comment on it.",
    tools: createCoreToolSet(),
  });

  const result = selectToolBundle(context);

  assert.equal(result.bundleId, "full");
  assert.deepEqual(
    result.tools?.map((tool) => tool.name),
    [...CORE_TOOL_NAMES],
  );
});

void test("selectToolBundle keeps full tools when non-core tools are present", () => {
  const tools = [...createCoreToolSet(), createTool("web_search")];
  const context = createContext({
    prompt: "Please search the web for this data.",
    tools,
  });

  const result = selectToolBundle(context);

  assert.equal(result.bundleId, "full");
  assert.deepEqual(result.tools?.map((tool) => tool.name), tools.map((tool) => tool.name));
});

void test("selectToolBundle ignores trailing auto-context user messages", () => {
  const context = createContext({
    prompt: "Comment on this range.",
    tools: createCoreToolSet(),
    includeAutoContextMessage: true,
  });

  const result = selectToolBundle(context);

  assert.equal(result.bundleId, "comments");
  assert.deepEqual(
    result.tools?.map((tool) => tool.name),
    [...TOOL_DISCLOSURE_BUNDLES.comments],
  );
});
