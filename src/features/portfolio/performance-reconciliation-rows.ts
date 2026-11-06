import {
  computePeriodResultWithSnapshots,
  disnatTitresMaterialKeys,
  minAcceptableHistoryAsOf,
  resolveActiveAccountKeys,
  resolvePeriodBounds,
  TITRES_HISTORY_MAX_GAP_TRADING_DAYS,
} from "./performance-indicator-logic";
import {
  favoriCoversScope,
  favoriReferenceForClient,
  favoriReportDates,
  groupAccountKeysByClient,
} from "./favori-reference";
import type {
  PerformanceFilterState,
  PerformanceIndicatorPayload,
  PerformancePortfolioScope,
} from "./performance-indicator-types";

/**
 * Lignes du tableau « Conciliation (mêmes dates de rapport) » : pour chaque date de rapport,
 * le gain calculé par l'app est comparé à une référence reconstruite (ou officielle) sur la
 * même période.
 *
 * Extrait du composant pour être testable : la logique dépendait d'un `useMemo` de 300 lignes,
 * ce qui a laissé passer un bug de bornes (toutes les dates comparées à la séance du jour).
 */
export type ReconciliationRow = {
  reportDate: string;
  appGainCad: number | null;
  appGainPct: number | null;
  refGainCad: number | null;
  refGainPct: number | null;
  deltaCad: number | null;
  deltaPct: number | null;
  accountsUsed: number;
  accountsExpected: number;
  incomplete: boolean;
  reasons: string[];
  periodStart: string | null;
  periodEnd: string | null;
  baselineLookup: string | null;
  /** Date réelle (la plus ancienne parmi les comptes utilisés) du snapshot de départ retenu. */
  baselineActualDate: string | null;
  /** Date réelle (la plus ancienne parmi les comptes utilisés) du snapshot de fin retenu. */
  endActualDate: string | null;
  flowsCad: number | null;
  appMethod: string;
  appNote: string | null;
  missingAccountLabels: string[];
  staleAccountLabels: string[];
  reconstructedAccountLabels: string[];
};

/**
 * `asOfNow` d'un rapport : le **jour ISO seul**. L'horloge de période (`sessionClockForBounds`)
 * ajoute elle-même 15 h ; passer un horodatage avec décalage en dur (`-04:00`) devenait faux
 * en heure d'hiver et cassait le parsing.
 */
export function reconciliationAsOf(reportDate: string): string {
  return reportDate;
}

/**
 * Midi local du jour ISO d'un rapport — sert à calculer les bornes de période **à cette date**.
 * (`parseIsoDateLocal` ne lit pas un horodatage avec fuseau et renvoyait une date invalide.)
 */
