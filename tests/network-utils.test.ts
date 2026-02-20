import assert from "node:assert/strict";
import { test } from "node:test";

import { getHttpErrorReason, runWithTimeoutAbort } from "../src/utils/network.ts";
import { normalizeManagedBaseUrl } from "../src/auth/stream-proxy.ts";

void test("getHttpErrorReason prefers non-empty response body", () => {
  assert.equal(getHttpErrorReason(502, " upstream failed "), "upstream failed");
  assert.equal(getHttpErrorReason(404, "   \n  "), "HTTP 404");
});

void test("runWithTimeoutAbort returns run result", async () => {
  const value = await runWithTimeoutAbort({
    signal: undefined,
    timeoutMs: 50,
    timeoutErrorMessage: "timed out",
    run: () => Promise.resolve("ok"),
  });

  assert.equal(value, "ok");
});

void test("runWithTimeoutAbort throws timeout error", async () => {
  await assert.rejects(
    runWithTimeoutAbort({
      signal: undefined,
      timeoutMs: 5,
      timeoutErrorMessage: "request timed out",
      run: async (_signal) => {
        return new Promise<string>(() => {
          // Never resolves; timeout drives completion.
        });
      },
    }),
    /request timed out/,
  );
});

void test("runWithTimeoutAbort preserves caller abort semantics", async () => {
  const callerController = new AbortController();

  const pending = runWithTimeoutAbort({
    signal: callerController.signal,
    timeoutMs: 200,
    timeoutErrorMessage: "request timed out",
    run: async (requestSignal) => {
      return new Promise<string>((_resolve, reject) => {
        requestSignal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    },
  });

  callerController.abort();

  await assert.rejects(pending, /^Error: Aborted$/);
});

void test("normalizeManagedBaseUrl keeps absolute https URL and trims trailing slash", () => {
  assert.equal(
    normalizeManagedBaseUrl("https://excel.floproja.com/api/openrouter/v1/"),
    "https://excel.floproja.com/api/openrouter/v1",
  );
});

void test("normalizeManagedBaseUrl converts same-origin path to absolute URL", () => {
  assert.equal(
    normalizeManagedBaseUrl("/api/openrouter/v1/", {
      browserOrigin: "https://excel.floproja.com",
    }),
    "https://excel.floproja.com/api/openrouter/v1",
  );
});

void test("normalizeManagedBaseUrl rejects invalid schemes", () => {
  assert.throws(
    () => normalizeManagedBaseUrl("ftp://excel.floproja.com/api/openrouter/v1"),
    /Managed OpenRouter base URL must be http\(s\) or same-origin path/u,
  );
});

void test("normalizeManagedBaseUrl requires browser origin for same-origin paths", () => {
  assert.throws(
    () => normalizeManagedBaseUrl("/api/openrouter/v1", { browserOrigin: null }),
    /requires a browser origin/u,
  );
});
