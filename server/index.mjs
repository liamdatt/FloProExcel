#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import {
  MANAGED_OPENROUTER_API_KEY_SENTINEL,
  OPENROUTER_CURATED_MODELS,
  isOpenRouterCuratedModelId,
} from "../shared/openrouter-curated-models.mjs";

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const DIST_DIR = path.resolve(process.env.DIST_DIR || path.join(process.cwd(), "dist"));

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || "").trim();
const OPENROUTER_BASE_URL = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1")
  .trim()
  .replace(/\/+$/u, "");
const OPENROUTER_TIMEOUT_MS = Number.parseInt(process.env.OPENROUTER_TIMEOUT_MS || "45000", 10);

const JAMAICA_API_BASE_URL = (process.env.JAMAICA_API_BASE_URL || "https://chaseashley876.pythonanywhere.com")
  .trim()
  .replace(/\/+$/u, "");
const JAMAICA_TIMEOUT_MS = Number.parseInt(process.env.JAMAICA_API_TIMEOUT_MS || "20000", 10);

const CONFIGURED_ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0),
);

const REQUEST_BODY_LIMIT_BYTES = Number.parseInt(process.env.REQUEST_BODY_LIMIT_BYTES || `${1 * 1024 * 1024}`, 10);
const RATE_LIMIT_WINDOW_MS = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
const RATE_LIMIT_MAX_REQUESTS = Number.parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "120", 10);

const MCP_SERVER_NAME = "flo-pro-jamaica-market";
const MCP_PROTOCOL_VERSION = "2025-03-26";

if (!OPENROUTER_API_KEY) {
  console.error("[flo-pro] Missing OPENROUTER_API_KEY. Refusing to start.");
  process.exit(1);
}

if (!fs.existsSync(DIST_DIR)) {
  console.error(`[flo-pro] dist/ not found at ${DIST_DIR}. Build frontend first (npm run build).`);
  process.exit(1);
}

const RATE_LIMIT_STATE = new Map();

const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const OPENROUTER_ROUTE_RULES = new Map([
  ["/chat/completions", new Set(["POST"])],
  ["/responses", new Set(["POST"])],
  ["/models", new Set(["GET"])],
]);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(text);
}

function normalizeIp(value) {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim();
  if (!trimmed) return "unknown";
  return trimmed;
}

function normalizeOrigin(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins(req) {
  if (CONFIGURED_ALLOWED_ORIGINS.size > 0) {
    return CONFIGURED_ALLOWED_ORIGINS;
  }

  const host = typeof req.headers.host === "string" ? req.headers.host.trim() : "";
  if (!host) return new Set();

  return new Set([`https://${host}`, `http://${host}`]);
}

function isApiOriginAllowed(req) {
  const originHeader = req.headers.origin;
  const origin = normalizeOrigin(originHeader);
  if (!origin) return true;

  const allowedOrigins = getAllowedOrigins(req);
  if (allowedOrigins.size === 0) {
    return false;
  }

  return allowedOrigins.has(origin);
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0];
    return normalizeIp(first);
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return normalizeIp(forwarded[0]);
  }

  return normalizeIp(req.socket?.remoteAddress || "unknown");
}

function isRateLimited(ip, nowMs = Date.now()) {
  const existing = RATE_LIMIT_STATE.get(ip);
  if (!existing || nowMs - existing.startedAt >= RATE_LIMIT_WINDOW_MS) {
    RATE_LIMIT_STATE.set(ip, { startedAt: nowMs, count: 1 });
    return false;
  }

  existing.count += 1;
  return existing.count > RATE_LIMIT_MAX_REQUESTS;
}

function cleanupRateLimitState(nowMs = Date.now()) {
  for (const [ip, state] of RATE_LIMIT_STATE.entries()) {
    if (nowMs - state.startedAt > RATE_LIMIT_WINDOW_MS * 2) {
      RATE_LIMIT_STATE.delete(ip);
    }
  }
}

