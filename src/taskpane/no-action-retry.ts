import type { Context, ToolResultMessage } from "@mariozechner/pi-ai";

import { isRecord } from "../utils/type-guards.js";

export const NO_ACTION_RETRY_MARKER = "[Auto-retry:no-action]";
export const NO_ACTION_RETRY_MESSAGE =
  `${NO_ACTION_RETRY_MARKER} Execute with tool calls now; do not stop at analysis.`;

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const textParts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item.type !== "text") continue;
    if (typeof item.text !== "string") continue;
    textParts.push(item.text);
  }

  return textParts.join(" ");
}

function isUserMessage(message: unknown): boolean {
  if (!isRecord(message)) return false;
  if (typeof message.role !== "string") return false;
  return message.role === "user" || message.role === "user-with-attachments";
}

function isAssistantMessage(message: unknown): boolean {
  return isRecord(message)
    && typeof message.role === "string"
    && message.role === "assistant";
}

function getMessageContent(message: unknown): unknown {
  if (!isRecord(message)) return undefined;
  return message.content;
}

function hasThinkingContent(message: unknown): boolean {
  const content = getMessageContent(message);
  if (!Array.isArray(content)) return false;

  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item.type !== "thinking") continue;
    if (typeof item.thinking !== "string") continue;
    if (item.thinking.trim().length > 0) return true;
  }

  return false;
}

function hasActionableAssistantContent(message: unknown): boolean {
  const content = getMessageContent(message);
  if (!Array.isArray(content)) return false;

  for (const item of content) {
    if (!isRecord(item)) continue;

    if (item.type === "toolCall") {
      return true;
    }

    if (item.type === "text" && typeof item.text === "string" && item.text.trim().length > 0) {
      return true;
    }
  }

  return false;
}

export function isNoActionRetryMarkerText(text: string): boolean {
  return text.trim().startsWith(NO_ACTION_RETRY_MARKER);
}

export function isNoActionRetryUserMessage(message: unknown): boolean {
  if (!isUserMessage(message)) return false;
  const text = extractTextContent(getMessageContent(message));
  return isNoActionRetryMarkerText(text);
}

function isAutoContextUserMessage(message: unknown): boolean {
  if (!isUserMessage(message)) return false;
  const text = extractTextContent(getMessageContent(message)).trim();
  return text.startsWith("[Auto-context]");
}

export function hasTrailingNoActionRetryMarker(messages: Context["messages"]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;

    const text = extractTextContent(message.content).trim();
    if (text.length === 0) continue;
    if (text.startsWith("[Auto-context]")) continue;

    return isNoActionRetryMarkerText(text);
  }

  return false;
}

export function isNoActionAssistantTurn(args: {
  message: unknown;
  toolResults?: readonly ToolResultMessage[];
}): boolean {
  const { message, toolResults } = args;
  if (!isAssistantMessage(message)) return false;
  if (!hasThinkingContent(message)) return false;
  if (hasActionableAssistantContent(message)) return false;

  if (Array.isArray(toolResults) && toolResults.length > 0) {
    return false;
  }

  if (
    isRecord(message)
    && (message["stopReason"] === "error" || message["stopReason"] === "aborted")
  ) {
    return false;
  }

  return true;
}

export class NoActionRetryBudget {
  private retriesRemaining = 0;

  beginUserTurn(message: unknown): void {
    if (!isUserMessage(message)) return;
    if (isAutoContextUserMessage(message)) return;
    if (isNoActionRetryUserMessage(message)) return;
    this.retriesRemaining = 1;
  }

  consumeRetry(): boolean {
    if (this.retriesRemaining <= 0) return false;
    this.retriesRemaining = 0;
    return true;
  }

  get remaining(): number {
    return this.retriesRemaining;
  }
}
