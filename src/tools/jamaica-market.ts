/**
 * jamaica_market — managed Jamaica market data access via same-origin MCP JSON-RPC.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type, type TSchema } from "@sinclair/typebox";

import { integrationsCommandHint } from "../integrations/naming.js";
import { getErrorMessage } from "../utils/errors.js";
import { runWithTimeoutAbort } from "../utils/network.js";
import { isRecord } from "../utils/type-guards.js";
import {
  loadManagedMcpServers,
  type McpConfigStore,
  type McpServerConfig,
} from "./mcp-config.js";

const JAMAICA_MARKET_TIMEOUT_MS = 15_000;
const JAMAICA_MANAGED_SERVER_ID = "jamaica-market";

const ACTION_VALUES = [
  "list_companies",
  "get_company",
  "get_statement",
  "get_all_statements",
  "get_price_data",
] as const;

type JamaicaMarketAction = (typeof ACTION_VALUES)[number];

function StringEnum<T extends readonly string[]>(
  values: T,
  opts?: { description?: string },
) {
  return Type.Union(values.map((value) => Type.Literal(value)), opts);
}

const schema = Type.Object({
  action: StringEnum(ACTION_VALUES, {
    description: "Managed Jamaica market operation to run.",
  }),
  symbol: Type.Optional(Type.String({
    description: "Ticker symbol (for example GK).",
  })),
  frequency: Type.Optional(Type.String({
    description: "Annual or Quarterly.",
  })),
  statement_type: Type.Optional(Type.String({
    description: "IS, BS, or CF.",
  })),
  year: Type.Optional(Type.Integer({
    minimum: 1990,
    maximum: 2100,
  })),
  years: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 10,
  })),
  start_date: Type.Optional(Type.String({
    description: "YYYY-MM-DD",
  })),
  end_date: Type.Optional(Type.String({
    description: "YYYY-MM-DD",
  })),
  limit: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: 500,
  })),
}, {
  additionalProperties: false,
});

interface Params {
  action: JamaicaMarketAction;
  symbol?: string;
  frequency?: string;
  statement_type?: string;
  year?: number;
  years?: number;
  start_date?: string;
  end_date?: string;
  limit?: number;
}

export interface JamaicaMarketDetails {
  kind: "jamaica_market";
  ok: boolean;
  action: JamaicaMarketAction;
  toolName?: string;
  rpcMethod?: string;
  durationMs?: number;
  errorCode?: number;
  retryApplied?: boolean;
  resultPreview?: string;
  error?: string;
}

interface RpcCallResult {
  payload: unknown;
  durationMs: number;
}

interface JamaicaMarketRuntimeConfig {
  server: McpServerConfig;
}

export interface JamaicaMarketToolDependencies {
  getRuntimeConfig?: () => Promise<JamaicaMarketRuntimeConfig>;
  callJsonRpc?: (args: {
    server: McpServerConfig;
    method: string;
    params?: unknown;
    signal: AbortSignal | undefined;
  }) => Promise<RpcCallResult>;
}

class JsonRpcCallError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "JsonRpcCallError";
    this.code = code;
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstLine(value: string): string {
  const line = value.split("\n")[0] ?? value;
  return line.length > 220 ? `${line.slice(0, 217)}…` : line;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeSymbol(symbol: unknown): string {
  if (typeof symbol !== "string") {
    throw new Error("symbol must be a string.");
  }

  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,20}$/u.test(normalized)) {
    throw new Error("symbol must contain only letters, digits, dot, or dash.");
  }

  return normalized;
}

function normalizeFrequency(value: unknown): "Annual" | "Quarterly" {
  if (typeof value !== "string") {
    throw new Error("frequency must be Annual or Quarterly.");
  }

  const lower = value.trim().toLowerCase();
  if (lower === "annual") return "Annual";
  if (lower === "quarterly") return "Quarterly";
  throw new Error("frequency must be Annual or Quarterly.");
}

function normalizeStatementType(value: unknown): "IS" | "BS" | "CF" {
  if (typeof value !== "string") {
    throw new Error("statement_type must be IS, BS, or CF.");
  }

  const upper = value.trim().toUpperCase();
  if (upper === "IS" || upper === "BS" || upper === "CF") {
    return upper;
  }

  throw new Error("statement_type must be IS, BS, or CF.");
}

function normalizeBoundedInteger(value: unknown, args: {
  label: string;
  min: number;
  max: number;
}): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${args.label} must be an integer.`);
  }

  if (value < args.min || value > args.max) {
    throw new Error(`${args.label} must be between ${args.min} and ${args.max}.`);
  }

  return value;
}

function normalizeIsoDate(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }

  const date = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date.`);
  }

  return trimmed;
}

function extractTextContentBlocks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const lines: string[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (item.type !== "text") continue;
    const text = normalizeOptionalString(item.text);
    if (!text) continue;
    lines.push(text);
  }

  return lines;
}

function buildResultText(payload: unknown): string {
  if (isRecord(payload) && isRecord(payload.result)) {
    const rpcResult = payload.result;
    const summaryBlocks = extractTextContentBlocks(rpcResult.content);
    const hasStructuredContent = rpcResult.structuredContent !== undefined;
    const sections: string[] = [];

    if (summaryBlocks.length > 0) {
      sections.push(["Summary:", summaryBlocks.join("\n\n")].join("\n"));
    }

    if (hasStructuredContent) {
      sections.push([
        "Structured content:",
        "```json",
        formatJson(rpcResult.structuredContent),
        "```",
      ].join("\n"));
    }

    if (sections.length === 0) {
      return ["```json", formatJson(rpcResult), "```"].join("\n");
    }

    return sections.join("\n\n");
  }

  return ["```json", formatJson(payload), "```"].join("\n");
}

function parseJsonRpcError(payload: unknown): JsonRpcCallError | null {
  if (!isRecord(payload)) return null;
  if (!isRecord(payload.error)) return null;

  const message = normalizeOptionalString(payload.error.message) ?? "JSON-RPC error";
  const code = typeof payload.error.code === "number"
    ? payload.error.code
    : undefined;

  return new JsonRpcCallError(message, code);
}

function isAction(value: string): value is JamaicaMarketAction {
  return (ACTION_VALUES as readonly string[]).includes(value);
}

function parseParams(raw: unknown): Params {
  if (!isRecord(raw)) {
    throw new Error("Invalid jamaica_market params: expected an object.");
  }

  const actionRaw = normalizeOptionalString(raw.action);
  if (!actionRaw || !isAction(actionRaw)) {
    throw new Error(`action must be one of: ${ACTION_VALUES.join(", ")}`);
  }

  const params: Params = { action: actionRaw };

  const symbol = normalizeOptionalString(raw.symbol);
  if (symbol) params.symbol = symbol;

  const frequency = normalizeOptionalString(raw.frequency);
  if (frequency) params.frequency = frequency;

  const statementType = normalizeOptionalString(raw.statement_type);
  if (statementType) params.statement_type = statementType;

  if (typeof raw.year === "number" && Number.isInteger(raw.year)) {
    params.year = raw.year;
  }

  if (typeof raw.years === "number" && Number.isInteger(raw.years)) {
    params.years = raw.years;
  }

  const startDate = normalizeOptionalString(raw.start_date);
  if (startDate) params.start_date = startDate;

  const endDate = normalizeOptionalString(raw.end_date);
  if (endDate) params.end_date = endDate;

  if (typeof raw.limit === "number" && Number.isInteger(raw.limit)) {
    params.limit = raw.limit;
  }

  return params;
}

function buildManagedToolCall(params: Params): {
  action: JamaicaMarketAction;
  toolName: string;
  arguments: Record<string, unknown>;
} {
  const { action } = params;

  if (action === "list_companies") {
    const args: Record<string, unknown> = {};
    if (params.limit !== undefined) {
      args.limit = normalizeBoundedInteger(params.limit, {
        label: "limit",
        min: 1,
        max: 500,
      });
    }

    return {
      action,
      toolName: "jm_list_companies",
      arguments: args,
    };
  }

  if (action === "get_company") {
    return {
      action,
      toolName: "jm_get_company",
      arguments: {
        symbol: normalizeSymbol(params.symbol),
      },
    };
  }

  if (action === "get_statement") {
    const args: Record<string, unknown> = {
      symbol: normalizeSymbol(params.symbol),
      frequency: normalizeFrequency(params.frequency),
      statement_type: normalizeStatementType(params.statement_type),
    };

    if (params.year !== undefined) {
      args.year = normalizeBoundedInteger(params.year, {
        label: "year",
        min: 1990,
        max: new Date().getUTCFullYear() + 1,
      });
    }

    return {
      action,
      toolName: "jm_get_statement",
      arguments: args,
    };
  }

  if (action === "get_all_statements") {
    const args: Record<string, unknown> = {
      symbol: normalizeSymbol(params.symbol),
      frequency: normalizeFrequency(params.frequency),
    };

    if (params.years !== undefined) {
      args.years = normalizeBoundedInteger(params.years, {
        label: "years",
        min: 1,
        max: 10,
      });
    }

    return {
      action,
      toolName: "jm_get_all_statements",
      arguments: args,
    };
  }

  const startDate = normalizeIsoDate(params.start_date, "start_date");
  const endDate = normalizeIsoDate(params.end_date, "end_date");

  if (startDate > endDate) {
    throw new Error("start_date must be on or before end_date.");
  }

  return {
    action,
    toolName: "jm_get_price_data",
    arguments: {
      symbol: normalizeSymbol(params.symbol),
      start_date: startDate,
      end_date: endDate,
    },
  };
}

async function defaultGetRuntimeConfig(): Promise<JamaicaMarketRuntimeConfig> {
  const storageModule = await import("@mariozechner/pi-web-ui/dist/storage/app-storage.js");
  const settingsStore = storageModule.getAppStorage().settings;
  const configStore: McpConfigStore = settingsStore;

  const managedServers = await loadManagedMcpServers(configStore);
  const managedServer = managedServers.find((server) => server.managedId === JAMAICA_MANAGED_SERVER_ID);

  if (!managedServer) {
    throw new Error("Managed Jamaica Market server is unavailable.");
  }

  if (!managedServer.enabled) {
    throw new Error(
      `Managed Jamaica Market server is disabled. Open ${integrationsCommandHint()} and enable Jamaica Market Data.`,
    );
  }

  return {
    server: managedServer,
  };
}

async function defaultCallJsonRpc(args: {
  server: McpServerConfig;
  method: string;
  params?: unknown;
  signal: AbortSignal | undefined;
}): Promise<RpcCallResult> {
  const { server, method, params, signal } = args;
  const startedAt = Date.now();

  const requestBody: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method,
  };

  if (params !== undefined) {
    requestBody.params = params;
  }

  const timeout = runWithTimeoutAbort({
    signal,
    timeoutMs: JAMAICA_MARKET_TIMEOUT_MS,
    timeoutErrorMessage: `Managed Jamaica market request timed out after ${JAMAICA_MARKET_TIMEOUT_MS}ms.`,
    run: async (requestSignal) => {
      const response = await fetch(server.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: requestSignal,
      });

      const bodyText = await response.text();
      const payload: unknown = bodyText.trim().length > 0 ? JSON.parse(bodyText) : null;

      if (!response.ok) {
        const rpcError = parseJsonRpcError(payload);
        if (rpcError) throw rpcError;
        throw new Error(`Managed Jamaica market request failed (${response.status}).`);
      }

      const rpcError = parseJsonRpcError(payload);
      if (rpcError) throw rpcError;

      if (!isRecord(payload)) {
        throw new Error("Managed Jamaica market returned an invalid JSON-RPC response.");
      }

      return payload;
    },
  });

  const payload = await timeout;
  return {
    payload,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

function getRpcErrorCode(error: unknown): number | undefined {
  if (error instanceof JsonRpcCallError) {
    return error.code;
  }

  return undefined;
}

export function createJamaicaMarketTool(
  dependencies: JamaicaMarketToolDependencies = {},
): AgentTool<TSchema, JamaicaMarketDetails> {
  const getRuntimeConfig = dependencies.getRuntimeConfig ?? defaultGetRuntimeConfig;
  const callJsonRpc = dependencies.callJsonRpc ?? defaultCallJsonRpc;

  return {
    name: "jamaica_market",
    label: "Jamaica Market Data",
    description:
      "Managed Jamaica market data access (list companies, statements, and price history). "
      + "Use this tool first for Jamaican market data; use mcp for custom servers.",
    parameters: schema,
    execute: async (
      _toolCallId: string,
      rawParams: unknown,
      signal: AbortSignal | undefined,
    ): Promise<AgentToolResult<JamaicaMarketDetails>> => {
      let action: JamaicaMarketAction = "list_companies";
      let toolName = "";

      try {
        const params = parseParams(rawParams);
        const runtimeConfig = await getRuntimeConfig();
        if (!runtimeConfig.server.enabled) {
          throw new Error(
            `Managed Jamaica Market server is disabled. Open ${integrationsCommandHint()} and enable Jamaica Market Data.`,
          );
        }
        const call = buildManagedToolCall(params);
        action = call.action;
        toolName = call.toolName;

        const rpcMethod = "tools/call";
        const rpcCall = await callJsonRpc({
          server: runtimeConfig.server,
          method: rpcMethod,
          params: {
            name: call.toolName,
            arguments: call.arguments,
          },
          signal,
        });

        const resultText = buildResultText(rpcCall.payload);
        const text = [
          "Jamaica market tool call",
          `- action: ${action}`,
          `- managed tool: ${call.toolName}`,
          "- arguments sent:",
          "```json",
          formatJson(call.arguments),
          "```",
          "",
          "Result:",
          resultText,
        ].join("\n");

        return {
          content: [{ type: "text", text }],
          details: {
            kind: "jamaica_market",
            ok: true,
            action,
            toolName: call.toolName,
            rpcMethod,
            durationMs: rpcCall.durationMs,
            retryApplied: false,
            resultPreview: firstLine(resultText),
          },
        };
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: {
            kind: "jamaica_market",
            ok: false,
            action,
            ...(toolName ? { toolName } : {}),
            rpcMethod: "tools/call",
            retryApplied: false,
            errorCode: getRpcErrorCode(error),
            error: message,
          },
        };
      }
    },
  };
}
