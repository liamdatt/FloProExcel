import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import {
  MANAGED_OPENROUTER_API_KEY_SENTINEL,
} from "../shared/openrouter-curated-models.mjs";

const BACKEND_SCRIPT_PATH = new URL("../server/index.mjs", import.meta.url).pathname;

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("Failed to get free port"));
        return;
      }

      const { port } = addr;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function createTempDist() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "flopro-dist-"));
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.writeFile(path.join(dir, "index.html"), "<html><body>ok</body></html>", "utf8");
  await fs.writeFile(path.join(dir, "src", "taskpane.html"), "<html><body>taskpane</body></html>", "utf8");
  return dir;
}

async function startHttpServer(handler) {
  const port = await getFreePort();
  const server = http.createServer(handler);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(undefined));
  });

  return {
    port,
    stop: async () => {
      await new Promise((resolve) => {
        server.close(() => resolve(undefined));
      });
    },
  };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : {};
}

function respondJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function startManagedBackend(args = {}) {
  const distDir = await createTempDist();

  const openRouterRequests = [];
  const openRouter = await startHttpServer(async (req, res) => {
    if (req.url === "/chat/completions" && req.method === "POST") {
      const body = await readJsonBody(req);
      openRouterRequests.push({
        path: req.url,
        method: req.method,
        headers: req.headers,
        body,
      });
      respondJson(res, 200, {
        id: "mock-chat-id",
        object: "chat.completion",
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      });
      return;
    }

    if (req.url === "/models" && req.method === "GET") {
      openRouterRequests.push({
        path: req.url,
        method: req.method,
        headers: req.headers,
        body: null,
      });
      respondJson(res, 200, { data: [{ id: "google/gemini-3.1-pro-preview" }] });
      return;
    }

    respondJson(res, 404, { error: "not found" });
  });

  const jamaicaRequests = [];
  const jamaica = await startHttpServer((req, res) => {
    jamaicaRequests.push({ path: req.url || "/", method: req.method || "GET", headers: req.headers });

    if ((req.url || "").startsWith("/company/")) {
      respondJson(res, 200, { symbol: req.url?.split("/").at(-1) ?? "" });
      return;
    }

    if (req.url === "/company") {
      respondJson(res, 200, [{ symbol: "GK" }, { symbol: "NCBFG" }]);
      return;
    }

    if ((req.url || "").startsWith("/statement/")) {
      respondJson(res, 200, { ok: true });
      return;
    }

    if ((req.url || "").startsWith("/all_statements/")) {
      respondJson(res, 200, { ok: true });
      return;
    }

    if ((req.url || "").startsWith("/price_data/")) {
      respondJson(res, 200, [{ date: "2026-01-02", close: 100 }]);
      return;
    }

    respondJson(res, 404, { error: "not found" });
  });

  const port = await getFreePort();
  const child = spawn(process.execPath, [BACKEND_SCRIPT_PATH], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DIST_DIR: distDir,
      OPENROUTER_API_KEY: "server-openrouter-key",
      OPENROUTER_BASE_URL: `http://127.0.0.1:${openRouter.port}`,
      JAMAICA_API_BASE_URL: `http://127.0.0.1:${jamaica.port}`,
      RATE_LIMIT_WINDOW_MS: String(args.rateLimitWindowMs ?? 60_000),
      RATE_LIMIT_MAX_REQUESTS: String(args.rateLimitMaxRequests ?? 120),
      REQUEST_BODY_LIMIT_BYTES: String(args.requestBodyLimitBytes ?? 1_000_000),
      ...(args.env || {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("Backend listening on")) {
        resolve(undefined);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.once("exit", (code, signal) => {
      reject(new Error(`backend exited before ready (code=${String(code)} signal=${String(signal)})\n${stdout}\n${stderr}`));
    });
  });

  await Promise.race([
    ready,
    delay(7000).then(() => {
      throw new Error(`backend start timeout\n${stdout}\n${stderr}`);
    }),
  ]);

  const stop = async () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }

    await Promise.race([
      once(child, "exit"),
      delay(3000).then(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }),
    ]).catch(() => {});

    await openRouter.stop();
    await jamaica.stop();
    await fs.rm(distDir, { recursive: true, force: true });
  };

  return {
    port,
    stop,
    openRouterRequests,
    jamaicaRequests,
  };
}

