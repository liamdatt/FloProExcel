import type { RulesStore } from "../rules/store.js";
import { getUserRules, setUserRules } from "../rules/store.js";

export const FINANCIAL_MODELING_STANDARDS_SEEDED_KEY = "rules.financial_standards_seeded.v1";

export const FINANCIAL_MODELING_STANDARDS_TEXT = [
  "Financial modelling standards (default-on)",
  "",
  "General",
  "- Use a consistent professional font (Arial or Times New Roman) unless user/template says otherwise.",
  "- Deliver zero Excel formula errors (#REF!, #DIV/0!, #VALUE!, #N/A, #NAME?).",
  "- Preserve existing templates exactly when updating an established workbook.",
  "- Existing template conventions always override these defaults.",
  "",
  "Color coding (unless user/template overrides)",
  "- Blue (#0000FF): hardcoded inputs and scenario drivers.",
  "- Black (#000000): formulas and calculations.",
  "- Green (#008000): links from other worksheets in the same workbook.",
  "- Red (#FF0000): external workbook links.",
  "- Yellow fill (#FFFF00): key assumptions requiring user attention.",
  "",
  "Number formatting",
  "- Years as text strings (e.g. \"2024\").",
  "- Currency in $#,##0 and label units in headers (e.g. Revenue ($mm)).",
  "- Zero values shown as \"-\" including percentages.",
  "- Percentages default to 0.0%.",
  "- Valuation multiples formatted as 0.0x.",
  "- Negatives shown in parentheses.",
  "",
  "Formula construction",
  "- Put assumptions in dedicated assumption cells.",
  "- Reference cells instead of hardcoding constants in formulas.",
  "- Ensure formulas are consistent across periods and edge-case safe.",
  "- Avoid unintended circular references.",
  "",
  "Hardcode documentation",
  "- Add source notes for hardcoded assumptions with source/date/reference/URL.",
].join("\n");

export async function seedFinancialModelingStandardsIfEmpty(store: RulesStore): Promise<boolean> {
  const hasSeeded = await store.get(FINANCIAL_MODELING_STANDARDS_SEEDED_KEY);
  if (hasSeeded === true) {
    return false;
  }

  const currentRules = await getUserRules(store);
  let seeded = false;
  if (!currentRules) {
    await setUserRules(store, FINANCIAL_MODELING_STANDARDS_TEXT);
    seeded = true;
  }

  await store.set(FINANCIAL_MODELING_STANDARDS_SEEDED_KEY, true);
  return seeded;
}
