import type { Agent } from "@mariozechner/pi-agent-core";

import { getErrorMessage } from "../utils/errors.js";
import type { BlueprintStepTool, ModelingBlueprint } from "./blueprint-schema.js";
import { validateModelingBlueprint } from "./blueprint-schema.js";

export interface BlueprintStepExecution {
  index: number;
  tool: BlueprintStepTool;
  status: "executed" | "skipped" | "failed";
  message: string;
}

export interface ExecuteBlueprintResult {
  executed: number;
  skipped: number;
  failed: number;
  steps: BlueprintStepExecution[];
}

function findTool(agent: Agent, name: BlueprintStepTool) {
  return agent.state.tools.find((tool) => tool.name === name) ?? null;
}

function firstTextContent(result: { content?: Array<{ type: string; text: string }> } | null): string {
  if (!result?.content || result.content.length === 0) return "";
  const first = result.content[0];
  if (!first || first.type !== "text") return "";
  return first.text ?? "";
}

function isAddSheetAlreadyExistsError(stepParams: Record<string, unknown>, message: string): boolean {
  if (stepParams.action !== "add_sheet") return false;
  return /already exists/iu.test(message);
}

export async function executeModelingBlueprint(args: {
  agent: Agent;
  blueprint: ModelingBlueprint;
}): Promise<ExecuteBlueprintResult> {
  const validation = validateModelingBlueprint(args.blueprint);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const steps: BlueprintStepExecution[] = [];
  let executed = 0;
  let skipped = 0;
  let failed = 0;

  const callPrefix = `build-model-${Date.now()}`;

  for (let i = 0; i < validation.blueprint.steps.length; i += 1) {
    const step = validation.blueprint.steps[i];
    const tool = findTool(args.agent, step.tool);
    if (!tool) {
      failed += 1;
      steps.push({
        index: i,
        tool: step.tool,
        status: "failed",
        message: `Tool "${step.tool}" is not available in this runtime.`,
      });
      continue;
    }

    try {
      const result = await tool.execute(
        `${callPrefix}-${i}`,
        step.params as never,
      );
      const text = firstTextContent(result as { content?: Array<{ type: string; text: string }> });

      if (isAddSheetAlreadyExistsError(step.params, text)) {
        skipped += 1;
        steps.push({
          index: i,
          tool: step.tool,
          status: "skipped",
          message: `Skipped (sheet already exists): ${step.description}`,
        });
        continue;
      }

      if (/^error[:\s]/iu.test(text.trim())) {
        failed += 1;
        steps.push({
          index: i,
          tool: step.tool,
          status: "failed",
          message: text || `Tool "${step.tool}" returned an error.`,
        });
        continue;
      }

      executed += 1;
      steps.push({
        index: i,
        tool: step.tool,
        status: "executed",
        message: step.description,
      });
    } catch (error: unknown) {
      failed += 1;
      steps.push({
        index: i,
        tool: step.tool,
        status: "failed",
        message: getErrorMessage(error),
      });
    }
  }

  return {
    executed,
    skipped,
    failed,
    steps,
  };
}
