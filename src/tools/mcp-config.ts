/**
 * MCP server configuration storage.
 */

import { isRecord } from "../utils/type-guards.js";

export const MCP_SERVERS_SETTING_KEY = "mcp.servers.v1";
export const MCP_MANAGED_SERVERS_SETTING_KEY = "mcp.managed.v1";

const MCP_SERVERS_DOC_VERSION = 1;
const MCP_MANAGED_DOC_VERSION = 1;

export type McpServerSource = "managed" | "custom";
export type ManagedMcpServerId = "jamaica-market";

export interface McpConfigStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  token?: string;
  source?: McpServerSource;
  managedId?: ManagedMcpServerId;
}

interface McpServersDocument {
  version: number;
  servers: McpServerConfig[];
}

interface ManagedMcpServersDocument {
  version: number;
  enabledById: Record<string, boolean>;
}

interface ManagedMcpServerDefinition {
  managedId: ManagedMcpServerId;
  id: string;
  name: string;
  urlPath: string;
}

const MANAGED_MCP_SERVER_DEFINITIONS: readonly ManagedMcpServerDefinition[] = [
  {
    managedId: "jamaica-market",
    id: "mcp-managed-jamaica-market",
    name: "Jamaica Market Data",
    urlPath: "/api/mcp/jamaica-market",
  },
];

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "0" || normalized === "false" || normalized === "off") {
      return false;
    }
  }
  return true;
}

export function validateMcpServerUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw new Error("MCP server URL cannot be empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid MCP server URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("MCP server URL must use http:// or https://");
  }

  return trimmed.replace(/\/+$/u, "");
}

