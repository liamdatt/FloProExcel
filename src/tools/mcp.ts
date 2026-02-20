/**
 * mcp — Model Context Protocol gateway for configured HTTP servers.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type, type Static, type TSchema } from "@sinclair/typebox";

import { APP_NAME, APP_VERSION } from "../app/metadata.js";
import { integrationsCommandHint } from "../integrations/naming.js";
import { getErrorMessage } from "../utils/errors.js";
import {
  getHttpErrorReason,
  runWithTimeoutAbort,
} from "../utils/network.js";
import { isRecord } from "../utils/type-guards.js";
import type { ProxyAwareSettingsStore } from "./external-fetch.js";
import { getEnabledProxyBaseUrl, resolveOutboundRequestUrl } from "./external-fetch.js";
import {
  loadEffectiveMcpServers,
  type McpServerConfig,
  type McpConfigStore,
} from "./mcp-config.js";

const MCP_CLIENT_NAME = APP_NAME;
const MCP_CLIENT_VERSION = APP_VERSION;
const MCP_PROTOCOL_VERSION = "2025-03-26";
const MCP_TIMEOUT_MS = 15_000;

const schema = Type.Object({
  tool: Type.Optional(Type.String({
    description: "Tool name to call.",
  })),
  args: Type.Optional(Type.Union([
    Type.String({
      description: "Tool arguments as a JSON string.",
    }),
    Type.Object({}, {
      additionalProperties: true,
      description: "Tool arguments as an object.",
    }),
  ])),
  connect: Type.Optional(Type.String({
    description: "Server name/id to connect and refresh.",
  })),
  describe: Type.Optional(Type.String({
    description: "Tool name to describe.",
  })),
  search: Type.Optional(Type.String({
    description: "Search query for MCP tools.",
  })),
  server: Type.Optional(Type.String({
    description: "Optional server name/id filter.",
  })),
});

type Params = Static<typeof schema>;

interface McpToolDescriptor {
  serverId: string;
  serverName: string;
  serverUrl: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface ServerToolList {
  server: McpServerConfig;
  tools: McpToolDescriptor[];
  proxied: boolean;
  proxyBaseUrl?: string;
}

interface RpcCallResult {
  result: unknown;
  proxied: boolean;
  proxyBaseUrl?: string;
}

export interface McpGatewayDetails {
  kind: "mcp_gateway";
  ok: boolean;
  operation: string;
  server?: string;
  tool?: string;
  proxied?: boolean;
  proxyBaseUrl?: string;
  resultPreview?: string;
  retryApplied?: boolean;
  rpcMethod?: string;
  durationMs?: number;
  errorCode?: number;
  error?: string;
}

export interface McpRuntimeConfig {
  servers: McpServerConfig[];
  proxyBaseUrl?: string;
}

export interface McpToolDependencies {
  getRuntimeConfig?: () => Promise<McpRuntimeConfig>;
  callJsonRpc?: (args: {
    server: McpServerConfig;
    method: string;
    params?: unknown;
    signal: AbortSignal | undefined;
    proxyBaseUrl?: string;
    expectResponse?: boolean;
  }) => Promise<RpcCallResult | null>;
}

class McpRpcError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "McpRpcError";
    this.code = code;
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseParams(raw: unknown): Params {
  if (!isRecord(raw)) {
    return {};
  }

  const params: Params = {};

  const tool = normalizeOptionalString(raw.tool);
  if (tool) params.tool = tool;

  if (typeof raw.args === "string") {
    const args = normalizeOptionalString(raw.args);
    if (args) params.args = args;
  } else if (isRecord(raw.args)) {
    params.args = raw.args;
  }

  const connect = normalizeOptionalString(raw.connect);
  if (connect) params.connect = connect;

  const describe = normalizeOptionalString(raw.describe);
  if (describe) params.describe = describe;

  const search = normalizeOptionalString(raw.search);
  if (search) params.search = search;

  const server = normalizeOptionalString(raw.server);
  if (server) params.server = server;

  return params;
}

function normalizeServerToken(value: string): string {
  return value.trim().toLowerCase();
}

function findServerByToken(servers: readonly McpServerConfig[], token: string): McpServerConfig | null {
  const normalized = normalizeServerToken(token);

  for (const server of servers) {
    if (normalizeServerToken(server.id) === normalized) return server;
    if (normalizeServerToken(server.name) === normalized) return server;
  }

  return null;
}

function matchesServerToken(tool: McpToolDescriptor, token: string): boolean {
  const normalized = normalizeServerToken(token);
  return (
    normalizeServerToken(tool.serverId) === normalized ||
    normalizeServerToken(tool.serverName) === normalized
  );
}

function parseToolListResult(server: McpServerConfig, value: unknown): McpToolDescriptor[] {
  if (!isRecord(value)) return [];
  if (!isRecord(value.result)) return [];
  const result = value.result;

  const tools = result.tools;
  if (!Array.isArray(tools)) return [];

  const out: McpToolDescriptor[] = [];

  for (const item of tools) {
    if (!isRecord(item)) continue;

    const name = normalizeOptionalString(item.name);
    if (!name) continue;

    out.push({
      serverId: server.id,
      serverName: server.name,
      serverUrl: server.url,
      name,
      description: normalizeOptionalString(item.description),
      inputSchema: item.inputSchema,
    });
  }

  return out;
}

function parseJsonRpcError(value: unknown): { message: string; code?: number } | null {
  if (!isRecord(value)) return null;

  if (isRecord(value.error)) {
    const errorMessage = normalizeOptionalString(value.error.message);
    if (errorMessage) {
      const code = typeof value.error.code === "number" ? value.error.code : undefined;
      return { message: errorMessage, code };
    }
  }

  const text = normalizeOptionalString(value.message);
  return text ? { message: text } : null;
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

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseCallArgs(rawArgs: unknown): unknown {
  if (rawArgs === undefined) return {};

  if (typeof rawArgs === "string") {
    try {
      return JSON.parse(rawArgs);
    } catch {
      throw new Error("mcp.args must be valid JSON.");
    }
  }

  if (isRecord(rawArgs)) {
    return rawArgs;
  }

  throw new Error("mcp.args must be a JSON string or an object.");
}

function buildServerStatusLine(server: McpServerConfig, tools: McpToolDescriptor[] | null): string {
  if (!server.enabled) {
    return `- ${server.name} (${server.url}) — disabled`;
  }

  if (!tools) {
    return `- ${server.name} (${server.url}) — enabled`;
  }

  return `- ${server.name} (${server.url}) — enabled, ${tools.length} tool${tools.length === 1 ? "" : "s"}`;
}

function buildToolPreview(tools: readonly McpToolDescriptor[], max = 20): string {
  if (tools.length === 0) {
    return "No tools found.";
  }

  const lines: string[] = [];
  const count = Math.min(max, tools.length);

  for (let i = 0; i < count; i += 1) {
    const tool = tools[i];
    const desc = tool.description ? ` — ${tool.description}` : "";
    lines.push(`- ${tool.name}${desc}`);
  }

  if (tools.length > count) {
    lines.push(`- … ${tools.length - count} more`);
  }

  return lines.join("\n");
}

function firstLine(value: string): string {
  const line = value.split("\n")[0] ?? value;
  return line.length > 220 ? `${line.slice(0, 217)}…` : line;
}

function toSearchTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function matchesSearch(tool: McpToolDescriptor, query: string): boolean {
  const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
  const tokens = toSearchTokens(query);
  if (tokens.length === 0) return true;

  return tokens.some((token) => haystack.includes(token));
}

function buildToolCallResultText(payload: unknown): string {
  if (isRecord(payload) && isRecord(payload.result)) {
    const rpcResult = payload.result;
    const contentBlocks = extractTextContentBlocks(rpcResult.content);
    const hasStructuredContent = rpcResult.structuredContent !== undefined;
    const sections: string[] = [];

    if (contentBlocks.length > 0) {
      sections.push(["Summary:", contentBlocks.join("\n\n")].join("\n"));
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

function getRpcErrorCode(error: unknown): number | undefined {
  if (error instanceof McpRpcError) {
    return error.code;
  }

  return undefined;
}

function isRecoverableToolCallError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes("tool not found")
    || message.includes("method not found")
    || message.includes("unknown tool")
    || message.includes("stale")
    || message.includes("no response")
    || message.includes("not available")
  );
}

function withMcpRemediationHint(message: string, operation: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("unknown mcp server")) {
    return `${message} Tip: run \`mcp\` with no params to list configured servers and IDs.`;
  }

  if (operation === "tool") {
    if (normalized.includes("available on multiple servers")) {
      return `${message} Tip: include the \`server\` parameter to disambiguate.`;
    }

    if (normalized.includes("tool not found") || normalized.includes("unknown tool")) {
      return `${message} Tip: run \`search\` first, then \`describe\`, before calling \`tool\`.`;
    }
  }

  if (operation === "server" && normalized.includes("unknown mcp server")) {
    return `${message} Tip: run \`mcp\` with no params to list configured servers.`;
  }

  if (normalized.includes("disabled")) {
    return `${message} Enable it in ${integrationsCommandHint()}.`;
  }

  return message;
}

async function defaultGetRuntimeConfig(): Promise<McpRuntimeConfig> {
  const storageModule = await import("@mariozechner/pi-web-ui/dist/storage/app-storage.js");
  const settingsStore = storageModule.getAppStorage().settings;
  const configStore: McpConfigStore = settingsStore;
  const proxyStore: ProxyAwareSettingsStore = settingsStore;

  const [servers, proxyBaseUrl] = await Promise.all([
    loadEffectiveMcpServers(configStore),
    getEnabledProxyBaseUrl(proxyStore),
  ]);

  return {
    servers,
    proxyBaseUrl,
  };
}

async function defaultCallJsonRpc(args: {
  server: McpServerConfig;
  method: string;
  params?: unknown;
  signal: AbortSignal | undefined;
  proxyBaseUrl?: string;
  expectResponse?: boolean;
}): Promise<RpcCallResult | null> {
  const { server, method, params, signal, proxyBaseUrl, expectResponse = true } = args;

  const resolved = resolveOutboundRequestUrl({
    targetUrl: server.url,
    proxyBaseUrl,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (server.token) {
    headers.Authorization = `Bearer ${server.token}`;
  }

  const requestBody: Record<string, unknown> = {
    jsonrpc: "2.0",
    method,
  };

  if (expectResponse) {
    requestBody.id = crypto.randomUUID();
  }

  if (params !== undefined) {
    requestBody.params = params;
  }

  return runWithTimeoutAbort({
    signal,
    timeoutMs: MCP_TIMEOUT_MS,
    timeoutErrorMessage: `MCP request timed out after ${MCP_TIMEOUT_MS}ms.`,
    run: async (requestSignal) => {
      const response = await fetch(resolved.requestUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: requestSignal,
      });

      if (!response.ok) {
        const body = await response.text();
        const reason = getHttpErrorReason(response.status, body);
        throw new Error(`MCP request failed (${response.status}): ${reason}`);
      }

      if (!expectResponse) {
        return {
          result: null,
          proxied: resolved.proxied,
          proxyBaseUrl: resolved.proxyBaseUrl,
        };
      }

      const body = await response.text();
      const payload: unknown = body.trim().length > 0 ? JSON.parse(body) : null;

      const rpcError = parseJsonRpcError(payload);
      if (rpcError) {
        throw new McpRpcError(rpcError.message, rpcError.code);
      }

      if (!isRecord(payload)) {
        throw new Error("Invalid MCP JSON-RPC response.");
      }

      return {
        result: payload,
        proxied: resolved.proxied,
        proxyBaseUrl: resolved.proxyBaseUrl,
      };
    },
  });
}

export function createMcpTool(
  dependencies: McpToolDependencies = {},
): AgentTool<TSchema, McpGatewayDetails> {
  const getRuntimeConfig = dependencies.getRuntimeConfig ?? defaultGetRuntimeConfig;
  const callJsonRpc = dependencies.callJsonRpc ?? defaultCallJsonRpc;

  const toolCache = new Map<string, ServerToolList>();

  const ensureServerTools = async (args: {
    server: McpServerConfig;
    proxyBaseUrl?: string;
    signal: AbortSignal | undefined;
    refresh?: boolean;
  }): Promise<ServerToolList> => {
    const { server, proxyBaseUrl, signal, refresh = false } = args;

    if (!refresh) {
      const cached = toolCache.get(server.id);
      if (cached) {
        return cached;
      }
    }

    await callJsonRpc({
      server,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: MCP_CLIENT_NAME,
          version: MCP_CLIENT_VERSION,
        },
      },
      signal,
      proxyBaseUrl,
    });

    await callJsonRpc({
      server,
      method: "notifications/initialized",
      signal,
      proxyBaseUrl,
      expectResponse: false,
    });

    const listResult = await callJsonRpc({
      server,
      method: "tools/list",
      params: {},
      signal,
      proxyBaseUrl,
    });

    if (!listResult) {
      throw new Error("MCP tools/list returned no response.");
    }

    const tools = parseToolListResult(server, listResult.result);
    const entry: ServerToolList = {
      server,
      tools,
      proxied: listResult.proxied,
      proxyBaseUrl: listResult.proxyBaseUrl,
    };

    toolCache.set(server.id, entry);
    return entry;
  };

  const listToolsAcrossServers = async (args: {
    servers: readonly McpServerConfig[];
    proxyBaseUrl?: string;
    signal: AbortSignal | undefined;
  }): Promise<ServerToolList[]> => {
    const out: ServerToolList[] = [];

    for (const server of args.servers) {
      if (!server.enabled) continue;
      const list = await ensureServerTools({
        server,
        proxyBaseUrl: args.proxyBaseUrl,
        signal: args.signal,
      });
      out.push(list);
    }

    return out;
  };

  return {
    name: "mcp",
    label: "MCP Gateway",
    description:
      "Connect to configured MCP servers, discover tools, and call MCP tools. "
      + "Examples: {search:\"price\"}, {describe:\"tool_name\"}, "
      + "{tool:\"tool_name\", server:\"server_id\", args:{...}}",
    parameters: schema,
    execute: async (
      _toolCallId: string,
      rawParams: unknown,
      signal: AbortSignal | undefined,
    ): Promise<AgentToolResult<McpGatewayDetails>> => {
      const params = parseParams(rawParams);
      let retryApplied = false;
      let rpcMethod: string | undefined;
      let durationMs: number | undefined;
      let rpcErrorCode: number | undefined;

      try {
        const runtimeConfig = await getRuntimeConfig();
        const enabledServers = runtimeConfig.servers.filter((server) => server.enabled);

        if (runtimeConfig.servers.length === 0) {
          throw new Error(`No MCP servers configured. Open ${integrationsCommandHint()} to add one.`);
        }

        const resolveSingleServer = (token: string): McpServerConfig => {
          const server = findServerByToken(runtimeConfig.servers, token);
          if (!server) {
            throw new Error(`Unknown MCP server: ${token}`);
          }
          if (!server.enabled) {
            throw new Error(`MCP server "${server.name}" is disabled.`);
          }
          return server;
        };

        if (params.connect) {
          const server = resolveSingleServer(params.connect);
          const list = await ensureServerTools({
            server,
            proxyBaseUrl: runtimeConfig.proxyBaseUrl,
            signal,
            refresh: true,
          });

          const text = [
            `Connected to MCP server \"${server.name}\" (${server.url}).`,
            `Discovered ${list.tools.length} tool${list.tools.length === 1 ? "" : "s"}.`,
            "",
            buildToolPreview(list.tools),
          ].join("\n");

          return {
            content: [{ type: "text", text }],
            details: {
              kind: "mcp_gateway",
              ok: true,
              operation: "connect",
              server: server.name,
              proxied: list.proxied,
              proxyBaseUrl: list.proxyBaseUrl,
              resultPreview: firstLine(text),
            },
          };
        }

        if (params.tool) {
          const candidateLists = params.server
            ? [await ensureServerTools({
              server: resolveSingleServer(params.server),
              proxyBaseUrl: runtimeConfig.proxyBaseUrl,
              signal,
            })]
            : await listToolsAcrossServers({
              servers: enabledServers,
              proxyBaseUrl: runtimeConfig.proxyBaseUrl,
              signal,
            });

          const allTools = candidateLists.flatMap((list) => list.tools);
          const matched = allTools.filter((tool) => tool.name === params.tool);

          if (matched.length === 0) {
            throw new Error(
              `MCP tool not found: ${params.tool}. `
              + "Use `search` first to discover available tools, then `describe` to inspect inputs.",
            );
          }

          if (!params.server) {
            const matchedServerIds = new Set(matched.map((tool) => tool.serverId));
            if (matchedServerIds.size > 1) {
              const serverNames = Array.from(new Set(matched.map((tool) => tool.serverName))).sort();
              throw new Error(
                `MCP tool "${params.tool}" is available on multiple servers (${serverNames.join(", ")}). Specify the server parameter.`,
              );
            }
          }

          const targetTool = matched[0];
          const targetServer = resolveSingleServer(targetTool.serverId);
          const parsedArgs = parseCallArgs(params.args);
          rpcMethod = "tools/call";

          const callTool = async (): Promise<RpcCallResult> => {
            const callResult = await callJsonRpc({
              server: targetServer,
              method: "tools/call",
              params: {
                name: targetTool.name,
                arguments: parsedArgs,
              },
              signal,
              proxyBaseUrl: runtimeConfig.proxyBaseUrl,
            });

            if (!callResult) {
              throw new Error("MCP tools/call returned no response.");
            }

            return callResult;
          };

          const startedAt = Date.now();
          let callResult: RpcCallResult;
          try {
            callResult = await callTool();
          } catch (error: unknown) {
            rpcErrorCode = getRpcErrorCode(error);
            if (!isRecoverableToolCallError(error)) {
              throw error;
            }

            retryApplied = true;
            await ensureServerTools({
              server: targetServer,
              proxyBaseUrl: runtimeConfig.proxyBaseUrl,
              signal,
              refresh: true,
            });
            callResult = await callTool();
          }

          durationMs = Math.max(0, Date.now() - startedAt);
          const payload = callResult.result;
          const resultText = buildToolCallResultText(payload);

          const text = [
            "MCP tool call",
            `- server: ${targetServer.name} (${targetServer.url})`,
            `- tool: ${targetTool.name}`,
            "- arguments sent:",
            "```json",
            formatJson(parsedArgs),
            "```",
            "",
            retryApplied ? "Recovery: automatic refresh retry applied once." : "Recovery: no retry needed.",
            "",
            "Result:",
            resultText,
          ].join("\n");

          return {
            content: [{ type: "text", text }],
            details: {
              kind: "mcp_gateway",
              ok: true,
              operation: "tool",
              server: targetServer.name,
              tool: targetTool.name,
              proxied: callResult.proxied,
              proxyBaseUrl: callResult.proxyBaseUrl,
              resultPreview: firstLine(resultText),
              retryApplied,
              rpcMethod,
              durationMs,
              errorCode: rpcErrorCode,
            },
          };
        }

        if (params.describe) {
          const lists = await listToolsAcrossServers({
            servers: enabledServers,
            proxyBaseUrl: runtimeConfig.proxyBaseUrl,
            signal,
          });

          const allTools = lists.flatMap((list) => list.tools);
          const candidates = params.server
            ? allTools.filter((tool) => matchesServerToken(tool, params.server ?? ""))
            : allTools;

          const target = candidates.find((tool) => tool.name === params.describe) ?? null;
          if (!target) {
            throw new Error(`MCP tool not found: ${params.describe}`);
          }

          const schemaBlock = target.inputSchema === undefined
            ? "(no input schema provided)"
            : `\`\`\`json\n${formatJson(target.inputSchema)}\n\`\`\``;

          const description = target.description ?? "(no description provided)";

          const text = [
            `MCP tool: ${target.name}`,
            `- server: ${target.serverName} (${target.serverUrl})`,
            `- description: ${description}`,
            "",
            "Input schema:",
            schemaBlock,
          ].join("\n");

          return {
            content: [{ type: "text", text }],
            details: {
              kind: "mcp_gateway",
              ok: true,
              operation: "describe",
              server: target.serverName,
              tool: target.name,
              resultPreview: firstLine(description),
            },
          };
        }

        if (params.search) {
          const lists = await listToolsAcrossServers({
            servers: enabledServers,
            proxyBaseUrl: runtimeConfig.proxyBaseUrl,
            signal,
          });

          const allTools = lists.flatMap((list) => list.tools);
          const matches = allTools.filter((tool) => matchesSearch(tool, params.search ?? ""));

          const lines: string[] = [];
          lines.push(`MCP search \"${params.search}\"`);
          lines.push("");

          if (matches.length === 0) {
            lines.push("No matching tools.");
          } else {
            const limit = Math.min(matches.length, 30);
            for (let i = 0; i < limit; i += 1) {
              const tool = matches[i];
              const desc = tool.description ? ` — ${tool.description}` : "";
              lines.push(`- ${tool.name} (${tool.serverName})${desc}`);
            }

            if (matches.length > limit) {
              lines.push(`- … ${matches.length - limit} more`);
            }
          }

          const text = lines.join("\n");
          return {
            content: [{ type: "text", text }],
            details: {
              kind: "mcp_gateway",
              ok: true,
              operation: "search",
              resultPreview: firstLine(text),
            },
          };
        }

        if (params.server) {
          const server = resolveSingleServer(params.server);
          const list = await ensureServerTools({
            server,
            proxyBaseUrl: runtimeConfig.proxyBaseUrl,
            signal,
          });

          const text = [
            `MCP tools on ${server.name} (${server.url}):`,
            "",
            buildToolPreview(list.tools),
          ].join("\n");

          return {
            content: [{ type: "text", text }],
            details: {
              kind: "mcp_gateway",
              ok: true,
              operation: "server",
              server: server.name,
              proxied: list.proxied,
              proxyBaseUrl: list.proxyBaseUrl,
              resultPreview: firstLine(text),
            },
          };
        }

        const lines: string[] = [];
        lines.push("MCP server status:");

        for (const server of runtimeConfig.servers) {
          const cached = toolCache.get(server.id);
          lines.push(buildServerStatusLine(server, cached?.tools ?? null));
        }

        lines.push("");
        lines.push("Tip: use `connect`, `server`, `search`, `describe`, or `tool`.");

        const statusText = lines.join("\n");

        return {
          content: [{ type: "text", text: statusText }],
          details: {
            kind: "mcp_gateway",
            ok: true,
            operation: "status",
            resultPreview: firstLine(statusText),
          },
        };
      } catch (error: unknown) {
        const operation = params.tool
          ? "tool"
          : params.connect
            ? "connect"
            : params.describe
              ? "describe"
              : params.search
                ? "search"
                : params.server
                  ? "server"
                  : "status";
        const rawMessage = getErrorMessage(error);
        const message = withMcpRemediationHint(rawMessage, operation);
        if (rpcErrorCode === undefined) {
          rpcErrorCode = getRpcErrorCode(error);
        }

        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: {
            kind: "mcp_gateway",
            ok: false,
            operation,
            server: params.server ?? params.connect,
            tool: params.tool ?? params.describe,
            retryApplied,
            rpcMethod,
            durationMs,
            errorCode: rpcErrorCode,
            error: message,
          },
        };
      }
    },
  };
}
