import { prisma } from "@/lib/db/prisma";
import {
  computePeriodResult,
  defaultPerformanceFilters,
} from "@/features/portfolio/performance-indicator-logic";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import type {
  PerformanceIndicatorPayload,
  PerformancePeriodId,
} from "@/features/portfolio/performance-indicator-types";
import { isoDateFromDbTimestamp } from "@/features/portfolio/daily-close-key";

/** Périodes publiées par Disnat (onglet « Rendement de portefeuille ») → périodes de l'app. */
export const DISNAT_PERFORMANCE_PERIODS = [
  { id: "MONTH", label: "1 mois", appPeriod: "month" },
  { id: "MONTH3", label: "3 mois", appPeriod: "month3" },
  { id: "YEAR", label: "1 an", appPeriod: "year" },
  { id: "YEAR3", label: "3 ans", appPeriod: "year3" },
  { id: "YTD", label: "Année à date", appPeriod: "ytd" },
  { id: "ALL", label: "Depuis le début", appPeriod: "all" },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  appPeriod: PerformancePeriodId;
}>;

export type DisnatPeriodId = (typeof DISNAT_PERFORMANCE_PERIODS)[number]["id"];

export const DISNAT_PERIOD_IDS: string[] = DISNAT_PERFORMANCE_PERIODS.map((period) => period.id);

/** Écart accepté avant d'afficher un avertissement (points de %). */
export const RECONCILIATION_WARN_PTS = 0.5;
export const RECONCILIATION_ERROR_PTS = 2;

export type ParsedReferenceRow = {
  clientCode: string;
  period: string;
  valuePct: number;
};

export type ReconciliationPeriodCell = {
  period: string;
  label: string;
  appPct: number | null;
  disnatPct: number | null;
  gapPts: number | null;
  tone: ReconciliationTone;
};

export type ReconciliationClient = {
  clientCode: string;
  ownerLabels: string[];
  accountCount: number;
  periods: ReconciliationPeriodCell[];
  worstTone: ReconciliationTone;
};

export type PerformanceReconciliationPayload = {
  asOfNow: string;
  referenceDate: string | null;
  clients: ReconciliationClient[];
  referenceCount: number;
  /** Valeurs enregistrées pour la date de référence courante (suppression unitaire). */
  references: { id: string; clientCode: string; period: string; valuePct: number }[];
};

const TONE_RANK: Record<ReconciliationTone, number> = {
  unknown: 0,
  ok: 1,
  warning: 2,
  error: 3,
};

/**
 * Compare, par client Disnat et par période, le TWR de l'app aux valeurs publiées
 * dans « Rendement de portefeuille » (dernière date de référence enregistrée).
 */
