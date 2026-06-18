export type ReconciliationAuditPromptRow = {
  reportDate: string;
  appGainCad: number | null;
  appGainPct: number | null;
  refGainCad: number | null;
  refGainPct: number | null;
  deltaCad: number | null;
  deltaPct: number | null;
  accountsUsed: number;
  accountsExpected: number;
  reasons: string[];
  periodStart: string | null;
  periodEnd: string | null;
  baselineLookup: string | null;
  flowsCad: number | null;
  appMethod: string;
  appNote: string | null;
  missingAccountLabels: string[];
};

export function buildAiAuditPrompt(params: {
  row: ReconciliationAuditPromptRow;
  scopeSummary: string;
  periodLabel: string;
  usdToCad: number | null;
  sessionHealthOk: boolean;
}): string {
  const { row, scopeSummary, periodLabel, usdToCad, sessionHealthOk } = params;
  const lines = [
    "Contexte: audit de conciliation Disnat vs application (performance portefeuille)",
    `Date rapport: ${row.reportDate}`,
    `Portée active: ${scopeSummary}`,
    `Période active: ${periodLabel}`,
    `Méthode app: ${row.appMethod}`,
    `Santé données séance: ${sessionHealthOk ? "OK" : "INCOMPLETE"}`,
    `Taux USD/CAD: ${usdToCad != null ? usdToCad.toFixed(4) : "N/A"}`,
    "",
    "Chiffres:",
    `- App gain $ CAD: ${row.appGainCad ?? "N/A"}`,
    `- Référence gain $ CAD: ${row.refGainCad ?? "N/A"}`,
    `- Écart $ CAD: ${row.deltaCad ?? "N/A"}`,
    `- App gain %: ${row.appGainPct ?? "N/A"}`,
    `- Référence gain %: ${row.refGainPct ?? "N/A"}`,
    `- Écart %: ${row.deltaPct ?? "N/A"}`,
    `- Couverture comptes: ${row.accountsUsed}/${row.accountsExpected}`,
    `- Début période: ${row.periodStart ?? "N/A"}`,
    `- Fin période: ${row.periodEnd ?? "N/A"}`,
    `- Baseline lookup: ${row.baselineLookup ?? "N/A"}`,
    `- Flux nets CAD: ${row.flowsCad ?? "N/A"}`,
    "",
    `Diagnostic court: ${row.reasons.join(" | ")}`,
    row.appNote ? `Note app: ${row.appNote}` : "Note app: N/A",
    row.missingAccountLabels.length > 0
      ? `Comptes sans snapshot complet: ${row.missingAccountLabels.join(", ")}`
      : "Comptes sans snapshot complet: aucun",
    "",
    "Tâche demandée à l'IA:",
    "1) Expliquer la cause la plus probable de l'écart.",
    "2) Dire si l'écart vient de la formule, de la couverture de données, des flux, ou du périmètre.",
    "3) Proposer les vérifications techniques minimales à faire (SQL/scripts) pour confirmer.",
    "4) Donner une recommandation concrète pour réduire cet écart.",
  ];
  return lines.join("\n");
}

export function buildAiAuditPromptCompact(params: {
  row: ReconciliationAuditPromptRow;
  scopeSummary: string;
  periodLabel: string;
  sessionHealthOk: boolean;
}): string {
  const { row, scopeSummary, periodLabel, sessionHealthOk } = params;
  const lines = [
    "Audit rapide Disnat vs App",
    `Date=${row.reportDate} | Portée=${scopeSummary} | Période=${periodLabel}`,
    `App: $=${row.appGainCad ?? "N/A"}, %=${row.appGainPct ?? "N/A"}, method=${row.appMethod}`,
    `Ref: $=${row.refGainCad ?? "N/A"}, %=${row.refGainPct ?? "N/A"}`,
    `Delta: $=${row.deltaCad ?? "N/A"}, %=${row.deltaPct ?? "N/A"}`,
    `Couverture=${row.accountsUsed}/${row.accountsExpected} | SessionHealth=${sessionHealthOk ? "OK" : "INCOMPLETE"}`,
    `FluxCAD=${row.flowsCad ?? "N/A"} | Baseline=${row.baselineLookup ?? "N/A"}`,
    `Diagnostic=${row.reasons.join(" | ")}`,
    row.missingAccountLabels.length > 0
      ? `Manquants=${row.missingAccountLabels.join(", ")}`
      : "Manquants=aucun",
    "Réponds en 4 points: cause probable, formule vs données, vérifs minimales, correction prioritaire.",
  ];
  return lines.join("\n");
}
