import { validateOfficeProxyUrl } from "../../auth/proxy-validation.js";

import {
  DEFAULT_PYTHON_BRIDGE_URL,
  DEFAULT_TMUX_BRIDGE_URL,
  PYTHON_BRIDGE_URL_SETTING_KEY,
  TMUX_BRIDGE_URL_SETTING_KEY,
  type PythonBridgeGateDependencies,
  type PythonBridgeGateReason,
  type PythonBridgeGateResult,
  type TmuxBridgeGateDependencies,
  type TmuxBridgeGateReason,
  type TmuxBridgeGateResult,
} from "./types.js";

const BRIDGE_HEALTH_PATH = "/health";
const BRIDGE_HEALTH_TIMEOUT_MS = 900;

async function defaultGetBridgeUrl(settingKey: string): Promise<string | undefined> {
  try {
    const storageModule = await import("@mariozechner/pi-web-ui/dist/storage/app-storage.js");
    const storage = storageModule.getAppStorage();
    const value = await storage.settings.get<string>(settingKey);
    if (typeof value !== "string") return undefined;

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

async function defaultGetTmuxBridgeUrl(): Promise<string | undefined> {
  return defaultGetBridgeUrl(TMUX_BRIDGE_URL_SETTING_KEY);
}

async function defaultGetPythonBridgeUrl(): Promise<string | undefined> {
  return defaultGetBridgeUrl(PYTHON_BRIDGE_URL_SETTING_KEY);
}

async function defaultSetBridgeSetting(settingKey: string, value: string): Promise<void> {
  try {
    const storageModule = await import("@mariozechner/pi-web-ui/dist/storage/app-storage.js");
    const storage = storageModule.getAppStorage();
    await storage.settings.set(settingKey, value);
  } catch {
    // ignore (approval prompt will continue to appear if persistence is unavailable)
  }
}

export async function defaultGetApprovedPythonBridgeUrl(): Promise<string | undefined> {
  return defaultGetBridgeUrl("python.bridge.approved.url");
}

export async function defaultSetApprovedPythonBridgeUrl(bridgeUrl: string): Promise<void> {
  await defaultSetBridgeSetting("python.bridge.approved.url", bridgeUrl);
}

function defaultValidateBridgeUrl(url: string): string | null {
  try {
    return validateOfficeProxyUrl(url);
  } catch {
    return null;
  }
}

async function defaultProbeBridge(bridgeUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, BRIDGE_HEALTH_TIMEOUT_MS);

  try {
    const target = `${bridgeUrl.replace(/\/+$/, "")}${BRIDGE_HEALTH_PATH}`;
    const response = await fetch(target, {
      method: "GET",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function evaluateTmuxBridgeGate(
  dependencies: TmuxBridgeGateDependencies = {},
): Promise<TmuxBridgeGateResult> {
  // No experiment flag gate — tmux is available when bridge health passes.
  // If no URL override is configured, the default localhost bridge URL is probed.

  const getBridgeUrl = dependencies.getTmuxBridgeUrl ?? defaultGetTmuxBridgeUrl;
  const configuredBridgeUrl = await getBridgeUrl();
  const usingDefaultBridgeUrl = !configuredBridgeUrl;
  const rawBridgeUrl = configuredBridgeUrl ?? DEFAULT_TMUX_BRIDGE_URL;

  const validateBridgeUrl = dependencies.validateBridgeUrl ?? defaultValidateBridgeUrl;
  const bridgeUrl = validateBridgeUrl(rawBridgeUrl);
  if (!bridgeUrl) {
    return {
      allowed: false,
      reason: usingDefaultBridgeUrl ? "missing_bridge_url" : "invalid_bridge_url",
    };
  }

  const probeTmuxBridge = dependencies.probeTmuxBridge ?? defaultProbeBridge;
  const reachable = await probeTmuxBridge(bridgeUrl);
  if (!reachable) {
    return {
      allowed: false,
      reason: usingDefaultBridgeUrl ? "missing_bridge_url" : "bridge_unreachable",
      bridgeUrl,
    };
  }

  return {
    allowed: true,
    bridgeUrl,
  };
}

/**
 * Evaluate whether the Python/LibreOffice bridge is reachable.
 *
 * No experiment flag required. If no URL override is configured, the default
 * localhost bridge URL is probed automatically. The user approval dialog
 * (in wrappers.ts) serves as the security boundary.
 */
export async function evaluatePythonBridgeGate(
  dependencies: PythonBridgeGateDependencies = {},
): Promise<PythonBridgeGateResult> {
  const getBridgeUrl = dependencies.getPythonBridgeUrl ?? defaultGetPythonBridgeUrl;
  const configuredBridgeUrl = await getBridgeUrl();
  const usingDefaultBridgeUrl = !configuredBridgeUrl;
  const rawBridgeUrl = configuredBridgeUrl ?? DEFAULT_PYTHON_BRIDGE_URL;

  const validateBridgeUrl = dependencies.validatePythonBridgeUrl ?? defaultValidateBridgeUrl;
  const bridgeUrl = validateBridgeUrl(rawBridgeUrl);
  if (!bridgeUrl) {
    return {
      allowed: false,
      reason: usingDefaultBridgeUrl ? "missing_bridge_url" : "invalid_bridge_url",
    };
  }

  const probePythonBridge = dependencies.probePythonBridge ?? defaultProbeBridge;
  const reachable = await probePythonBridge(bridgeUrl);
  if (!reachable) {
    return {
      allowed: false,
      reason: usingDefaultBridgeUrl ? "missing_bridge_url" : "bridge_unreachable",
      bridgeUrl,
    };
  }

  return {
    allowed: true,
    bridgeUrl,
  };
}

export function buildTmuxBridgeGateErrorMessage(reason: TmuxBridgeGateReason): string {
  switch (reason) {
    case "missing_bridge_url":
      return (
        `Tmux bridge is not reachable at the default URL (${DEFAULT_TMUX_BRIDGE_URL}), ` +
        `and no URL override is configured (setting: ${TMUX_BRIDGE_URL_SETTING_KEY}).`
      );
    case "invalid_bridge_url":
      return "Tmux bridge URL is invalid. Use a full URL like https://localhost:3341.";
    case "bridge_unreachable":
      return "Tmux bridge is not reachable at the configured URL.";
  }
}

export function buildPythonBridgeGateErrorMessage(reason: PythonBridgeGateReason): string {
  switch (reason) {
    case "missing_bridge_url":
      return (
        `Python bridge is not reachable at the default URL (${DEFAULT_PYTHON_BRIDGE_URL}), ` +
        `and no URL override is configured (setting: ${PYTHON_BRIDGE_URL_SETTING_KEY}).`
      );
    case "invalid_bridge_url":
      return "Python bridge URL is invalid. Use a full URL like https://localhost:3340.";
    case "bridge_unreachable":
      return "Python bridge is not reachable at the configured URL.";
  }
}