function reportDateNoon(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year!, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

/** Dates de rapport disponibles : imports portefeuille + captures du favori, plus récentes d'abord. */
export function reconciliationReportDates(payload: PerformanceIndicatorPayload): string[] {
  const unique = new Set<string>();
  for (const snapshot of payload.snapshots ?? []) {
    if (snapshot.asOf) unique.add(snapshot.asOf);
  }
  // Les captures du favori « Vue d'ensemble » sont des dates de rapport à part entière :
  // sans elles, la table resterait bloquée sur le dernier export portefeuille.
  for (const date of favoriReportDates(payload.clientCashSnapshots)) {
    unique.add(date);
  }
  return [...unique].toSorted((a, b) => b.localeCompare(a));
}


/** Contexte d'un rapport : app + bornes + comptes réellement conciliables. */
type ReportContext = {
  payload: PerformanceIndicatorPayload;
  filters: PerformanceFilterState;
  portfolios: PerformancePortfolioScope[];
  reportDate: string;
  app: ReturnType<typeof computePeriodResultWithSnapshots>;
  bounds: ReturnType<typeof resolvePeriodBounds>;
  disnatKeys: string[];
  materialKeys: string[];
};

function buildReportContext(
  payload: PerformanceIndicatorPayload,
  filters: PerformanceFilterState,
  portfolios: PerformancePortfolioScope[],
  reportDate: string,
): ReportContext {
  const payloadAtDate: PerformanceIndicatorPayload = {
    ...payload,
    asOfNow: reconciliationAsOf(reportDate),
  };
  const app = computePeriodResultWithSnapshots(payloadAtDate, filters, filters.activePeriod);

  // Bornes de la période **à la date du rapport** (et non « aujourd'hui »).
  const now = reportDateNoon(reportDate);
  const earliest = [...new Set(payload.snapshots?.map((s) => s.asOf) ?? [])].sort()[0] ?? null;
  const bounds = resolvePeriodBounds(filters.activePeriod, now, filters.selectedYear, earliest);
  const disnatKeys = resolveActiveAccountKeys(
    payload.accounts,
    filters.preset,
    filters.includedAccountKeys,
    filters.excludedAccountKeys,
    filters.owner,
    filters.portfolioKey ?? null,
    portfolios,
  ).filter((key) => !payload.accounts.find((a) => a.accountKey === key)?.isExternal);

  // Seuls les comptes qui détiennent (ou ont détenu) des titres sur la période peuvent être
  // conciliés : un compte d'encaisse vide (0 $) ne doit pas faire baisser la couverture.
  const materialKeys =
    bounds.baselineLookup && bounds.end
      ? disnatTitresMaterialKeys(disnatKeys, payload, bounds.baselineLookup, bounds.end)
      : disnatKeys;

  return { payload, filters, portfolios, reportDate, app, bounds, disnatKeys, materialKeys };
}

function emptyRow(context: ReportContext): ReconciliationRow {
  const { app, bounds, reportDate, materialKeys } = context;
  return {
    reportDate,
    appGainCad: app.gainCad,
    appGainPct: app.gainPct,
    refGainCad: null,
    refGainPct: null,
    deltaCad: null,
    deltaPct: null,
    accountsUsed: 0,
    accountsExpected: materialKeys.length,
    incomplete: true,
    reasons: ["Bornes de période indisponibles ou aucun compte Disnat dans la portée."],
    periodStart: bounds.start,
    periodEnd: bounds.end,
    baselineLookup: bounds.baselineLookup,
    flowsCad: null,
    appMethod: app.method,
    appNote: app.note,
    missingAccountLabels: [],
    staleAccountLabels: [],
    reconstructedAccountLabels: [],
    baselineActualDate: null,
    endActualDate: null,
  };
}


/** Construit les lignes de conciliation (par défaut, les 12 dates de rapport les plus récentes). */
export function buildReconciliationRows({
  payload,
  filters,
  portfolios,
  reportDates,
  limit = 12,
}: {
  payload: PerformanceIndicatorPayload;
  filters: PerformanceFilterState;
  portfolios: PerformancePortfolioScope[];
  reportDates: string[];
  limit?: number;
}): ReconciliationRow[] {
  const rows: ReconciliationRow[] = [];
  const dates = reportDates.slice(0, limit);
  if (dates.length === 0) return rows;

  for (const reportDate of dates) {
    const context = buildReportContext(payload, filters, portfolios, reportDate);
    const { app, bounds, disnatKeys, materialKeys } = context;

    if (!bounds.start || !bounds.baselineLookup || materialKeys.length === 0) {
      rows.push(emptyRow(context));
      continue;
    }

    const toCad = (native: number, accountKey: string, dateIso: string) => {
      const acc = payload.accounts.find((a) => a.accountKey === accountKey);
      const rate = payload.usdCadRateByDate[dateIso] ?? payload.usdToCad;
      if (acc?.currency.toUpperCase().includes("USD") && rate) {
        return native * rate;
      }
      return native;
    };

    // Un point plus vieux que ce seuil que la date visée n'est pas une vraie baseline/fin —
    // le compte est traité comme manquant plutôt que de fausser silencieusement le gain sur des mois.
    const minStartAsOf = minAcceptableHistoryAsOf(bounds.baselineLookup);
    const minEndAsOf = minAcceptableHistoryAsOf(bounds.end);

    // Cherche le point le plus récent ≤ targetDate (et ≥ minAsOf) pour un compte, dans une
    // liste de points (imports Disnat OU reconstruction quotidienne titres × prix).
    const bestPointAtOrBefore = (
      points: typeof payload.snapshots,
      accountKey: string,
      targetDate: string,
      minAsOf: string,
    ): { native: number; asOf: string } | null => {
      let best: { native: number; asOf: string } | null = null;
      for (const pt of points ?? []) {
        if (pt.accountKey !== accountKey) continue;
        if (pt.asOf > targetDate || pt.asOf < minAsOf) continue;
        if (!best || pt.asOf > best.asOf) {
          best = { native: pt.marketValueNative ?? pt.totalValueNative, asOf: pt.asOf };
        }
      }
      return best;
    };

    let gainCad = 0;
    let baselineCad = 0;
    let used = 0;
    const missingAccountKeys: string[] = [];
    const staleAccountKeys: string[] = [];
    const reconstructedAccountKeys: string[] = [];
    const favoriCoveredAccountKeys: string[] = [];
    const favoriDatesUsed = new Set<string>();
    // Date réelle (la plus ancienne parmi les comptes utilisés) des points retenus — pour
    // afficher ce qui a VRAIMENT été utilisé, pas seulement la date cible demandée.
    let oldestStartAsOfUsed: string | null = null;
    let oldestEndAsOfUsed: string | null = null;

    for (const { clientCode, accountKeys: clientKeys } of groupAccountKeysByClient(materialKeys)) {
      // Fin de période officielle : la capture du favori « Vue d'ensemble » couvre tout le
      // client à cette date (titres + encaisse lus chez Disnat), elle prime sur une
      // reconstruction locale. Un export portefeuille plus récent garde la priorité.
      const favori = favoriCoversScope(payload.accounts, clientCode, disnatKeys)
        ? favoriReferenceForClient(payload.clientCashSnapshots, clientCode, bounds.end, minEndAsOf)
        : null;
      /** Le total officiel du favori couvre le client entier : il ne s'ajoute qu'une fois. */
      let favoriApplied = false;

      for (const accountKey of clientKeys) {
        // Priorité au vrai import Disnat (`snapshots`) s'il est assez frais — c'est la seule
        // source réellement indépendante de l'app pour valider ses propres calculs. On ne
        // retombe sur la reconstruction quotidienne (`historyPoints`) que s'il n'y a pas
        // d'import Disnat assez récent, pour éviter de marquer un compte "périmé" alors que
        // l'app suit très bien sa valeur au jour le jour entre deux imports.
        const startFromImport = bestPointAtOrBefore(
          payload.snapshots,
          accountKey,
          bounds.baselineLookup,
          minStartAsOf,
        );
        const endFromImport = bestPointAtOrBefore(
          payload.snapshots,
          accountKey,
          bounds.end,
          minEndAsOf,
        );
        const startFromHistory = startFromImport
          ? null
          : bestPointAtOrBefore(
              payload.historyPoints,
              accountKey,
              bounds.baselineLookup,
              minStartAsOf,
            );
        const endFromHistory = endFromImport
          ? null
          : bestPointAtOrBefore(payload.historyPoints, accountKey, bounds.end, minEndAsOf);

        const start = startFromImport ?? startFromHistory;
        const endCandidate = endFromImport ?? endFromHistory;
        // Le favori prime sur un point de fin reconstruit/importé plus ancien.
        const favoriCoversEnd =
          favori !== null && (endCandidate === null || favori.asOf >= endCandidate.asOf);
        const end = favoriCoversEnd ? { native: 0, asOf: favori.asOf } : endCandidate;
        const usedReconstruction =
          (!startFromImport && !!startFromHistory) ||
          (!favoriCoversEnd && !endFromImport && !!endFromHistory);

        if (!start || !end) {
          // Ni import récent, ni reconstruction récente disponible pour ce compte.
          const hasAnyDataAtAll =
            (payload.snapshots ?? []).some((s) => s.accountKey === accountKey) ||
            (payload.historyPoints ?? []).some((s) => s.accountKey === accountKey);
          if (hasAnyDataAtAll) {
            staleAccountKeys.push(accountKey);
          } else {
            missingAccountKeys.push(accountKey);
          }
          continue;
        }
        if (usedReconstruction && !favoriCoversEnd) {
          reconstructedAccountKeys.push(accountKey);
        }
        if (favoriCoversEnd) {
          favoriCoveredAccountKeys.push(accountKey);
          favoriDatesUsed.add(favori.asOf);
        }

        const startAsOf = start.asOf;
        const endAsOf = end.asOf;
        const startCad = toCad(start.native, accountKey, startAsOf);
        // Valeur de fin officielle : le favori ne couvre que les périmètres complets
        // (`favoriCoversScope`) et son total porte sur **tout** le client → une seule fois.
        const endCad = favoriCoversEnd
          ? favoriApplied
            ? 0
            : favori.securitiesCad
          : toCad(end.native, accountKey, endAsOf);
        if (favoriCoversEnd) favoriApplied = true;
        const flowsCad = (payload.cashFlows ?? [])
          .filter(
            (f) =>
              f.accountKey === accountKey &&
              f.tradeDate >= bounds.start! &&
              f.tradeDate <= bounds.end,
          )
          .reduce((sum, f) => sum + f.amountCad, 0);

        gainCad += endCad - startCad - flowsCad;
        baselineCad += startCad + flowsCad;
        used += 1;
        if (oldestStartAsOfUsed == null || startAsOf < oldestStartAsOfUsed) {
          oldestStartAsOfUsed = startAsOf;
        }
        if (oldestEndAsOfUsed == null || endAsOf < oldestEndAsOfUsed) {
          oldestEndAsOfUsed = endAsOf;
        }
      }
    }

    const refGainCad = used > 0 ? gainCad : null;
    const refGainPct = baselineCad > 0 && used > 0 ? (gainCad / baselineCad) * 100 : null;
    const deltaCad = app.gainCad != null && refGainCad != null ? app.gainCad - refGainCad : null;
    const deltaPct = app.gainPct != null && refGainPct != null ? app.gainPct - refGainPct : null;

    const reasons: string[] = [];
    if (used < materialKeys.length) {
      reasons.push("Couverture comptes incomplète");
    }
    if (staleAccountKeys.length > 0) {
      reasons.push(
        `Snapshot périmé (>${TITRES_HISTORY_MAX_GAP_TRADING_DAYS}j ouvrés) pour ${staleAccountKeys.length} compte(s)`,
      );
    }
    if (reconstructedAccountKeys.length > 0) {
      reasons.push(
        `Référence reconstruite (pas d'import Disnat récent) pour ${reconstructedAccountKeys.length} compte(s)`,
      );
    }
    if (favoriCoveredAccountKeys.length > 0) {
      const dates = [...favoriDatesUsed].sort().join(", ");
      reasons.push(
        `Fin de période officielle (favori Disnat du ${dates}) pour ${favoriCoveredAccountKeys.length} compte(s)`,
      );
    }
    if (app.incomplete) {
      reasons.push("Indicateur app partiel");
    }
    if (refGainCad == null) {
      reasons.push("Référence snapshots indisponible");
    }
    if (app.gainCad == null) {
      reasons.push("Résultat app indisponible");
    }
    if (deltaCad != null && Math.abs(deltaCad) >= 1) {
      reasons.push("Écart monétaire significatif");
    }
    if (reasons.length === 0) {
      reasons.push("Alignement app/référence");
    }

    const labelFor = (key: string) =>
      payload.accounts.find((a) => a.accountKey === key)?.label ?? key;
    const missingAccountLabels = missingAccountKeys.map(labelFor).slice(0, 5);
    const staleAccountLabels = staleAccountKeys.map(labelFor).slice(0, 5);
    const reconstructedAccountLabels = reconstructedAccountKeys.map(labelFor).slice(0, 5);

    const disnatKeySet = new Set(disnatKeys);
    const flowsCad = (payload.cashFlows ?? [])
      .filter(
        (f) =>
          disnatKeySet.has(f.accountKey) &&
          f.tradeDate >= bounds.start! &&
          f.tradeDate <= bounds.end,
      )
      .reduce((sum, f) => sum + f.amountCad, 0);

    rows.push({
      reportDate,
      appGainCad: app.gainCad,
      appGainPct: app.gainPct,
      refGainCad,
      refGainPct,
      deltaCad,
      deltaPct,
      accountsUsed: used,
      accountsExpected: materialKeys.length,
      incomplete: used < materialKeys.length || staleAccountKeys.length > 0,
      reasons,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      baselineLookup: bounds.baselineLookup,
      baselineActualDate: oldestStartAsOfUsed,
      endActualDate: oldestEndAsOfUsed,
      flowsCad,
      appMethod: app.method,
      appNote: app.note,
      missingAccountLabels,
      staleAccountLabels,
      reconstructedAccountLabels,
    });
  }

  return rows;
}