function normalizeServerId(value: unknown, fallbackName: string, fallbackUrl: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const base = `${fallbackName} ${fallbackUrl}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return base.length > 0 ? `mcp-${base}` : `mcp-${crypto.randomUUID()}`;
}

function normalizeServer(raw: unknown): McpServerConfig | null {
  if (!isRecord(raw)) return null;

  const source = raw.source === "managed" ? "managed" : "custom";
  if (source === "managed") {
    // Managed servers are derived from app metadata and are persisted separately.
    return null;
  }

  const name = normalizeName(raw.name);
  const rawUrl = normalizeOptionalString(raw.url);
  if (!name || !rawUrl) return null;

  let url: string;
  try {
    url = validateMcpServerUrl(rawUrl);
  } catch {
    return null;
  }

  const id = normalizeServerId(raw.id, name, url);
  const token = normalizeOptionalString(raw.token);

  return {
    id,
    name,
    url,
    enabled: normalizeEnabled(raw.enabled),
    token,
    source: "custom",
  };
}

function uniqueById(servers: McpServerConfig[]): McpServerConfig[] {
  const used = new Set<string>();
  const out: McpServerConfig[] = [];

  for (const server of servers) {
    let candidate = server.id;
    if (used.has(candidate)) {
      let suffix = 2;
      while (used.has(`${candidate}-${suffix}`)) {
        suffix += 1;
      }
      candidate = `${candidate}-${suffix}`;
    }

    used.add(candidate);
    out.push({
      ...server,
      id: candidate,
    });
  }

  return out;
}

function normalizeServers(raw: unknown): McpServerConfig[] {
  const source = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.servers)
      ? raw.servers
      : [];

  const parsed: McpServerConfig[] = [];
  for (const item of source) {
    const normalized = normalizeServer(item);
    if (!normalized) continue;
    parsed.push(normalized);
  }

  return uniqueById(parsed);
}

function createDocument(servers: McpServerConfig[]): McpServersDocument {
  return {
    version: MCP_SERVERS_DOC_VERSION,
    servers,
  };
}

function resolveOrigin(originOverride?: string): string {
  const fromOverride = normalizeOptionalString(originOverride);
  if (fromOverride) {
    return fromOverride.replace(/\/+$/u, "");
  }

  if (typeof window !== "undefined" && typeof window.location?.origin === "string" && window.location.origin.length > 0) {
    return window.location.origin.replace(/\/+$/u, "");
  }

  return "http://localhost";
}

function parseManagedEnabledMap(raw: unknown): Record<string, boolean> {
  if (isRecord(raw) && isRecord(raw.enabledById)) {
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw.enabledById)) {
      out[key] = normalizeEnabled(value);
    }
    return out;
  }

  if (isRecord(raw)) {
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(raw)) {
      out[key] = normalizeEnabled(value);
    }
    return out;
  }

  return {};
}

function createManagedDocument(enabledById: Record<string, boolean>): ManagedMcpServersDocument {
  return {
    version: MCP_MANAGED_DOC_VERSION,
    enabledById,
  };
}

export function listManagedMcpServerDefinitions(originOverride?: string): McpServerConfig[] {
  const origin = resolveOrigin(originOverride);

  return MANAGED_MCP_SERVER_DEFINITIONS.map((definition) => ({
    id: definition.id,
    name: definition.name,
    url: `${origin}${definition.urlPath}`,
    enabled: true,
    source: "managed",
    managedId: definition.managedId,
  }));
}

export async function loadMcpServers(settings: McpConfigStore): Promise<McpServerConfig[]> {
  const raw = await settings.get(MCP_SERVERS_SETTING_KEY);
  return normalizeServers(raw);
}

export async function saveMcpServers(
  settings: McpConfigStore,
  servers: readonly McpServerConfig[],
): Promise<void> {
  const customServersOnly = servers.filter((server) => server.source !== "managed");
  const normalized = uniqueById(normalizeServers(customServersOnly));
  await settings.set(MCP_SERVERS_SETTING_KEY, createDocument(normalized));
}

export async function loadManagedMcpEnabledState(settings: McpConfigStore): Promise<Record<string, boolean>> {
  const raw = await settings.get(MCP_MANAGED_SERVERS_SETTING_KEY);
  return parseManagedEnabledMap(raw);
}

export async function saveManagedMcpEnabledState(
  settings: McpConfigStore,
  enabledById: Record<string, boolean>,
): Promise<void> {
  await settings.set(MCP_MANAGED_SERVERS_SETTING_KEY, createManagedDocument(enabledById));
}

export async function setManagedMcpServerEnabled(args: {
  settings: McpConfigStore;
  managedId: ManagedMcpServerId;
  enabled: boolean;
}): Promise<void> {
  const { settings, managedId, enabled } = args;
  const existing = await loadManagedMcpEnabledState(settings);
  existing[managedId] = enabled;
  await saveManagedMcpEnabledState(settings, existing);
}

export async function loadManagedMcpServers(
  settings: McpConfigStore,
  originOverride?: string,
): Promise<McpServerConfig[]> {
  const [definitions, enabledById] = await Promise.all([
    Promise.resolve(listManagedMcpServerDefinitions(originOverride)),
    loadManagedMcpEnabledState(settings),
  ]);

  return definitions.map((server) => ({
    ...server,
    enabled: enabledById[server.managedId ?? ""] ?? true,
  }));
}

export async function loadEffectiveMcpServers(
  settings: McpConfigStore,
  originOverride?: string,
): Promise<McpServerConfig[]> {
  const [managed, custom] = await Promise.all([
    loadManagedMcpServers(settings, originOverride),
    loadMcpServers(settings),
  ]);

  return [...managed, ...custom];
}

export function createMcpServerConfig(input: {
  name: string;
  url: string;
  token?: string;
  enabled?: boolean;
}): McpServerConfig {
  const name = normalizeName(input.name);
  if (!name) {
    throw new Error("MCP server name cannot be empty.");
  }

  const url = validateMcpServerUrl(input.url);
  const token = normalizeOptionalString(input.token);

  return {
    id: `mcp-${crypto.randomUUID()}`,
    name,
    url,
    enabled: input.enabled ?? true,
    token,
    source: "custom",
  };
}