test("health endpoint returns backend status", async (t) => {
  const backend = await startManagedBackend();
  t.after(async () => {
    await backend.stop();
  });

  const response = await fetch(`http://127.0.0.1:${backend.port}/healthz`);
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.openrouterConfigured, true);
  assert.equal(typeof payload.curatedModelCount, "number");
  assert.ok(payload.curatedModelCount >= 1);
});

test("OpenRouter passthrough enforces curated model allowlist", async (t) => {
  const backend = await startManagedBackend();
  t.after(async () => {
    await backend.stop();
  });

  const response = await fetch(`http://127.0.0.1:${backend.port}/api/openrouter/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/not-allowed-model",
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /Model is not allowed/);
  assert.equal(backend.openRouterRequests.length, 0);
});

test("OpenRouter passthrough injects managed API key and blocks client credentials", async (t) => {
  const backend = await startManagedBackend();
  t.after(async () => {
    await backend.stop();
  });

  const blocked = await fetch(`http://127.0.0.1:${backend.port}/api/openrouter/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer user-provided-key",
    },
    body: JSON.stringify({
      model: "google/gemini-3.1-pro-preview",
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  assert.equal(blocked.status, 400);

  const ok = await fetch(`http://127.0.0.1:${backend.port}/api/openrouter/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MANAGED_OPENROUTER_API_KEY_SENTINEL}`,
    },
    body: JSON.stringify({
      model: "google/gemini-3.1-pro-preview",
      messages: [{ role: "user", content: "hello" }],
    }),
  });

  assert.equal(ok.status, 200);
  const payload = await ok.json();
  assert.equal(payload.model, "google/gemini-3.1-pro-preview");

  assert.equal(backend.openRouterRequests.length, 1);
  assert.equal(
    backend.openRouterRequests[0].headers.authorization,
    "Bearer server-openrouter-key",
  );
});

test("backend rate limiting returns 429 after configured threshold", async (t) => {
  const backend = await startManagedBackend({
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 1,
  });
  t.after(async () => {
    await backend.stop();
  });

  const first = await fetch(`http://127.0.0.1:${backend.port}/api/openrouter/v1/models`);
  assert.equal(first.status, 200);

  const second = await fetch(`http://127.0.0.1:${backend.port}/api/openrouter/v1/models`);
  assert.equal(second.status, 429);
});

test("managed MCP server supports initialize/list/call and normalizes symbol", async (t) => {
  const backend = await startManagedBackend();
  t.after(async () => {
    await backend.stop();
  });

  const initialize = await fetch(`http://127.0.0.1:${backend.port}/api/mcp/jamaica-market`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    }),
  });
  assert.equal(initialize.status, 200);
  const initPayload = await initialize.json();
  assert.equal(initPayload.result.serverInfo.name, "flo-pro-jamaica-market");

  const list = await fetch(`http://127.0.0.1:${backend.port}/api/mcp/jamaica-market`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }),
  });
  assert.equal(list.status, 200);
  const listPayload = await list.json();
  assert.equal(Array.isArray(listPayload.result.tools), true);
  assert.ok(listPayload.result.tools.some((tool) => tool.name === "jm_get_company"));

  const call = await fetch(`http://127.0.0.1:${backend.port}/api/mcp/jamaica-market`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "jm_get_company",
        arguments: { symbol: "gk" },
      },
    }),
  });
  assert.equal(call.status, 200);
  const callPayload = await call.json();
  assert.equal(callPayload.result.structuredContent.symbol, "GK");
  assert.ok(backend.jamaicaRequests.some((request) => request.path === "/company/GK"));
});

test("managed MCP validation rejects invalid statement frequency", async (t) => {
  const backend = await startManagedBackend();
  t.after(async () => {
    await backend.stop();
  });

  const response = await fetch(`http://127.0.0.1:${backend.port}/api/mcp/jamaica-market`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "jm_get_statement",
        arguments: {
          symbol: "GK",
          frequency: "Monthly",
          statement_type: "IS",
        },
      },
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, -32000);
  assert.match(payload.error.message, /frequency must be Annual or Quarterly/);
});

test("API origin allowlist blocks unknown browser origins", async (t) => {
  const backend = await startManagedBackend();
  t.after(async () => {
    await backend.stop();
  });

  const response = await fetch(`http://127.0.0.1:${backend.port}/api/openrouter/v1/models`, {
    headers: {
      Origin: "https://evil.example",
    },
  });

  assert.equal(response.status, 403);
  const payload = await response.json();
  assert.match(payload.error, /Origin not allowed/);
});
