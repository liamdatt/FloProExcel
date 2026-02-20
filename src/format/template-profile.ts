import { excelRun } from "../excel/helpers.js";

export interface TemplateProfile {
  templateMode: boolean;
  sampledSheets: number;
  nonEmptySheets: number;
  sampledCells: number;
  formattedCells: number;
  formulaCells: number;
  reason: string;
}

export interface DetectTemplateProfileOptions {
  maxSheets?: number;
  maxRowsPerSheet?: number;
  maxColsPerSheet?: number;
  minFormattedCells?: number;
  minFormattedRatio?: number;
  minFormulaCells?: number;
}

const DEFAULTS: Required<DetectTemplateProfileOptions> = {
  maxSheets: 3,
  maxRowsPerSheet: 30,
  maxColsPerSheet: 12,
  minFormattedCells: 10,
  minFormattedRatio: 0.15,
  minFormulaCells: 10,
};

function isGeneralNumberFormat(value: unknown): boolean {
  return typeof value === "string"
    && (value.trim() === "" || value.trim().toLowerCase() === "general");
}

function hasFormula(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("=");
}

function isNonEmptyCell(value: unknown, formula: unknown): boolean {
  if (hasFormula(formula)) return true;
  return value !== null && value !== undefined && value !== "";
}

export async function detectTemplateProfile(
  opts: DetectTemplateProfileOptions = {},
): Promise<TemplateProfile> {
  const resolved = { ...DEFAULTS, ...opts };

  return excelRun(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    await context.sync();

    const sampled = sheets.items.slice(0, resolved.maxSheets);
    const usedRanges = sampled.map((sheet) => {
      const used = sheet.getUsedRangeOrNullObject();
      used.load("isNullObject,rowCount,columnCount");
      return { sheet, used };
    });

    await context.sync();

    let nonEmptySheets = 0;
    let sampledCells = 0;
    let formattedCells = 0;
    let formulaCells = 0;

    for (const entry of usedRanges) {
      const used = entry.used;
      if (used.isNullObject || used.rowCount <= 0 || used.columnCount <= 0) {
        continue;
      }

      nonEmptySheets += 1;

      const sampleRows = Math.min(used.rowCount, resolved.maxRowsPerSheet);
      const sampleCols = Math.min(used.columnCount, resolved.maxColsPerSheet);
      const sampleRange = entry.sheet.getRangeByIndexes(0, 0, sampleRows, sampleCols);
      sampleRange.load("values,formulas,numberFormat");
      await context.sync();

      const values = sampleRange.values as unknown[][];
      const formulas = sampleRange.formulas as unknown[][];
      const numberFormats = sampleRange.numberFormat as unknown[][];

      for (let r = 0; r < sampleRows; r += 1) {
        for (let c = 0; c < sampleCols; c += 1) {
          const value: unknown = values[r]?.[c];
          const formula: unknown = formulas[r]?.[c];
          const numberFormat: unknown = numberFormats[r]?.[c];

          if (!isNonEmptyCell(value, formula)) continue;

          sampledCells += 1;

          if (hasFormula(formula)) {
            formulaCells += 1;
          }

          if (!isGeneralNumberFormat(numberFormat)) {
            formattedCells += 1;
          }
        }
      }
    }

    const formattedRatio = sampledCells > 0 ? formattedCells / sampledCells : 0;
    const templateMode = nonEmptySheets > 0
      && (
        formattedCells >= resolved.minFormattedCells
        || formattedRatio >= resolved.minFormattedRatio
        || formulaCells >= resolved.minFormulaCells
      );

    const reason = templateMode
      ? `Detected established workbook patterns (formatted=${formattedCells}, formulas=${formulaCells}).`
      : "No strong existing template signal detected.";

    return {
      templateMode,
      sampledSheets: sampled.length,
      nonEmptySheets,
      sampledCells,
      formattedCells,
      formulaCells,
      reason,
    };
  });
}
