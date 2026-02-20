/**
 * Debug helpers.
 *
 * Intentionally lightweight: this is for temporary instrumentation toggles.
 */

import type { SlashCommand } from "../types.js";
import { showToast } from "../../ui/toast.js";
import { isDebugEnabled, setDebugEnabled, toggleDebugEnabled } from "../../debug/debug.js";

function normalizeArg(args: string): string {
  return args.trim().toLowerCase();
}

export function createDebugCommands(): SlashCommand[] {
  return [
    {
      name: "debug",
      description: "Toggle debug UI (usage breakdown, extra diagnostics)",
      source: "builtin",
      execute: (args: string) => {
        const a = normalizeArg(args);

        if (a === "" || a === "toggle") {
          const enabled = toggleDebugEnabled();
          showToast(`Debug ${enabled ? "enabled" : "disabled"}`);
          return;
        }

        if (a === "on" || a === "true" || a === "1") {
          setDebugEnabled(true);
          showToast("Debug enabled");
          return;
        }

        if (a === "off" || a === "false" || a === "0") {
          setDebugEnabled(false);
          showToast("Debug disabled");
          return;
        }

        if (a === "status") {
          showToast(`Debug is ${isDebugEnabled() ? "enabled" : "disabled"}`);
          return;
        }

        showToast("Usage: /debug [on|off|toggle|status]");
      },
    },
  ];
}