async function readRequestBody(req, maxBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;

    if (total > maxBytes) {
      throw new Error(`Request body exceeds limit (${maxBytes} bytes).`);
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function parseJsonBody(buffer) {
  if (buffer.length === 0) return {};
  try {
    return JSON.parse(buffer.toString("utf-8"));
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

function hasUnmanagedClientCredentials(req) {
  const managedBearer = `Bearer ${MANAGED_OPENROUTER_API_KEY_SENTINEL}`;
  const managedApiKey = MANAGED_OPENROUTER_API_KEY_SENTINEL;

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.trim().length > 0) {
    if (authHeader.trim() !== managedBearer) {
      return true;
    }
  }

  const xApiKey = req.headers["x-api-key"];
  if (typeof xApiKey === "string" && xApiKey.trim().length > 0) {
    if (xApiKey.trim() !== managedApiKey) {
      return true;
    }
  }

  if (Array.isArray(xApiKey)) {
    for (const value of xApiKey) {
      if (value.trim().length === 0) continue;
      if (value.trim() !== managedApiKey) {
        return true;
      }
    }
  }

  return false;
}

function normalizeSymbol(symbol) {
  if (typeof symbol !== "string") {
    throw new Error("symbol must be a string.");
  }

  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,20}$/u.test(normalized)) {
    throw new Error("symbol must contain only letters, digits, dot, or dash.");
  }

  return normalized;
}

function normalizeFrequency(value) {
  if (typeof value !== "string") {
    throw new Error("frequency must be Annual or Quarterly.");
  }

  const lower = value.trim().toLowerCase();
  if (lower === "annual") return "Annual";
  if (lower === "quarterly") return "Quarterly";
  throw new Error("frequency must be Annual or Quarterly.");
}

function normalizeStatementType(value) {
  if (typeof value !== "string") {
    throw new Error("statement_type must be IS, BS, or CF.");
  }

  const upper = value.trim().toUpperCase();
  if (upper === "IS" || upper === "BS" || upper === "CF") return upper;
  throw new Error("statement_type must be IS, BS, or CF.");
}

function normalizeBoundedInt(value, opts) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${opts.label} must be an integer.`);
  }

  if (parsed < opts.min || parsed > opts.max) {
    throw new Error(`${opts.label} must be between ${opts.min} and ${opts.max}.`);
  }

  return parsed;
}

function normalizeIsoDate(value, label) {
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

function buildJsonRpcSuccess(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function buildJsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
    },
  };
}

function buildManagedMcpToolsSchema() {
  return [
    {
      name: "jm_list_companies",
      description: "List companies on the Jamaican market.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            description: "Maximum number of companies to return (default 200).",
          },
        },
      },
    },
    {
      name: "jm_get_company",
      description: "Get company profile for a JSE ticker symbol.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["symbol"],
        properties: {
          symbol: { type: "string", description: "Ticker symbol, e.g. GK." },
        },
      },
    },
    {
      name: "jm_get_statement",
      description: "Get one income/balance/cashflow statement for a symbol.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["symbol", "frequency", "statement_type"],
        properties: {
          symbol: { type: "string" },
          frequency: { type: "string", enum: ["Annual", "Quarterly"] },
          statement_type: { type: "string", enum: ["IS", "BS", "CF"] },
          year: { type: "integer", minimum: 1990, maximum: 2100 },
        },
      },
    },
    {
      name: "jm_get_all_statements",
      description: "Get multiple years of statements for a symbol.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["symbol", "frequency"],
        properties: {
          symbol: { type: "string" },
          frequency: { type: "string", enum: ["Annual", "Quarterly"] },
          years: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "How many years to retrieve (default 5).",
          },
        },
      },
    },
    {
      name: "jm_get_price_data",
      description: "Get historical closing price and volume for a date range.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["symbol", "start_date", "end_date"],
        properties: {
          symbol: { type: "string" },
          start_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          end_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        },
      },
    },
  ];
}

const MANAGED_MCP_TOOLS = buildManagedMcpToolsSchema();

async function fetchJamaicaJson(endpointPath) {
  const target = `${JAMAICA_API_BASE_URL}${endpointPath}`;
  const timeout = withTimeout(JAMAICA_TIMEOUT_MS);

  try {
    const response = await fetch(target, {
      method: "GET",
      signal: timeout.signal,
      headers: {
        Accept: "application/json",
      },
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Jamaica market API failed (${response.status}): ${bodyText.slice(0, 200)}`);
    }

    try {
      return JSON.parse(bodyText);
    } catch {
      throw new Error("Jamaica market API returned non-JSON response.");
    }
  } finally {
    timeout.clear();
  }
}

