import { isRecord } from "../utils/type-guards.js";

export type BlueprintStepTool =
  | "modify_structure"
  | "write_cells"
  | "fill_formula"
  | "format_cells"
  | "model_quality_check";

export interface ModelingBlueprintStep {
  tool: BlueprintStepTool;
  description: string;
  params: Record<string, unknown>;
}

export interface ModelingBlueprint {
  kind: "three_statement_model";
  version: 1;
  title: string;
  steps: ModelingBlueprintStep[];
}

function isBlueprintStepTool(value: unknown): value is BlueprintStepTool {
  return value === "modify_structure"
    || value === "write_cells"
    || value === "fill_formula"
    || value === "format_cells"
    || value === "model_quality_check";
}

function isModelingBlueprintStep(value: unknown): value is ModelingBlueprintStep {
  if (!isRecord(value)) return false;
  if (!isBlueprintStepTool(value.tool)) return false;
  if (typeof value.description !== "string" || value.description.trim().length === 0) return false;
  if (!isRecord(value.params)) return false;
  return true;
}

export function isModelingBlueprint(value: unknown): value is ModelingBlueprint {
  if (!isRecord(value)) return false;
  if (value.kind !== "three_statement_model") return false;
  if (value.version !== 1) return false;
  if (typeof value.title !== "string" || value.title.trim().length === 0) return false;
  if (!Array.isArray(value.steps) || value.steps.length === 0) return false;
  return value.steps.every((step) => isModelingBlueprintStep(step));
}

export function validateModelingBlueprint(value: unknown): {
  ok: true;
  blueprint: ModelingBlueprint;
} | {
  ok: false;
  error: string;
} {
  if (!isModelingBlueprint(value)) {
    return {
      ok: false,
      error: "Invalid modeling blueprint schema.",
    };
  }

  return { ok: true, blueprint: value };
}
