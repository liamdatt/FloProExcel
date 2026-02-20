import { colToLetter } from "../excel/helpers.js";
import type { ModelingBlueprint, ModelingBlueprintStep } from "./blueprint-schema.js";

export interface BuildThreeStatementBlueprintOptions {
  startYear?: number;
  years?: number;
}

function createYearLabels(startYear: number, years: number): string[] {
  return Array.from({ length: years }, (_unused, index) => `${startYear + index}`);
}

function sheetRange(endColIndex: number, row: number): string {
  return `B${row}:${colToLetter(endColIndex)}${row}`;
}

export function buildThreeStatementBlueprint(
  opts: BuildThreeStatementBlueprintOptions = {},
): ModelingBlueprint {
  const years = Math.min(Math.max(opts.years ?? 5, 3), 10);
  const startYear = opts.startYear ?? new Date().getFullYear();
  const yearLabels = createYearLabels(startYear, years);
  const endColIndex = 1 + years - 1;
  const endColLetter = colToLetter(endColIndex);

  const assumptionsSheet = "Assumptions";
  const incomeSheet = "Income_Statement";
  const balanceSheet = "Balance_Sheet";
  const cashFlowSheet = "Cash_Flow";

  const steps: ModelingBlueprintStep[] = [
    {
      tool: "modify_structure",
      description: "Ensure assumptions sheet exists.",
      params: { action: "add_sheet", new_name: assumptionsSheet },
    },
    {
      tool: "modify_structure",
      description: "Ensure income statement sheet exists.",
      params: { action: "add_sheet", new_name: incomeSheet },
    },
    {
      tool: "modify_structure",
      description: "Ensure balance sheet exists.",
      params: { action: "add_sheet", new_name: balanceSheet },
    },
    {
      tool: "modify_structure",
      description: "Ensure cash flow sheet exists.",
      params: { action: "add_sheet", new_name: cashFlowSheet },
    },
    {
      tool: "write_cells",
      description: "Write assumption labels and starter values.",
      params: {
        start_cell: `${assumptionsSheet}!A1`,
        allow_overwrite: true,
        values: [
          ["Assumptions", ""],
          ["", ""],
          ["Opening cash", 100],
          ["Revenue (base year)", 1000],
          ["Revenue growth %", 0.05],
          ["COGS margin %", 0.45],
          ["OpEx margin %", 0.20],
          ["D&A margin %", 0.03],
          ["Tax rate %", 0.25],
          ["Capex margin %", 0.04],
          ["NWC % of revenue", 0.12],
          ["Interest rate %", 0.06],
          ["Opening debt", 300],
          ["Opening retained earnings", 150],
          ["Dividend payout %", 0.20],
        ],
      },
    },
    {
      tool: "format_cells",
      description: "Mark assumption input cells.",
      params: {
        range: `${assumptionsSheet}!B3:B15`,
        font_color: "#0000FF",
        fill_color: "#FFFF00",
      },
    },
    {
      tool: "write_cells",
      description: "Write three-statement row labels and year headers.",
      params: {
        start_cell: `${incomeSheet}!A1`,
        allow_overwrite: true,
        values: [
          ["Income Statement", ...yearLabels],
          ["Line item", ...yearLabels],
          ["Revenue"],
          ["COGS"],
          ["Gross Profit"],
          ["Operating Expenses"],
          ["EBITDA"],
          ["Depreciation & Amortization"],
          ["EBIT"],
          ["Interest Expense"],
          ["EBT"],
          ["Taxes"],
          ["Net Income"],
        ],
      },
    },
    {
      tool: "write_cells",
      description: "Write balance sheet labels.",
      params: {
        start_cell: `${balanceSheet}!A1`,
        allow_overwrite: true,
        values: [
          ["Balance Sheet", ...yearLabels],
          ["Line item", ...yearLabels],
          ["Cash"],
          ["Net Working Capital"],
          ["PP&E"],
          ["Total Assets"],
          [""],
          ["Debt"],
          ["Retained Earnings"],
          ["Total Liabilities & Equity"],
        ],
      },
    },
    {
      tool: "write_cells",
      description: "Write cash flow labels.",
      params: {
        start_cell: `${cashFlowSheet}!A1`,
        allow_overwrite: true,
        values: [
          ["Cash Flow Statement", ...yearLabels],
          ["Line item", ...yearLabels],
          ["Net Income"],
          ["D&A add-back"],
          ["Capex"],
          ["Change in NWC"],
          ["Free Cash Flow"],
          ["Dividends"],
          ["Change in Cash"],
        ],
      },
    },
    {
      tool: "fill_formula",
      description: "Populate income statement formulas.",
      params: { range: `${incomeSheet}!${sheetRange(endColIndex, 3)}`, formula: `=${assumptionsSheet}!$B$4`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Revenue projection.",
      params: { range: `${incomeSheet}!C3:${endColLetter}3`, formula: "=B3*(1+Assumptions!$B$5)", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "COGS.",
      params: { range: `${incomeSheet}!${sheetRange(endColIndex, 4)}`, formula: "=-B3*Assumptions!$B$6", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Gross profit.",
      params: { range: `${incomeSheet}!${sheetRange(endColIndex, 5)}`, formula: "=B3+B4", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Operating expenses.",
      params: { range: `${incomeSheet}!${sheetRange(endColIndex, 6)}`, formula: "=-B3*Assumptions!$B$7", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "EBITDA.",
      params: { range: `${incomeSheet}!${sheetRange(endColIndex, 7)}`, formula: "=B5+B6", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "D&A.",
      params: { range: `${incomeSheet}!${sheetRange(endColIndex, 8)}`, formula: "=-B3*Assumptions!$B$8", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "EBIT.",
      params: { range: `${incomeSheet}!${sheetRange(endColIndex, 9)}`, formula: "=B7+B8", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Interest expense.",
      params: { range: `${incomeSheet}!${sheetRange(endColIndex, 10)}`, formula: `=-${balanceSheet}!B8*${assumptionsSheet}!$B$12`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "EBT.",
      params: { range: `${incomeSheet}!${sheetRange(endColIndex, 11)}`, formula: "=B9+B10", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Taxes.",
      params: { range: `${incomeSheet}!${sheetRange(endColIndex, 12)}`, formula: "=-MAX(0,B11)*Assumptions!$B$9", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Net income.",
      params: { range: `${incomeSheet}!${sheetRange(endColIndex, 13)}`, formula: "=B11+B12", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Balance sheet core links.",
      params: { range: `${balanceSheet}!${sheetRange(endColIndex, 3)}`, formula: `=${assumptionsSheet}!$B$3`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "NWC links to revenue.",
      params: { range: `${balanceSheet}!${sheetRange(endColIndex, 4)}`, formula: `=${incomeSheet}!B3*${assumptionsSheet}!$B$11`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "PP&E rollforward.",
      params: { range: `${balanceSheet}!B5:B5`, formula: `=${assumptionsSheet}!$B$10`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "PP&E continuation.",
      params: { range: `${balanceSheet}!C5:${endColLetter}5`, formula: `=B5+${cashFlowSheet}!C4+${cashFlowSheet}!C5`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Total assets.",
      params: { range: `${balanceSheet}!${sheetRange(endColIndex, 6)}`, formula: "=B3+B4+B5", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Debt.",
      params: { range: `${balanceSheet}!${sheetRange(endColIndex, 8)}`, formula: `=${assumptionsSheet}!$B$13`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Retained earnings.",
      params: { range: `${balanceSheet}!B9:B9`, formula: `=${assumptionsSheet}!$B$14`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Retained earnings continuation.",
      params: { range: `${balanceSheet}!C9:${endColLetter}9`, formula: `=B9+${incomeSheet}!C13+${cashFlowSheet}!C8`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Total liabilities and equity.",
      params: { range: `${balanceSheet}!${sheetRange(endColIndex, 10)}`, formula: "=B8+B9", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Cash flow links.",
      params: { range: `${cashFlowSheet}!${sheetRange(endColIndex, 3)}`, formula: `=${incomeSheet}!B13`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "D&A add-back.",
      params: { range: `${cashFlowSheet}!${sheetRange(endColIndex, 4)}`, formula: `=-${incomeSheet}!B8`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Capex.",
      params: { range: `${cashFlowSheet}!${sheetRange(endColIndex, 5)}`, formula: `=-${incomeSheet}!B3*${assumptionsSheet}!$B$10`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Change in NWC.",
      params: { range: `${cashFlowSheet}!${sheetRange(endColIndex, 6)}`, formula: `=-(${balanceSheet}!B4-IFERROR(${balanceSheet}!A4,0))`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Free cash flow.",
      params: { range: `${cashFlowSheet}!${sheetRange(endColIndex, 7)}`, formula: "=SUM(B3:B6)", allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Dividends.",
      params: { range: `${cashFlowSheet}!${sheetRange(endColIndex, 8)}`, formula: `=-MAX(0,${incomeSheet}!B13*${assumptionsSheet}!$B$15)`, allow_overwrite: true },
    },
    {
      tool: "fill_formula",
      description: "Change in cash.",
      params: { range: `${cashFlowSheet}!${sheetRange(endColIndex, 9)}`, formula: "=B7+B8", allow_overwrite: true },
    },
    {
      tool: "format_cells",
      description: "Apply model headers and numeric styles.",
      params: {
        range: `${incomeSheet}!A1:${endColLetter}2,${balanceSheet}!A1:${endColLetter}2,${cashFlowSheet}!A1:${endColLetter}2`,
        style: "header",
      },
    },
    {
      tool: "format_cells",
      description: "Apply currency format to major statement blocks.",
      params: {
        range: `${incomeSheet}!B3:${endColLetter}13,${balanceSheet}!B3:${endColLetter}10,${cashFlowSheet}!B3:${endColLetter}9`,
        style: "currency",
      },
    },
    {
      tool: "model_quality_check",
      description: "Run quality scan after build.",
      params: {
        action: "scan",
      },
    },
  ];

  return {
    kind: "three_statement_model",
    version: 1,
    title: "Three-statement model blueprint",
    steps,
  };
}