function summarizeStructuredResponse(name, payload) {
  if (Array.isArray(payload)) {
    return `${name}: returned ${payload.length} record${payload.length === 1 ? "" : "s"}.`;
  }

  if (payload && typeof payload === "object") {
    return `${name}: returned object response.`;
  }

  return `${name}: returned scalar response.`;
}

async function runManagedMcpTool(name, argsRaw) {
  const args = argsRaw && typeof argsRaw === "object" ? argsRaw : {};

  if (name === "jm_list_companies") {
    const limit = args.limit === undefined
      ? 200
      : normalizeBoundedInt(args.limit, { min: 1, max: 500, label: "limit" });

    const data = await fetchJamaicaJson("/company");
    const sliced = Array.isArray(data) ? data.slice(0, limit) : data;
    return {
      content: [{ type: "text", text: summarizeStructuredResponse(name, sliced) }],
      structuredContent: sliced,
    };
  }

  if (name === "jm_get_company") {
    const symbol = normalizeSymbol(args.symbol);
    const data = await fetchJamaicaJson(`/company/${encodeURIComponent(symbol)}`);
    return {
      content: [{ type: "text", text: summarizeStructuredResponse(name, data) }],
      structuredContent: data,
    };
  }

  if (name === "jm_get_statement") {
    const symbol = normalizeSymbol(args.symbol);
    const frequency = normalizeFrequency(args.frequency);
    const statementType = normalizeStatementType(args.statement_type);

    let endpoint = `/statement/${encodeURIComponent(symbol)}/${frequency}/${statementType}`;
    if (args.year !== undefined) {
      const year = normalizeBoundedInt(args.year, { min: 1990, max: new Date().getUTCFullYear() + 1, label: "year" });
      endpoint = `${endpoint}/${year}`;
    }

    const data = await fetchJamaicaJson(endpoint);
    return {
      content: [{ type: "text", text: summarizeStructuredResponse(name, data) }],
      structuredContent: data,
    };
  }

  if (name === "jm_get_all_statements") {
    const symbol = normalizeSymbol(args.symbol);
    const frequency = normalizeFrequency(args.frequency);
    const years = args.years === undefined
      ? 5
      : normalizeBoundedInt(args.years, { min: 1, max: 10, label: "years" });

    const data = await fetchJamaicaJson(`/all_statements/${encodeURIComponent(symbol)}/${frequency}/${years}`);
    return {
      content: [{ type: "text", text: summarizeStructuredResponse(name, data) }],
      structuredContent: data,
    };
  }

  if (name === "jm_get_price_data") {
    const symbol = normalizeSymbol(args.symbol);
    const startDate = normalizeIsoDate(args.start_date, "start_date");
    const endDate = normalizeIsoDate(args.end_date, "end_date");

    if (startDate > endDate) {
      throw new Error("start_date must be on or before end_date.");
    }

    const data = await fetchJamaicaJson(`/price_data/${encodeURIComponent(symbol)}/${startDate}/${endDate}`);
    return {
      content: [{ type: "text", text: summarizeStructuredResponse(name, data) }],
      structuredContent: data,
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleManagedMcpRpc(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let bodyBuffer;
  try {
    bodyBuffer = await readRequestBody(req, REQUEST_BODY_LIMIT_BYTES);
  } catch (error) {
    sendJson(res, 413, { error: error instanceof Error ? error.message : "Request too large" });
    return;
  }

  let payload;
  try {
    payload = parseJsonBody(bodyBuffer);
  } catch (error) {
    sendJson(res, 400, buildJsonRpcError(null, -32700, error instanceof Error ? error.message : "Parse error"));
    return;
  }

  const id = payload?.id;
  const method = typeof payload?.method === "string" ? payload.method : "";
  const params = payload?.params;

  try {
    if (method === "initialize") {
      sendJson(res, 200, buildJsonRpcSuccess(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: MCP_SERVER_NAME,
          version: "1.0.0",
        },
      }));
      return;
    }

    if (method === "notifications/initialized") {
      if (id === undefined || id === null) {
        res.statusCode = 204;
        res.end();
      } else {
        sendJson(res, 200, buildJsonRpcSuccess(id, {}));
      }
      return;
    }

    if (method === "tools/list") {
      sendJson(res, 200, buildJsonRpcSuccess(id, {
        tools: MANAGED_MCP_TOOLS,
      }));
      return;
    }

    if (method === "tools/call") {
      const name = typeof params?.name === "string" ? params.name : "";
      const args = params?.arguments;

      if (!name) {
        sendJson(res, 400, buildJsonRpcError(id, -32602, "tools/call requires params.name"));
        return;
      }

      const result = await runManagedMcpTool(name, args);
      sendJson(res, 200, buildJsonRpcSuccess(id, result));
      return;
    }

    sendJson(res, 404, buildJsonRpcError(id, -32601, `Method not found: ${method || "(empty)"}`));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    sendJson(res, 400, buildJsonRpcError(id, -32000, message));
  }
}

function copyAllowedResponseHeaders(upstream, res) {
  const allowed = [
    "content-type",
    "cache-control",
    "x-request-id",
  ];

  for (const header of allowed) {
    const value = upstream.headers.get(header);
    if (value) {
      res.setHeader(header, value);
    }
  }
}

function normalizeOpenRouterPath(pathname, search) {
  const prefix = "/api/openrouter/v1";
  const rawPath = pathname.startsWith(prefix) ? pathname.slice(prefix.length) || "/" : "/";
  const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `${normalizedPath}${search || ""}`;
}

async function handleOpenRouterProxy(req, res, pathname, search) {
  const relativePathWithQuery = normalizeOpenRouterPath(pathname, search);
  const relativePath = relativePathWithQuery.split("?")[0];
  const method = req.method || "GET";

  if (hasUnmanagedClientCredentials(req)) {
    sendJson(res, 400, {
      error: "Unmanaged client credentials are not accepted. Managed server credentials are applied automatically.",
    });
    return;
  }

  const allowedMethods = OPENROUTER_ROUTE_RULES.get(relativePath);
  if (!allowedMethods) {
    sendJson(res, 404, { error: "Unsupported OpenRouter endpoint." });
    return;
  }

  if (!allowedMethods.has(method)) {
    sendJson(res, 405, { error: "Method not allowed for endpoint." });
    return;
  }

  let requestBody;
  if (method === "POST") {
    let bodyBuffer;
    try {
      bodyBuffer = await readRequestBody(req, REQUEST_BODY_LIMIT_BYTES);
    } catch (error) {
      sendJson(res, 413, { error: error instanceof Error ? error.message : "Request too large" });
      return;
    }

    let parsed;
    try {
      parsed = parseJsonBody(bodyBuffer);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Invalid JSON body" });
      return;
    }

    if (relativePath === "/chat/completions" || relativePath === "/responses") {
      const model = typeof parsed?.model === "string" ? parsed.model : "";
      if (!isOpenRouterCuratedModelId(model)) {
        sendJson(res, 400, {
          error: `Model is not allowed. Allowed models: ${OPENROUTER_CURATED_MODELS.join(", ")}`,
        });
        return;
      }
    }

    requestBody = JSON.stringify(parsed);
  }

  const target = `${OPENROUTER_BASE_URL}${relativePathWithQuery}`;
  const timeout = withTimeout(OPENROUTER_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      method,
      signal: timeout.signal,
      body: requestBody,
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        Accept: req.headers.accept || "application/json",
      },
    });

    res.statusCode = upstream.status;
    copyAllowedResponseHeaders(upstream, res);

    if (!upstream.body) {
      res.end();
      return;
    }

    const nodeReadable = Readable.fromWeb(upstream.body);
    nodeReadable.on("error", () => {
      if (!res.writableEnded) {
        res.end();
      }
    });
    nodeReadable.pipe(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenRouter request failed";
    sendJson(res, 502, { error: message });
  } finally {
    timeout.clear();
  }
}

