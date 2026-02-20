import type { Agent } from "@mariozechner/pi-agent-core";

import { executeModelingBlueprint } from "../../modeling/execute-blueprint.js";
import { buildThreeStatementBlueprint } from "../../modeling/plan-builder.js";
import { showToast } from "../../ui/toast.js";
import type { SlashCommand } from "../types.js";
import type { ActiveAgentProvider } from "./model.js";

function getActiveAgentOrToast(getActiveAgent: ActiveAgentProvider): Agent | null {
  const agent = getActiveAgent();
  if (!agent) {
    showToast("No active session");
    return null;
  }

  return agent;
}

function parseBuildModelArgs(args: string): { startYear?: number; years?: number } {
  const parts = args
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) return {};

  const maybeYear = Number(parts[0]);
  const maybeYears = parts.length > 1 ? Number(parts[1]) : undefined;

  return {
    startYear: Number.isFinite(maybeYear) ? Math.floor(maybeYear) : undefined,
    years: typeof maybeYears === "number" && Number.isFinite(maybeYears)
      ? Math.floor(maybeYears)
      : undefined,
  };
}

export function createModelingCommands(getActiveAgent: ActiveAgentProvider): SlashCommand[] {
  return [
    {
      name: "quality",
      description: "Run model quality scan",
      source: "builtin",
      execute: async () => {
        const agent = getActiveAgentOrToast(getActiveAgent);
        if (!agent) return;

        await agent.prompt("Run model_quality_check with action=\"scan\" and report findings grouped by severity.");
      },
    },
    {
      name: "build_model",
      description: "Build a deterministic 3-statement model template",
      source: "builtin",
      execute: async (args: string) => {
        const agent = getActiveAgentOrToast(getActiveAgent);
        if (!agent) return;

        const options = parseBuildModelArgs(args);
        const blueprint = buildThreeStatementBlueprint(options);
        const result = await executeModelingBlueprint({ agent, blueprint });

        if (result.failed > 0) {
          showToast(`Model build completed with issues: ${result.executed} steps applied, ${result.failed} failed.`);
          return;
        }

        if (result.skipped > 0) {
          showToast(`Model build completed: ${result.executed} steps applied, ${result.skipped} skipped.`);
          return;
        }

        showToast(`Model build completed: ${result.executed} steps applied.`);
      },
    },
  ];
}
