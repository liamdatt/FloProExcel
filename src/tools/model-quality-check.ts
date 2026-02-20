import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import { excelRun } from "../excel/helpers.js";
import { getResolvedConventions, normalizeConventionColor } from "../conventions/store.js";
import type { ResolvedConventions } from "../conventions/types.js";
import { getErrorMessage } from "../utils/errors.js";
import { isExcelError } from "../utils/format.js";
import type { ModelQualityCheckDetails } from "./tool-details.js";

const schema = Type.Object({
  action: Type.Union([Type.Literal("scan"), Type.Literal("autofix_safe")], {
    description: "scan = report quality issues, autofix_safe = apply non-destructive style/source-note fixes and report.",
  }),
  max_issues: Type.Optional(Type.Number({
    description: "Maximum issues to return in the report (default 120).",
  })),
  add_source_note_placeholders: Type.Optional(Type.Boolean({
    description: "When action=autofix_safe, add placeholder source comments to highlighted assumption cells without notes. Default true.",
  })),
});

type Params = Static<typeof schema>;

type QualityIssueKind =
  | "formula_error"
  | "formula_pattern_inconsistency"
  | "hardcoded_literal_in_formula"
  | "format_violation"
  | "missing_source_note";

interface QualityIssue {
  kind: QualityIssueKind;
  sheet: string;
  cell: string;
  message: string;
  severity: "high" | "medium" | "low";
}

interface ScanResult {
  scannedSheets: number;
  scannedCells: number;
  issues: QualityIssue[];
  fixesApplied: number;
}

const DEFAULT_MAX_ISSUES = 120;
const MAX_ROWS_PER_SHEET = 120;
const MAX_COLS_PER_SHEET = 30;
const SOURCE_NOTE_PLACEHOLDER =
  "Source: [System/Document], [Date], [Specific Reference], [URL if applicable]";

function normalizeAddressCell(address: string): string {
  return address.includes("!") ? address.split("!")[1] : address;
}

function normalizeFormulaPattern(formula: string): string {
  return formula
    .replace(/\$?[A-Z]{1,3}\$?\d+/gu, "CELL")
    .replace(/\b\d+(\.\d+)?\b/gu, "NUM")
    .replace(/\s+/gu, "")
    .toUpperCase();
}

function hasHardcodedNumericLiteral(formula: string): boolean {
  const withoutCellRefs = formula.replace(/\$?[A-Z]{1,3}\$?\d+/gu, "");
  return /(^|[^A-Z_])\d+(\.\d+)?($|[^A-Z_])/iu.test(withoutCellRefs);
}

function expectedFormulaColor(args: {
  formula: string;
  formulaColor: string;
  crossSheetLinkColor: string;
  externalLinkColor: string;
}): string {
  if (args.formula.includes("[")) {
    return args.externalLinkColor;
  }
  if (args.formula.includes("!")) {
    return args.crossSheetLinkColor;
  }
  return args.formulaColor;
}

function pushIssue(
  issues: QualityIssue[],
  byKind: Record<QualityIssueKind, number>,
  issue: QualityIssue,
  maxIssues: number,
): void {
  byKind[issue.kind] += 1;
  if (issues.length < maxIssues) {
    issues.push(issue);
  }
}

function formatSummaryMarkdown(args: {
  action: "scan" | "autofix_safe";
  result: ScanResult;
  byKind: Record<QualityIssueKind, number>;
}): string {
  const { action, result, byKind } = args;
  const lines: string[] = [];

  lines.push(`## Model quality ${action === "scan" ? "scan" : "autofix report"}`);
  lines.push(`- Sheets scanned: ${result.scannedSheets}`);
  lines.push(`- Cells scanned: ${result.scannedCells}`);
  lines.push(`- Issues found: ${Object.values(byKind).reduce((sum, count) => sum + count, 0)}`);

  if (action === "autofix_safe") {
    lines.push(`- Safe fixes applied: ${result.fixesApplied}`);
  }

  lines.push("");
  lines.push("### Issue counts");
  lines.push(`- Formula errors: ${byKind.formula_error}`);
  lines.push(`- Formula consistency: ${byKind.formula_pattern_inconsistency}`);
  lines.push(`- Hardcoded literals in formulas: ${byKind.hardcoded_literal_in_formula}`);
  lines.push(`- Formatting rule violations: ${byKind.format_violation}`);
  lines.push(`- Missing source notes: ${byKind.missing_source_note}`);

  if (result.issues.length === 0) {
    lines.push("", "No issues detected in the sampled workbook range.");
    return lines.join("\n");
  }

  lines.push("", "### Sample findings");
  for (const issue of result.issues.slice(0, 20)) {
    lines.push(`- [${issue.severity}] ${issue.sheet}!${issue.cell}: ${issue.message}`);
  }

  const hiddenIssueCount = result.issues.length > 20 ? result.issues.length - 20 : 0;
  if (hiddenIssueCount > 0) {
    lines.push(`- …and ${hiddenIssueCount} more in the sampled report.`);
  }

  return lines.join("\n");
}