function safeJoin(baseDir, requestPath) {
  const normalized = decodeURIComponent(requestPath).replace(/^\/+/, "");
  const fullPath = path.resolve(baseDir, normalized);
  const rel = path.relative(baseDir, fullPath);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid path");
  }

  return fullPath;
}

function serveStatic(req, res, pathname) {
  if ((req.method || "GET") !== "GET" && (req.method || "GET") !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  const requestPath = pathname === "/" ? "/index.html" : pathname;

  let fullPath;
  try {
    fullPath = safeJoin(DIST_DIR, requestPath);
  } catch {
    sendText(res, 400, "Bad request");
    return;
  }

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    // Office taskpane and app routes should still work via SPA fallback.
    const fallback = path.join(DIST_DIR, "index.html");
    if (!fs.existsSync(fallback)) {
      sendText(res, 404, "Not found");
      return;
    }

    fullPath = fallback;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const mimeType = STATIC_MIME[ext] || "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("Content-Type", mimeType);

  if (requestPath.startsWith("/assets/") && /-[a-zA-Z0-9]{8,}\./u.test(requestPath)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "no-cache");
  }

  if ((req.method || "GET") === "HEAD") {
    res.end();
    return;
  }

  const stream = fs.createReadStream(fullPath);
  stream.on("error", () => {
    if (!res.writableEnded) {
      sendText(res, 500, "Failed to read static file");
    }
  });
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const method = req.method || "GET";
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    cleanupRateLimitState();

    const ip = getClientIp(req);
    if (pathname.startsWith("/api/")) {
      if (!isApiOriginAllowed(req)) {
        sendJson(res, 403, { error: "Origin not allowed" });
        return;
      }

      if (isRateLimited(ip)) {
        sendJson(res, 429, { error: "Rate limit exceeded. Try again later." });
        return;
      }
    }

    if (pathname === "/healthz") {
      sendJson(res, 200, {
        ok: true,
        service: "flopro-backend",
        openrouterConfigured: Boolean(OPENROUTER_API_KEY),
        curatedModelCount: OPENROUTER_CURATED_MODELS.length,
      });
      return;
    }

    if (pathname.startsWith("/api/openrouter/v1")) {
      await handleOpenRouterProxy(req, res, pathname, parsedUrl.search);
      return;
    }

    if (pathname === "/api/mcp/jamaica-market") {
      await handleManagedMcpRpc(req, res);
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "Unknown API route" });
      return;
    }

    serveStatic(req, res, pathname);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[flo-pro] Backend listening on http://${HOST}:${PORT}`);
  console.log(`[flo-pro] Serving static files from ${DIST_DIR}`);
  console.log(`[flo-pro] Health: /healthz`);
  console.log(`[flo-pro] OpenRouter proxy: /api/openrouter/v1/*`);
  console.log(`[flo-pro] Managed MCP: /api/mcp/jamaica-market`);
});
