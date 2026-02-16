import type { AssistantInput, AssistantOutput, GuardrailWarning } from "@/types/assistant";

const MISSING_COMPANY_COPY =
  "Add company basics to generate a stronger analysis. Athena will still show a partial framework until enough metrics are provided.";

function formatPercent(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(1)}%`;
}

function formatRatio(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toFixed(2);
}

export function generateAssistantOutput(input: AssistantInput): AssistantOutput {
  const hasCompany = input.company.trim().length > 0;
  const company = hasCompany ? input.company.trim() : "this company";
  const sector = input.sector.trim().length > 0 ? input.sector.trim() : "its sector";

  const keyDataMissing =
    input.revenueGrowth == null &&
    input.roe == null &&
    input.debtToEquity == null &&
    input.fcfMargin == null;

  const snapshotParts = [
    `${company} is being assessed in ${sector} using a fundamentals-first lens.`,
    `Revenue growth: ${formatPercent(input.revenueGrowth)}, ROE: ${formatPercent(input.roe)}, Debt/Equity: ${formatRatio(input.debtToEquity)}, FCF margin: ${formatPercent(input.fcfMargin)}.`,
  ];

  if (input.contextNotes.trim()) {
    snapshotParts.push(`Context note considered: ${input.contextNotes.trim()}`);
  }
  if (!hasCompany || keyDataMissing) {
    snapshotParts.push(MISSING_COMPANY_COPY);
  }

  const bullCase: string[] = [];
  const bearCase: string[] = [];
  const monitorables: string[] = [];

  if ((input.revenueGrowth ?? 0) >= 12) {
    bullCase.push("Sustained double-digit revenue growth can support long-term compounding.");
  }
  if ((input.roe ?? 0) >= 18) {
    bullCase.push("Healthy ROE suggests efficient capital allocation and operating strength.");
  }
  if ((input.fcfMargin ?? 0) >= 8) {
    bullCase.push("Strong free-cash-flow margin improves balance-sheet flexibility.");
  }
  if (input.debtToEquity != null && input.debtToEquity <= 0.6) {
    bullCase.push("Conservative leverage lowers refinancing risk in weak cycles.");
  }
  if (input.roce != null && input.roce >= 16) {
    bullCase.push("ROCE strength indicates quality reinvestment economics.");
  }
  if (input.pe != null && input.roe != null && input.pe < 25 && input.roe > 16) {
    bullCase.push("Valuation versus quality setup appears less stretched than many growth peers.");
  }

  if (bullCase.length === 0) {
    bullCase.push("Need more complete metrics to confirm a durable bull thesis.");
  }

  if (input.revenueGrowth != null && input.revenueGrowth < 8) {
    bearCase.push("Sub-8% growth can signal demand slowdown or market-share pressure.");
  }
  if (input.roe != null && input.roe < 12) {
    bearCase.push("Lower ROE can imply weak pricing power or poor capital productivity.");
  }
  if (input.debtToEquity != null && input.debtToEquity > 1.2) {
    bearCase.push("Higher leverage raises vulnerability to rate and cash-flow shocks.");
  }
  if (input.fcfMargin != null && input.fcfMargin < 0) {
    bearCase.push("Negative FCF margin may indicate cash conversion concerns.");
  }
  if (input.pe != null && input.pe > 50) {
    bearCase.push("High P/E leaves less room for execution misses.");
  }
  if (input.pb != null && input.pb > 8) {
    bearCase.push("Elevated P/B can imply premium expectations that are hard to sustain.");
  }

  if (bearCase.length === 0) {
    bearCase.push("No major stress signal from the entered metrics; validate with filings and notes.");
  }

  monitorables.push("Quarterly revenue growth trend vs management guidance.");
  monitorables.push("Margin trajectory and cash conversion over 4-8 quarters.");
  monitorables.push("Debt movement and interest-coverage direction.");
  monitorables.push("Disclosures on related-party transactions and governance notes.");
  if (input.contextNotes.trim().length > 0) {
    monitorables.push("Track whether context notes are improving or deteriorating in future updates.");
  }
  if (!hasCompany) {
    monitorables.push("Add company name and sector to anchor the thesis.");
  }
  if (keyDataMissing) {
    monitorables.push("Populate growth, ROE, leverage, and FCF to unlock higher-confidence analysis.");
  }

  return {
    snapshot: snapshotParts.join(" "),
    bullCase,
    bearCase,
    monitorables,
  };
}

export function computeGuardrails(input: AssistantInput): GuardrailWarning[] {
  const warnings: GuardrailWarning[] = [];

  if (input.revenueGrowth != null && (input.revenueGrowth < -30 || input.revenueGrowth > 80)) {
    warnings.push({
      field: "revenueGrowth",
      message: "Revenue growth looks extreme. Please verify data source and period alignment.",
      severity: "warn",
    });
  }

  if (input.roe != null && (input.roe < -20 || input.roe > 60)) {
    warnings.push({
      field: "roe",
      message: "ROE appears outside common operating ranges for most listed companies.",
      severity: "warn",
    });
  }

  if (input.debtToEquity != null && input.debtToEquity > 5) {
    warnings.push({
      field: "debtToEquity",
      message: "Debt/Equity is unusually high. Cross-check liabilities and equity base.",
      severity: "warn",
    });
  }

  if (input.fcfMargin != null && (input.fcfMargin < -20 || input.fcfMargin > 40)) {
    warnings.push({
      field: "fcfMargin",
      message: "FCF margin seems atypical. Confirm whether this is normalized or one-off impacted.",
      severity: "info",
    });
  }

  if (input.pe != null && (input.pe < 0 || input.pe > 120)) {
    warnings.push({
      field: "pe",
      message: "P/E entered looks unrealistic for standard trailing multiples.",
      severity: "warn",
    });
  }

  if (input.pb != null && (input.pb < 0 || input.pb > 20)) {
    warnings.push({
      field: "pb",
      message: "P/B entered looks unusually high/invalid. Recheck input value.",
      severity: "info",
    });
  }

  if (input.roce != null && (input.roce < -10 || input.roce > 70)) {
    warnings.push({
      field: "roce",
      message: "ROCE is outside typical ranges. Confirm denominator and period used.",
      severity: "info",
    });
  }

  return warnings;
}