async function runScan(args: {
  action: "scan" | "autofix_safe";
  maxIssues: number;
  addSourceNotePlaceholders: boolean;
  conventions: Awaited<ReturnType<typeof getResolvedConventions>>;
}): Promise<{ result: ScanResult; byKind: Record<QualityIssueKind, number> }> {
  const byKind: Record<QualityIssueKind, number> = {
    formula_error: 0,
    formula_pattern_inconsistency: 0,
    hardcoded_literal_in_formula: 0,
    format_violation: 0,
    missing_source_note: 0,
  };

  const result = await excelRun<ScanResult>(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    await context.sync();

    const issues: QualityIssue[] = [];
    let scannedSheets = 0;
    let scannedCells = 0;
    let fixesApplied = 0;

    for (const sheet of sheets.items) {
      const used = sheet.getUsedRangeOrNullObject();
      used.load("isNullObject,rowCount,columnCount");
      await context.sync();

      if (used.isNullObject || used.rowCount <= 0 || used.columnCount <= 0) {
        continue;
      }

      scannedSheets += 1;

      const rowCount = Math.min(used.rowCount, MAX_ROWS_PER_SHEET);
      const colCount = Math.min(used.columnCount, MAX_COLS_PER_SHEET);
      const sampleRange = sheet.getRangeByIndexes(0, 0, rowCount, colCount);
      sampleRange.load("values,formulas,numberFormat");

      const comments = sheet.comments;
      comments.load("items");
      await context.sync();

      const commentLocations = comments.items.map((comment) => {
        const location = comment.getLocation();
        location.load("address");
        return location;
      });
      await context.sync();

      const commentAddressSet = new Set<string>();
      for (const location of commentLocations) {
        commentAddressSet.add(normalizeAddressCell(location.address).toUpperCase());
      }

      const cellRefs: Array<{
        row: number;
        col: number;
        cell: Excel.Range;
      }> = [];

      for (let r = 0; r < rowCount; r += 1) {
        for (let c = 0; c < colCount; c += 1) {
          const cell = sampleRange.getCell(r, c);
          cell.load("address,values,formulas");
          cell.format.font.load("color");
          cell.format.fill.load("color");
          cellRefs.push({ row: r, col: c, cell });
        }
      }

      await context.sync();

      const rowFormulaPatterns = new Map<number, Array<{ cell: string; pattern: string }>>();
      const colorRules = args.conventions.colorConventions;

      for (const ref of cellRefs) {
        const cellAddress = normalizeAddressCell(ref.cell.address);
        const values = ref.cell.values as unknown[][];
        const formulas = ref.cell.formulas as unknown[][];
        const value: unknown = values[0]?.[0];
        const formula: unknown = formulas[0]?.[0];

        const hasValue = value !== null && value !== undefined && value !== "";
        const hasFormula = typeof formula === "string" && formula.startsWith("=");
        if (!hasValue && !hasFormula) continue;
        scannedCells += 1;

        if (isExcelError(value)) {
          pushIssue(issues, byKind, {
            kind: "formula_error",
            severity: "high",
            sheet: sheet.name,
            cell: cellAddress,
            message: `Formula error value ${value}.`,
          }, args.maxIssues);
        }

        if (hasFormula && typeof formula === "string") {
          if (hasHardcodedNumericLiteral(formula)) {
            pushIssue(issues, byKind, {
              kind: "hardcoded_literal_in_formula",
              severity: "medium",
              sheet: sheet.name,
              cell: cellAddress,
              message: `Formula contains numeric literals: ${formula}`,
            }, args.maxIssues);
          }

          const rowPatterns = rowFormulaPatterns.get(ref.row) ?? [];
          rowPatterns.push({ cell: cellAddress, pattern: normalizeFormulaPattern(formula) });
          rowFormulaPatterns.set(ref.row, rowPatterns);
        }

        const actualFontColor = normalizeConventionColor(ref.cell.format.font.color) ?? "";
        const actualFillColor = normalizeConventionColor(ref.cell.format.fill.color) ?? "";

        if (hasFormula && typeof formula === "string") {
          const expected = expectedFormulaColor({
            formula,
            formulaColor: colorRules.formulaColor,
            crossSheetLinkColor: colorRules.crossSheetLinkColor,
            externalLinkColor: colorRules.externalLinkColor,
          });

          if (actualFontColor !== expected) {
            pushIssue(issues, byKind, {
              kind: "format_violation",
              severity: "low",
              sheet: sheet.name,
              cell: cellAddress,
              message: `Formula color is ${actualFontColor || "(automatic)"}, expected ${expected}.`,
            }, args.maxIssues);

            if (args.action === "autofix_safe") {
              ref.cell.format.font.color = expected;
              fixesApplied += 1;
            }
          }
        } else if (typeof value === "number") {
          if (actualFontColor !== colorRules.hardcodedValueColor) {
            pushIssue(issues, byKind, {
              kind: "format_violation",
              severity: "low",
              sheet: sheet.name,
              cell: cellAddress,
              message: `Input value color is ${actualFontColor || "(automatic)"}, expected ${colorRules.hardcodedValueColor}.`,
            }, args.maxIssues);

            if (args.action === "autofix_safe") {
              ref.cell.format.font.color = colorRules.hardcodedValueColor;
              fixesApplied += 1;
            }
          }
        }

        const isAssumptionCell = actualFillColor === colorRules.assumptionFillColor;
        const hasSourceNote = commentAddressSet.has(cellAddress.toUpperCase());
        if (isAssumptionCell && !hasSourceNote) {
          pushIssue(issues, byKind, {
            kind: "missing_source_note",
            severity: "medium",
            sheet: sheet.name,
            cell: cellAddress,
            message: "Highlighted assumption cell is missing a source note comment.",
          }, args.maxIssues);

          if (args.action === "autofix_safe" && args.addSourceNotePlaceholders) {
            sheet.comments.add(cellAddress, SOURCE_NOTE_PLACEHOLDER);
            commentAddressSet.add(cellAddress.toUpperCase());
            fixesApplied += 1;
          }
        }
      }

      for (const rowPatterns of rowFormulaPatterns.values()) {
        if (rowPatterns.length < 3) continue;

        const counts = new Map<string, number>();
        for (const entry of rowPatterns) {
          counts.set(entry.pattern, (counts.get(entry.pattern) ?? 0) + 1);
        }

        let expectedPattern = "";
        let expectedCount = 0;
        for (const [pattern, count] of counts.entries()) {
          if (count > expectedCount) {
            expectedPattern = pattern;
            expectedCount = count;
          }
        }

        for (const entry of rowPatterns) {
          if (entry.pattern === expectedPattern) continue;
          pushIssue(issues, byKind, {
            kind: "formula_pattern_inconsistency",
            severity: "medium",
            sheet: sheet.name,
            cell: entry.cell,
            message: "Formula pattern differs from peer period cells in this row.",
          }, args.maxIssues);
        }
      }

      if (args.action === "autofix_safe") {
        await context.sync();
      }
    }

    return {
      scannedSheets,
      scannedCells,
      issues,
      fixesApplied,
    };
  });

  return { result, byKind };
}