export async function loadPerformanceReconciliation(
  options: { payload?: PerformanceIndicatorPayload } = {},
): Promise<PerformanceReconciliationPayload> {
  const payload =
    options.payload ??
    (await getPerformanceIndicatorPayload({
      refreshQuotes: false,
      persistSnapshots: false,
      includeCashLedger: false,
    }));

  const baseFilters = defaultPerformanceFilters(payload);
  const accountsByClient = new Map<string, PerformanceIndicatorPayload["accounts"]>();
  for (const account of payload.accounts) {
    // Seuls les comptes Disnat portent un code client (`5KFZE`, `5L3AP`, …).
    if (account.isExternal) continue;
    if (!/^[A-Z0-9]{5,}\|/i.test(account.accountKey)) continue;
    const code = clientCodeFromAccountKey(account.accountKey);
    if (!code) continue;
    const list = accountsByClient.get(code) ?? [];
    list.push(account);
    accountsByClient.set(code, list);
  }

  const latest = await prisma.disnatPerformanceReference
    .findFirst({ orderBy: { referenceDate: "desc" }, select: { referenceDate: true } })
    .catch(() => null);
  const refDateIso = latest ? isoDateFromDbTimestamp(latest.referenceDate) : null;
  const references = refDateIso
    ? await prisma.disnatPerformanceReference
        .findMany({ where: { referenceDate: new Date(`${refDateIso}T00:00:00.000Z`) } })
        .catch(() => [])
    : [];
  const referenceMap = new Map(
    references.map((row) => [`${row.clientCode}|${row.period}`, row.valuePct]),
  );

  // Recale le calcul sur la date publiée par Disnat : comparer un TWR « au 30 sept. »
  // avec une valeur app « au 4 nov. » n'aurait aucun sens.
  const comparisonPayload = refDateIso
    ? { ...payload, asOfNow: `${refDateIso}T23:59:59.000Z` }
    : payload;
  const comparisonBaseFilters = refDateIso
    ? defaultPerformanceFilters(comparisonPayload)
    : baseFilters;

  const clients: ReconciliationClient[] = [];
  for (const [clientCode, accounts] of [...accountsByClient.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const filters = {
      ...comparisonBaseFilters,
      preset: "custom" as const,
      owner: null,
      portfolioKey: null,
      includedAccountKeys: accounts.map((account) => account.accountKey),
      excludedAccountKeys: [],
    };

    const periods: ReconciliationPeriodCell[] = DISNAT_PERFORMANCE_PERIODS.map((definition) => {
      let appPct: number | null = null;
      try {
        appPct = computePeriodResult(comparisonPayload, filters, definition.appPeriod).gainPct;
      } catch {
        appPct = null;
      }
      const disnatPct = referenceMap.get(`${clientCode}|${definition.id}`) ?? null;
      const gapPts =
        appPct !== null && disnatPct !== null
          ? Math.round((appPct - disnatPct) * 100) / 100
          : null;
      return {
        period: definition.id,
        label: definition.label,
        appPct: appPct === null ? null : Math.round(appPct * 100) / 100,
        disnatPct,
        gapPts,
        tone: reconciliationTone(gapPts),
      };
    });

    const worstTone = periods.reduce<ReconciliationTone>(
      (worst, cell) => (TONE_RANK[cell.tone] > TONE_RANK[worst] ? cell.tone : worst),
      "ok",
    );

    clients.push({
      clientCode,
      ownerLabels: [
        ...new Set(accounts.map((account) => account.owner).filter(Boolean) as string[]),
      ],
      accountCount: accounts.length,
      periods,
      worstTone,
    });
  }

  return {
    asOfNow: payload.asOfNow,
    referenceDate: refDateIso,
    clients,
    referenceCount: references.length,
    references: references.map((row) => ({
      id: row.id,
      clientCode: row.clientCode,
      period: row.period,
      valuePct: row.valuePct,
    })),
  };
}

/** Enregistre (ou met à jour) les valeurs Disnat pour une date de référence. */
export async function upsertDisnatReferences(input: {
  referenceDate: string;
  rows: ParsedReferenceRow[];
  source?: string;
}): Promise<number> {
  const referenceDate = new Date(`${input.referenceDate}T00:00:00.000Z`);
  if (Number.isNaN(referenceDate.getTime())) {
    throw new Error("Date de référence invalide (AAAA-MM-JJ attendu).");
  }
  const source = input.source ?? "MANUAL";

  for (const row of input.rows) {
    if (!DISNAT_PERIOD_IDS.includes(row.period)) continue;
    await prisma.disnatPerformanceReference.upsert({
      where: {
        clientCode_period_referenceDate: {
          clientCode: row.clientCode,
          period: row.period,
          referenceDate,
        },
      },
      create: {
        clientCode: row.clientCode,
        period: row.period,
        valuePct: row.valuePct,
        referenceDate,
        source,
      },
      update: { valuePct: row.valuePct, source },
    });
  }
  return input.rows.length;
}

export async function deleteDisnatReference(id: string): Promise<void> {
  await prisma.disnatPerformanceReference.delete({ where: { id } });
}


function parsePercent(raw: string): number | null {
  const cleaned = raw
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .replace(/\u2212/g, "-")
    .replace(",", ".")
    .trim();
  if (!cleaned || cleaned === "-" || cleaned === "–") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Lit un tableau Disnat collé (CSV/TSV) :
 * `5KFZE;1,47;1,19;19,99;25,97;15,84;22,80`
 * ou avec l'en-tête `Client;1 mois;3 mois;1 an;3 ans;Année à date;Depuis le début`.
 */
export function parseDisnatReferenceCsv(text: string): {
  rows: ParsedReferenceRow[];
  errors: string[];
} {
  const rows: ParsedReferenceRow[] = [];
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const [index, line] of lines.entries()) {
    const cells = line.split(/[;\t]/).map((cell) => cell.trim());
    if (/^client/i.test(cells[0] ?? "")) continue;
    const clientCode = (cells[0] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!clientCode) continue;
    if (cells.length < 2) {
      errors.push(`Ligne ${index + 1} ignorée : aucune valeur.`);
      continue;
    }

    DISNAT_PERFORMANCE_PERIODS.forEach((period, periodIndex) => {
      const value = parsePercent(cells[periodIndex + 1] ?? "");
      if (value === null) return;
      rows.push({ clientCode, period: period.id, valuePct: value });
    });
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push("Aucune valeur reconnue (attendu : code client puis 6 pourcentages).");
  }
  return { rows, errors };
}

/**
 * Code client Disnat = préfixe du numéro de compte (`5KFZEA9` → `5KFZE`).
 * Heuristique validée sur les exports réels (5KFZE / 5L3AP).
 */
export function clientCodeFromAccountKey(accountKey: string): string {
  const number = accountKey.split("|")[0]?.replace(/\s/g, "").toUpperCase() ?? "";
  if (!number) return "";
  return number.slice(0, 5);
}

export type ReconciliationTone = "ok" | "warning" | "error" | "unknown";

export function reconciliationTone(gapPts: number | null): ReconciliationTone {
  if (gapPts === null || !Number.isFinite(gapPts)) return "unknown";
  const abs = Math.abs(gapPts);
  if (abs <= RECONCILIATION_WARN_PTS) return "ok";
  if (abs <= RECONCILIATION_ERROR_PTS) return "warning";
  return "error";
}

