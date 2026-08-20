import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildAiAuditPrompt,
  buildAiAuditPromptCompact,
  type ReconciliationAuditPromptRow,
} from "./performance-reconciliation-ai-prompt";

function mockRow(overrides: Partial<ReconciliationAuditPromptRow> = {}): ReconciliationAuditPromptRow {
  return {
    reportDate: "2026-06-18",
    appGainCad: 120.5,
    appGainPct: 0.45,
    refGainCad: 100.25,
    refGainPct: 0.38,
    deltaCad: 20.25,
    deltaPct: 0.07,
    accountsUsed: 3,
    accountsExpected: 3,
    reasons: ["Alignement app/référence"],
    periodStart: "2026-06-01",
    periodEnd: "2026-06-18",
    baselineLookup: "2026-05-30",
    baselineActualDate: "2026-05-30",
    endActualDate: "2026-06-18",
    flowsCad: -250,
    appMethod: "session-chain",
    appNote: null,
    missingAccountLabels: [],
    staleAccountLabels: [],
    ...overrides,
  };
}

describe("buildAiAuditPrompt", () => {
  test("inclut les sections clés attendues pour un prompt AI exploitable", () => {
    const prompt = buildAiAuditPrompt({
      row: mockRow(),
      scopeSummary: "Tout · YANN",
      periodLabel: "1 mois",
      usdToCad: 1.3721,
      sessionHealthOk: true,
    });

    assert.match(prompt, /Contexte: audit de conciliation Disnat vs application/);
    assert.match(prompt, /Date rapport: 2026-06-18/);
    assert.match(prompt, /Portée active: Tout · YANN/);
    assert.match(prompt, /Période active: 1 mois/);
    assert.match(prompt, /Taux USD\/CAD: 1\.3721/);
    assert.match(prompt, /Chiffres:/);
    assert.match(prompt, /Diagnostic court: Alignement app\/référence/);
    assert.match(prompt, /Tâche demandée à l'IA:/);
    assert.match(prompt, /1\) Expliquer la cause la plus probable de l'écart\./);
  });

  test("gère correctement les valeurs manquantes", () => {
    const prompt = buildAiAuditPrompt({
      row: mockRow({
        appGainCad: null,
        appGainPct: null,
        refGainCad: null,
        refGainPct: null,
        deltaCad: null,
        deltaPct: null,
        periodStart: null,
        baselineLookup: null,
        flowsCad: null,
        appNote: null,
        missingAccountLabels: [],
        reasons: ["Référence snapshots indisponible"],
      }),
      scopeSummary: "Disnat",
      periodLabel: "AAJ",
      usdToCad: null,
      sessionHealthOk: false,
    });

    assert.match(prompt, /Santé données séance: INCOMPLETE/);
    assert.match(prompt, /Taux USD\/CAD: N\/A/);
    assert.match(prompt, /- App gain \$ CAD: N\/A/);
    assert.match(prompt, /- Baseline lookup \(cible\): N\/A/);
    assert.match(prompt, /Note app: N\/A/);
    assert.match(prompt, /Comptes sans snapshot complet: aucun/);
  });

  test("liste les comptes manquants quand présents", () => {
    const prompt = buildAiAuditPrompt({
      row: mockRow({
        missingAccountLabels: ["CELI YANN", "REER VALERIE"],
        reasons: ["Couverture comptes incomplète"],
      }),
      scopeSummary: "Disnat · YANN",
      periodLabel: "YTD",
      usdToCad: 1.35,
      sessionHealthOk: true,
    });

    assert.match(prompt, /Comptes sans snapshot complet: CELI YANN, REER VALERIE/);
    assert.match(prompt, /Diagnostic court: Couverture comptes incomplète/);
  });

  test("liste les comptes exclus pour snapshot périmé quand présents", () => {
    const prompt = buildAiAuditPrompt({
      row: mockRow({
        staleAccountLabels: ["REER YANN"],
        reasons: ["Snapshot périmé (>5j ouvrés) pour 1 compte(s)"],
      }),
      scopeSummary: "Disnat · YANN",
      periodLabel: "1 mois",
      usdToCad: 1.35,
      sessionHealthOk: true,
    });

    assert.match(prompt, /Comptes exclus \(snapshot périmé\): REER YANN/);
  });

  test("format compact orienté debug est bien généré", () => {
    const prompt = buildAiAuditPromptCompact({
      row: mockRow({
        reasons: ["Écart monétaire significatif"],
      }),
      scopeSummary: "Disnat · YANN",
      periodLabel: "YTD",
      sessionHealthOk: true,
    });

    assert.match(prompt, /^Audit rapide Disnat vs App/m);
    assert.match(prompt, /Date=2026-06-18 \| Portée=Disnat · YANN \| Période=YTD/);
    assert.match(prompt, /App: \$=120\.5, %=0\.45, method=session-chain/);
    assert.match(prompt, /Diagnostic=Écart monétaire significatif/);
    assert.match(prompt, /Réponds en 4 points:/);
  });
});
