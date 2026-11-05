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
import {
  computeMoneyWeightedReturn,
  daysBetweenIso,
} from "@/features/portfolio/performance-money-weighted";

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
  /** Méthode utilisée pour la valeur app : TRI (méthode Disnat) ou TWR (périodes courtes). */
  method?: "tri" | "twr";
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

/** Encaisse officielle utilisable si capturée à ±45 jours de la borne. */
const CASH_SNAPSHOT_TOLERANCE_DAYS = 45;

/** Encaisse capturée par le favori (« Vue d'ensemble ») pour chaque client, triée par date. */
async function loadCashSnapshotsByClient(
  clientCodes: string[],
): Promise<Map<string, { asOfDate: string; cashCad: number }[]>> {
  const map = new Map<string, { asOfDate: string; cashCad: number }[]>();
  if (clientCodes.length === 0) return map;
  const rows = await prisma.disnatClientCashSnapshot
    .findMany({
      where: { clientCode: { in: clientCodes } },
      orderBy: { asOfDate: "asc" },
      select: { clientCode: true, asOfDate: true, cashCad: true },
    })
    .catch(() => []);
  for (const row of rows) {
    const list = map.get(row.clientCode) ?? [];
    list.push({ asOfDate: isoDateFromDbTimestamp(row.asOfDate), cashCad: row.cashCad });
    map.set(row.clientCode, list);
  }
  return map;
}

/** Encaisse la plus récente à la date donnée (tolérance ±45 j), 0 si aucune capture. */
function cashAt(
  snapshots: { asOfDate: string; cashCad: number }[] | undefined,
  isoDate: string,
): number {
  if (!snapshots?.length) return 0;
  let best: { asOfDate: string; cashCad: number } | null = null;
  for (const snapshot of snapshots) {
    if (daysBetweenIso(snapshot.asOfDate, isoDate) < 0) break;
    best = snapshot;
  }
  if (!best) return 0;
  if (Math.abs(daysBetweenIso(best.asOfDate, isoDate)) > CASH_SNAPSHOT_TOLERANCE_DAYS) return 0;
  return best.cashCad;
}

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
  const cashByClient = await loadCashSnapshotsByClient([...accountsByClient.keys()]);
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
      let appMethod: "tri" | "twr" | undefined;
      try {
        const result = computePeriodResult(comparisonPayload, filters, definition.appPeriod);
        const start = result.periodStart;
        const end = result.periodEnd;
        if (start && end) {
          const accountKeySet = new Set(accounts.map((account) => account.accountKey));
          // Périodes courtes : le TRI est sensible à l'encaisse absente aux bornes, on garde le
          // TWR (identique à Disnat quand les mouvements sont faibles). Au-delà d'un an, on
          // applique la méthode officielle Disnat (TRI, cf. /docs).
          if (daysBetweenIso(start, end) <= 366) {
            appPct = result.gainPct;
            appMethod = "twr";
          } else {
            const moneyWeighted = computeMoneyWeightedReturn({
              startIso: start,
              // Encaisse officielle capturée par le favori (page « Vue d'ensemble »), sinon 0 :
              // c'est elle qui explique l'essentiel de l'écart résiduel sur les périodes courtes.
              startValue:
                clientValueAt(comparisonPayload, accountKeySet, start) +
                cashAt(cashByClient.get(clientCode), start),
              endIso: end,
              // Valeur **à la date de fin** (reconstruction), pas la valorisation live :
              // l'écart mesuré sur l'état de compte officiel est de 0,02 % avec cette source,
              // contre ~1,5 % avec `currentCad` (cours du jour).
              endValue:
                clientValueAt(comparisonPayload, accountKeySet, end) +
                cashAt(cashByClient.get(clientCode), end),
              flows: comparisonPayload.cashFlows
                .filter(
                  (flow) =>
                    accountKeySet.has(flow.accountKey) &&
                    flow.tradeDate > start &&
                    flow.tradeDate <= end &&
                    (flow.txCategory === "CONTRIBUTION" ||
                      flow.txCategory === "TRANSFER_IN" ||
                      flow.txCategory === "TRANSFER_OUT"),
                )
                .map((flow) => ({
                  date: flow.tradeDate,
                  amount: Math.abs(flow.amountCad),
                  direction: (flow.txCategory === "TRANSFER_OUT" ? "out" : "in") as "in" | "out",
                })),
            });
            appPct = moneyWeighted.gainPct;
            appMethod = "tri";
          }
        }
      } catch {
        appPct = null;
        appMethod = undefined;
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
        method: appMethod,
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

/** Valeur CAD du portefeuille client à une date donnée (dernier point connu par compte).
 *
 * On s'appuie uniquement sur la reconstruction quotidienne des titres : les snapshots d'import
 * et le ledger d'encaisse ne sont pas homogènes d'une source à l'autre (testé : ils faussent le
 * TRI de plusieurs points). L'encaisse manquante aux bornes est l'écart résiduel documenté.
 */
function clientValueAt(
  payload: PerformanceIndicatorPayload,
  accountKeys: Set<string>,
  isoDate: string,
): number {
  const fallbackFx = payload.usdToCad ?? 1;
  const lastByAccount = new Map<string, { asOf: string; value: number; currency: string }>();

  for (const point of payload.historyPoints) {
    if (!accountKeys.has(point.accountKey) || point.asOf > isoDate) continue;
    const current = lastByAccount.get(point.accountKey);
    if (!current || point.asOf >= current.asOf) {
      lastByAccount.set(point.accountKey, {
        asOf: point.asOf,
        value: point.marketValueNative ?? point.totalValueNative ?? 0,
        currency: point.currency,
      });
    }
  }

  let total = 0;
  for (const row of lastByAccount.values()) {
    const curve = row.currency.trim().toUpperCase();
    const fx =
      curve === "USD" || curve === "US"
        ? (payload.usdCadRateByDate[row.asOf] ?? fallbackFx)
        : 1;
    total += row.value * fx;
  }
  return total;
}

export function reconciliationTone(gapPts: number | null): ReconciliationTone {
  if (gapPts === null || !Number.isFinite(gapPts)) return "unknown";
  const abs = Math.abs(gapPts);
  if (abs <= RECONCILIATION_WARN_PTS) return "ok";
  if (abs <= RECONCILIATION_ERROR_PTS) return "warning";
  return "error";
}