interface ModelQualityCheckToolDependencies {
  getConventions: () => Promise<ResolvedConventions>;
  runScan: (args: {
    action: "scan" | "autofix_safe";
    maxIssues: number;
    addSourceNotePlaceholders: boolean;
    conventions: ResolvedConventions;
  }) => Promise<{ result: ScanResult; byKind: Record<QualityIssueKind, number> }>;
}

const defaultDependencies: ModelQualityCheckToolDependencies = {
  getConventions: async () => {
    const storageModule = await import("@mariozechner/pi-web-ui/dist/storage/app-storage.js");
    return getResolvedConventions(storageModule.getAppStorage().settings);
  },
  runScan,
};

export function createModelQualityCheckTool(
  dependencies: Partial<ModelQualityCheckToolDependencies> = {},
): AgentTool<typeof schema, ModelQualityCheckDetails> {
  const resolvedDependencies: ModelQualityCheckToolDependencies = {
    getConventions: dependencies.getConventions ?? defaultDependencies.getConventions,
    runScan: dependencies.runScan ?? defaultDependencies.runScan,
  };

  return {
    name: "model_quality_check",
    label: "Model Quality Check",
    description:
      "Scan workbook model quality (formula errors, consistency, hardcoded literals, formatting rules, source notes) and optionally apply safe autofixes.",
    parameters: schema,
    execute: async (
      _toolCallId: string,
      params: Params,
    ): Promise<AgentToolResult<ModelQualityCheckDetails>> => {
      try {
        const action = params.action;
        const maxIssues = Number.isFinite(params.max_issues ?? NaN)
          ? Math.max(10, Math.min(Math.floor(params.max_issues ?? DEFAULT_MAX_ISSUES), 500))
          : DEFAULT_MAX_ISSUES;
        const addSourceNotePlaceholders = params.add_source_note_placeholders !== false;

        const conventions = await resolvedDependencies.getConventions();
        const { result, byKind } = await resolvedDependencies.runScan({
          action,
          maxIssues,
          addSourceNotePlaceholders,
          conventions,
        });

        const details: ModelQualityCheckDetails = {
          kind: "model_quality_check",
          action,
          scannedSheets: result.scannedSheets,
          scannedCells: result.scannedCells,
          issueCount: Object.values(byKind).reduce((sum, count) => sum + count, 0),
          fixesApplied: result.fixesApplied,
          byKind,
        };

        return {
          content: [{
            type: "text",
            text: formatSummaryMarkdown({ action, result, byKind }),
          }],
          details,
        };
      } catch (error: unknown) {
        return {
          content: [{
            type: "text",
            text: `Error running model quality check: ${getErrorMessage(error)}`,
          }],
          details: {
            kind: "model_quality_check",
            action: params.action,
            scannedSheets: 0,
            scannedCells: 0,
            issueCount: 0,
            fixesApplied: 0,
            byKind: {
              formula_error: 0,
              formula_pattern_inconsistency: 0,
              hardcoded_literal_in_formula: 0,
              format_violation: 0,
              missing_source_note: 0,
            },
          },
        };
      }
    },
  };
}
