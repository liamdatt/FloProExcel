import type { Context, Tool } from "@mariozechner/pi-ai";

import { type CoreToolName, CORE_TOOL_NAMES } from "../tools/names.js";
import {
  chooseToolDisclosureBundle,
  filterToolsForDisclosureBundle,
  type ToolDisclosureBundleId,
} from "../tools/capabilities.js";

export type ToolBundleId = ToolDisclosureBundleId;

type UserMessage = Extract<Context["messages"][number], { role: "user" }>;

const CORE_TOOL_NAME_SET = new Set<string>(CORE_TOOL_NAMES);

function isCoreToolName(name: string): name is CoreToolName {
  return CORE_TOOL_NAME_SET.has(name);
}

function hasOnlyCoreTools(tools: readonly Tool[]): boolean {
  for (const tool of tools) {
    if (!isCoreToolName(tool.name)) return false;
  }
  return true;
}

function extractUserText(content: UserMessage["content"]): string {
  if (typeof content === "string") return content;

  const textParts: string[] = [];
  for (const item of content) {
    if (item.type === "text") {
      textParts.push(item.text);
    }
  }

  return textParts.join(" ");
}

function getLastUserPrompt(messages: Context["messages"]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;

    const text = extractUserText(message.content).trim();
    if (text.length === 0) continue;

    if (text.startsWith("[Auto-context]")) continue;
    return text.toLowerCase();
  }

  return null;
}

export interface ToolDisclosureResult {
  tools: Context["tools"];
  bundleId: ToolBundleId;
}

/**
 * Select a deterministic tool bundle for the current call.
 *
 * Rules:
 * - Only applies to the core built-in tool set.
 * - If extension/non-core tools are present, keep full tool visibility.
 * - Selection is based on the latest non-auto user prompt.
 */
export function selectToolBundle(context: Context): ToolDisclosureResult {
  if (!context.tools || context.tools.length === 0) {
    return { tools: context.tools, bundleId: "none" };
  }

  if (!hasOnlyCoreTools(context.tools)) {
    return { tools: context.tools, bundleId: "full" };
  }

  const prompt = getLastUserPrompt(context.messages);
  const bundleId = prompt ? chooseToolDisclosureBundle(prompt) : "core";
  const tools = filterToolsForDisclosureBundle(context.tools, bundleId);
  return { tools, bundleId };
}
