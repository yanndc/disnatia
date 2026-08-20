"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ChevronDown,
  Filter,
  FolderPlus,
  Pencil,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { quoteAgeFromFetchedAt } from "@/lib/market/quote-age";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  computeAllPeriodResultsWithSnapshots,
  computePeriodResultWithSnapshots,
  defaultPerformanceFilters,
  minAcceptableHistoryAsOf,
  TITRES_HISTORY_MAX_GAP_TRADING_DAYS,
  resolveActiveAccountKeys,
  resolvePeriodBounds,
  resolvePeriodMeta,
  signedGainBg,
  signedGainClass,
} from "./performance-indicator-logic";
import {
  buildAiAuditPrompt,
  buildAiAuditPromptCompact,
} from "./performance-reconciliation-ai-prompt";
import { parseIsoDateLocal } from "./daily-close-key";
import { uniquePortfolioOwners } from "@/lib/portfolio/sanitize-portfolio-owner";
import type {
  PerformanceFilterState,
  PerformanceIndicatorPayload,
  PerformancePeriodId,
  PerformanceScopePreset,
} from "./performance-indicator-types";

export const PERFORMANCE_FILTERS_STORAGE_KEY = "disnatia.overview.performanceFilters";
export const PERFORMANCE_FILTERS_CHANGED_EVENT = "disnatia:performance-filters-changed";

type StoredFilters = Partial<
  Pick<
    PerformanceFilterState,
    | "preset"
    | "owner"
    | "portfolioKey"
    | "includedAccountKeys"
    | "excludedAccountKeys"
    | "selectedYear"
    | "activePeriod"
  >
>;

function loadStoredFilters(): StoredFilters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PERFORMANCE_FILTERS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredFilters;
  } catch {
    return null;
  }
}

function buildFiltersFromStorage(payload: PerformanceIndicatorPayload): PerformanceFilterState {
  const base = defaultPerformanceFilters(payload);
  const stored = loadStoredFilters();
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    selectedYear:
      stored.selectedYear && payload.availableYears.includes(stored.selectedYear)
        ? stored.selectedYear
        : base.selectedYear,
  };
}

function isSameFilters(a: PerformanceFilterState, b: PerformanceFilterState): boolean {
  return (
    a.preset === b.preset &&
    a.owner === b.owner &&
    (a.portfolioKey ?? null) === (b.portfolioKey ?? null) &&
    a.selectedYear === b.selectedYear &&
    a.activePeriod === b.activePeriod &&
    a.includedAccountKeys.length === b.includedAccountKeys.length &&
    a.includedAccountKeys.every((x, i) => x === b.includedAccountKeys[i]) &&
    a.excludedAccountKeys.length === b.excludedAccountKeys.length &&
    a.excludedAccountKeys.every((x, i) => x === b.excludedAccountKeys[i])
  );
}

function saveStoredFilters(filters: PerformanceFilterState) {
  try {
    localStorage.setItem(
      PERFORMANCE_FILTERS_STORAGE_KEY,
      JSON.stringify({
        preset: filters.preset,
        owner: filters.owner,
        portfolioKey: filters.portfolioKey,
        includedAccountKeys: filters.includedAccountKeys,
        excludedAccountKeys: filters.excludedAccountKeys,
        selectedYear: filters.selectedYear,
        activePeriod: filters.activePeriod,
      }),
    );
    window.dispatchEvent(
      new CustomEvent(PERFORMANCE_FILTERS_CHANGED_EVENT, {
        detail: {
          preset: filters.preset,
          owner: filters.owner,
          portfolioKey: filters.portfolioKey ?? null,
          includedAccountKeys: filters.includedAccountKeys,
          excludedAccountKeys: filters.excludedAccountKeys,
          selectedYear: filters.selectedYear,
          activePeriod: filters.activePeriod,
        },
      }),
    );
  } catch {
    /* ignore */
  }
}

const PRESET_LABELS: Record<PerformanceScopePreset, string> = {
  all: "Tout",
  disnat: "Disnat",
  external: "Externes",
  custom: "Sur mesure",
};

const PERIOD_ORDER: PerformancePeriodId[] = [
  "day",
  "yesterday",
  "month",
  "month3",
  "year",
  "year3",
  "ytd",
  "all",
];

const MONEY_DISPLAY_EPSILON = 0.005;
const PCT_DISPLAY_EPSILON = 0.005;

function normalizeMoneyDisplay(value: number): number {
  return Math.abs(value) < MONEY_DISPLAY_EPSILON ? 0 : value;
}

function normalizePctDisplay(value: number): number {
  return Math.abs(value) < PCT_DISPLAY_EPSILON ? 0 : value;
}

function formatGain(value: number | null, compact = false): string {
  if (value === null) return "—";
  const normalized = normalizeMoneyDisplay(value);
  const prefix = normalized > 0 ? "+" : "";
  if (compact && Math.abs(normalized) >= 100_000) {
    return `${prefix}${(normalized / 1000).toFixed(1)}k $`;
  }
  return `${prefix}${formatCurrency(normalized, "CAD")}`;
}

function formatGainPct(value: number | null, annualized = false): string {
  if (value === null) return "—";
  const normalized = normalizePctDisplay(value);
  const prefix = normalized > 0 ? "+" : "";
  return `${prefix}${formatPercent(normalized)}${annualized ? "/an" : ""}`;
}

type ReconciliationRow = {
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
  /** Date réelle (la plus ancienne parmi les comptes utilisés) du snapshot de départ effectivement retenu. */
  baselineActualDate: string | null;
  /** Date réelle (la plus ancienne parmi les comptes utilisés) du snapshot de fin effectivement retenu. */
  endActualDate: string | null;
  flowsCad: number | null;
  appMethod: string;
  appNote: string | null;
  missingAccountLabels: string[];
  staleAccountLabels: string[];
};

function asOfAtTorontoMidday(isoDate: string): string {
  return `${isoDate}T15:00:00-04:00`;
}

export function PerformanceIndicatorCard({
  payload,
  showReconciliationDetails = false,
  filtersOnly = false,
  hideFiltersHeader = false,
}: {
  payload: PerformanceIndicatorPayload;
  showReconciliationDetails?: boolean;
  filtersOnly?: boolean;
  hideFiltersHeader?: boolean;
}) {
  const [filters, setFilters] = useState<PerformanceFilterState>(() =>
    buildFiltersFromStorage(payload),
  );
  const [scopeOpen, setScopeOpen] = useState(false);
  const [portfolioScopesOverride, setPortfolioScopesOverride] = useState<
    PerformanceIndicatorPayload["portfolioScopes"] | null
  >(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isSavingScope, setIsSavingScope] = useState(false);
  const [isArchivingScope, setIsArchivingScope] = useState(false);
  const [isRenamingScope, setIsRenamingScope] = useState(false);
  const [recoReportDate, setRecoReportDate] = useState<string>("");
  const [copyAuditState, setCopyAuditState] = useState<
    "idle" | "ok" | "ok-compact" | "error"
  >(
    "idle",
  );

  useEffect(() => {
    saveStoredFilters(filters);
  }, [filters]);

  useEffect(() => {
    const sync = () => {
      const next = buildFiltersFromStorage(payload);
      setFilters((prev) => (isSameFilters(prev, next) ? prev : next));
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === PERFORMANCE_FILTERS_STORAGE_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(PERFORMANCE_FILTERS_CHANGED_EVENT, sync as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PERFORMANCE_FILTERS_CHANGED_EVENT, sync as EventListener);
    };
  }, [payload]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const owners = useMemo(
    () => uniquePortfolioOwners(payload.accounts.map((a) => a.owner)),
    [payload.accounts],
  );
  const portfolios = useMemo(
    () => portfolioScopesOverride ?? payload.portfolioScopes ?? [],
    [portfolioScopesOverride, payload.portfolioScopes],
  );
  const payloadWithScopes = useMemo(
    () => ({ ...payload, portfolioScopes: portfolios }),
    [payload, portfolios],
  );

  const periodResults = useMemo(
    () => computeAllPeriodResultsWithSnapshots(payloadWithScopes, filters),
    [payloadWithScopes, filters],
  );

  const active = useMemo(
    () => computePeriodResultWithSnapshots(payloadWithScopes, filters, filters.activePeriod),
    [payloadWithScopes, filters],
  );
  const activeGainCadDisplay =
    active.gainCad === null ? null : normalizeMoneyDisplay(active.gainCad);

  const reportDates = useMemo(() => {
    const unique = new Set<string>();
    for (const s of payload.snapshots ?? []) {
      if (s.asOf) unique.add(s.asOf);
    }
    return [...unique].toSorted((a, b) => b.localeCompare(a));
  }, [payload.snapshots]);

  const activeRecoReportDate =
    recoReportDate && reportDates.includes(recoReportDate)
      ? recoReportDate
      : (reportDates[0] ?? "");

  const reconciliationRows = useMemo(() => {
    const rows: ReconciliationRow[] = [];
    const dates = reportDates.slice(0, 12);
    if (dates.length === 0) return rows;

    for (const reportDate of dates) {
      const asOfNow = asOfAtTorontoMidday(reportDate);
      const payloadAtDate: PerformanceIndicatorPayload = {
        ...payloadWithScopes,
        asOfNow,
      };
      const app = computePeriodResultWithSnapshots(
        payloadAtDate,
        filters,
        filters.activePeriod,
      );

      const now = parseIsoDateLocal(asOfNow);
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
      ).filter((k) => !payload.accounts.find((a) => a.accountKey === k)?.isExternal);

      if (!bounds.start || !bounds.baselineLookup || disnatKeys.length === 0) {
        rows.push({
          reportDate,
          appGainCad: app.gainCad,
          appGainPct: app.gainPct,
          refGainCad: null,
          refGainPct: null,
          deltaCad: null,
          deltaPct: null,
          accountsUsed: 0,
          accountsExpected: disnatKeys.length,
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
          baselineActualDate: null,
          endActualDate: null,
        });
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

      // Un snapshot plus vieux que ce seuil que la date visée n'est pas une vraie baseline/fin —
      // le compte est traité comme manquant plutôt que de fausser silencieusement le gain sur des mois.
      const minStartAsOf = minAcceptableHistoryAsOf(bounds.baselineLookup);
      const minEndAsOf = minAcceptableHistoryAsOf(bounds.end);

      let gainCad = 0;
      let baselineCad = 0;
      let used = 0;
      const missingAccountKeys: string[] = [];
      const staleAccountKeys: string[] = [];
      // Date réelle (la plus vieille / la plus ancienne parmi les comptes utilisés) des
      // snapshots retenus — pour afficher ce qui a VRAIMENT été utilisé, pas seulement
      // la date cible demandée (`bounds.baselineLookup`/`bounds.end`).
      let oldestStartAsOfUsed: string | null = null;
      let oldestEndAsOfUsed: string | null = null;

      for (const accountKey of disnatKeys) {
        let startNative: number | null = null;
        let endNative: number | null = null;
        let startAsOf: string | null = null;
        let endAsOf: string | null = null;

        for (const snap of payload.snapshots ?? []) {
          if (snap.accountKey !== accountKey) continue;
          const native = snap.marketValueNative ?? snap.totalValueNative;
          if (
            snap.asOf <= bounds.baselineLookup &&
            (startAsOf == null || snap.asOf > startAsOf)
          ) {
            startNative = native;
            startAsOf = snap.asOf;
          }
          if (
            snap.asOf <= bounds.end &&
            (endAsOf == null || snap.asOf > endAsOf)
          ) {
            endNative = native;
            endAsOf = snap.asOf;
          }
        }

        if (startNative == null || endNative == null) {
          missingAccountKeys.push(accountKey);
          continue;
        }
        if (startAsOf! < minStartAsOf || endAsOf! < minEndAsOf) {
          staleAccountKeys.push(accountKey);
          continue;
        }

        const startCad = toCad(startNative, accountKey, startAsOf!);
        const endCad = toCad(endNative, accountKey, endAsOf!);
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
        if (oldestStartAsOfUsed == null || startAsOf! < oldestStartAsOfUsed) {
          oldestStartAsOfUsed = startAsOf;
        }
        if (oldestEndAsOfUsed == null || endAsOf! < oldestEndAsOfUsed) {
          oldestEndAsOfUsed = endAsOf;
        }
      }

      const refGainCad = used > 0 ? gainCad : null;
      const refGainPct = baselineCad > 0 && used > 0 ? (gainCad / baselineCad) * 100 : null;
      const deltaCad =
        app.gainCad != null && refGainCad != null ? app.gainCad - refGainCad : null;
      const deltaPct =
        app.gainPct != null && refGainPct != null ? app.gainPct - refGainPct : null;

      const reasons: string[] = [];
      if (used < disnatKeys.length) {
        reasons.push("Couverture comptes incomplète");
      }
      if (staleAccountKeys.length > 0) {
        reasons.push(
          `Snapshot périmé (>${TITRES_HISTORY_MAX_GAP_TRADING_DAYS}j ouvrés) pour ${staleAccountKeys.length} compte(s)`,
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

      const missingAccountLabels = missingAccountKeys
        .map((key) => payload.accounts.find((a) => a.accountKey === key)?.label ?? key)
        .slice(0, 5);
      const staleAccountLabels = staleAccountKeys
        .map((key) => payload.accounts.find((a) => a.accountKey === key)?.label ?? key)
        .slice(0, 5);

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
        accountsExpected: disnatKeys.length,
        incomplete: used < disnatKeys.length || staleAccountKeys.length > 0,
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
      });
    }

    return rows;
  }, [filters, payload, payloadWithScopes, reportDates, portfolios]);

  const activeAccountKeysForScope = useMemo(
    () =>
      resolveActiveAccountKeys(
        payload.accounts,
        filters.preset,
        filters.includedAccountKeys,
        filters.excludedAccountKeys,
        filters.owner,
        filters.portfolioKey ?? null,
        portfolios,
      ),
    [filters, payload.accounts, portfolios],
  );

  const selectedPortfolio = useMemo(
    () => portfolios.find((p) => p.portfolioKey === (filters.portfolioKey ?? "")) ?? null,
    [filters.portfolioKey, portfolios],
  );

  const selectedReconciliation = useMemo(
    () =>
      reconciliationRows.find((r) => r.reportDate === activeRecoReportDate) ??
      reconciliationRows[0] ??
      null,
    [activeRecoReportDate, reconciliationRows],
  );

  const yahooQuoteAge = useMemo(
    () => quoteAgeFromFetchedAt(payload.quotesAsOf, nowMs),
    [payload.quotesAsOf, nowMs],
  );

  const sessionUsesLiveYahoo =
    active.method === "live-quotes" || filters.activePeriod === "day";

  const updateFilters = useCallback(
    (patch: Partial<PerformanceFilterState>) => {
      setFilters((prev) => ({ ...prev, ...patch }));
    },
    [],
  );

  const toggleAccountExclusion = useCallback(
    (accountKey: string) => {
      setFilters((prev) => {
        const excluded = new Set(prev.excludedAccountKeys);
        if (excluded.has(accountKey)) excluded.delete(accountKey);
        else excluded.add(accountKey);
        return {
          ...prev,
          preset: excluded.size > 0 ? "custom" : prev.preset === "custom" ? "all" : prev.preset,
          excludedAccountKeys: [...excluded],
        };
      });
    },
    [],
  );

  const scopeSummary = useMemo(() => {
    const parts: string[] = [PRESET_LABELS[filters.preset]];
    if (filters.portfolioKey) {
      const p = portfolios.find((x) => x.portfolioKey === filters.portfolioKey);
      if (p) parts.push(p.label);
    }
    if (filters.owner) parts.push(filters.owner.split(" ")[0] ?? filters.owner);
    if (filters.excludedAccountKeys.length > 0) {
      parts.push(`${filters.excludedAccountKeys.length} exclu(s)`);
    }
    if (filters.preset === "custom" && filters.includedAccountKeys.length > 0) {
      parts.push(`${filters.includedAccountKeys.length} compte(s)`);
    }
    return parts.join(" · ");
  }, [filters, portfolios]);

  const ownerScoped = Boolean(filters.owner || filters.portfolioKey);
  const hasNonDefaultScopeFilter = useMemo(() => {
    const defaults = defaultPerformanceFilters(payload);
    return (
      filters.preset !== defaults.preset ||
      (filters.owner ?? null) !== defaults.owner ||
      (filters.portfolioKey ?? null) !== (defaults.portfolioKey ?? null) ||
      filters.includedAccountKeys.length > 0 ||
      filters.excludedAccountKeys.length > 0
    );
  }, [filters, payload]);
  const activePeriodLabel = resolvePeriodMeta(filters.activePeriod, payload.asOfNow).label;

  const createPortfolioScope = useCallback(async () => {
    const label = window.prompt("Nom du portefeuille personnalisé");
    if (!label || !label.trim()) return;
    if (activeAccountKeysForScope.length === 0) {
      window.alert("Aucun compte dans la portée actuelle.");
      return;
    }
    setIsSavingScope(true);
    try {
      const response = await fetch("/api/portfolio/scopes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          accountKeys: activeAccountKeysForScope,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        scope?: { id: string; portfolioKey: string; label: string; kind: "CUSTOM" };
        error?: string;
      };
      if (!response.ok || !data.scope) {
        window.alert(data.error ?? "Impossible de créer le portefeuille.");
        return;
      }
      const nextScope = {
        ...data.scope,
        accountKeys: activeAccountKeysForScope,
      };
      setPortfolioScopesOverride((prev) => {
        const base = prev ?? payload.portfolioScopes ?? [];
        const filtered = base.filter((x) => x.portfolioKey !== nextScope.portfolioKey);
        return [...filtered, nextScope].toSorted((a, b) => a.label.localeCompare(b.label, "fr-CA"));
      });
      updateFilters({ portfolioKey: nextScope.portfolioKey });
    } finally {
      setIsSavingScope(false);
    }
  }, [activeAccountKeysForScope, payload.portfolioScopes, updateFilters]);

  const archiveSelectedPortfolioScope = useCallback(async () => {
    if (!selectedPortfolio || selectedPortfolio.kind !== "CUSTOM") return;
    setIsArchivingScope(true);
    try {
      const response = await fetch(`/api/portfolio/scopes/${selectedPortfolio.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        window.alert(data.error ?? "Archivage impossible.");
        return;
      }
      setPortfolioScopesOverride((prev) => {
        const base = prev ?? payload.portfolioScopes ?? [];
        return base.filter((x) => x.id !== selectedPortfolio.id);
      });
      updateFilters({ portfolioKey: null });
    } finally {
      setIsArchivingScope(false);
    }
  }, [payload.portfolioScopes, selectedPortfolio, updateFilters]);

  const renameSelectedPortfolioScope = useCallback(async () => {
    if (!selectedPortfolio || selectedPortfolio.kind !== "CUSTOM") return;
    const nextLabel = window.prompt("Nouveau nom du portefeuille", selectedPortfolio.label);
    if (!nextLabel || !nextLabel.trim()) return;
    setIsRenamingScope(true);
    try {
      const response = await fetch(`/api/portfolio/scopes/${selectedPortfolio.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: nextLabel.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        scope?: { id: string; portfolioKey: string; label: string; kind: "CUSTOM" };
        error?: string;
      };
      if (!response.ok || !data.scope) {
        window.alert(data.error ?? "Renommage impossible.");
        return;
      }
      setPortfolioScopesOverride((prev) => {
        const base = prev ?? payload.portfolioScopes ?? [];
        return base
          .map((x) => (x.id === data.scope!.id ? { ...x, label: data.scope!.label } : x))
          .toSorted((a, b) => a.label.localeCompare(b.label, "fr-CA"));
      });
    } finally {
      setIsRenamingScope(false);
    }
  }, [payload.portfolioScopes, selectedPortfolio]);

  const copyAuditPromptForAi = useCallback(async (mode: "full" | "compact") => {
    if (!selectedReconciliation) return;
    const prompt =
      mode === "compact"
        ? buildAiAuditPromptCompact({
            row: selectedReconciliation,
            scopeSummary,
            periodLabel: activePeriodLabel,
            sessionHealthOk: payload.sessionDataHealth.ok,
          })
        : buildAiAuditPrompt({
            row: selectedReconciliation,
            scopeSummary,
            periodLabel: activePeriodLabel,
            usdToCad: payload.usdToCad,
            sessionHealthOk: payload.sessionDataHealth.ok,
          });
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyAuditState(mode === "compact" ? "ok-compact" : "ok");
    } catch {
      setCopyAuditState("error");
    } finally {
      window.setTimeout(() => setCopyAuditState("idle"), 2500);
    }
  }, [
    activePeriodLabel,
    payload.sessionDataHealth.ok,
    payload.usdToCad,
    scopeSummary,
    selectedReconciliation,
  ]);

  if (payload.accounts.length === 0) return null;

  return (
    <Card className="overflow-hidden border-slate-200 bg-white text-slate-950 shadow-sm">
      <CardContent className="p-0">
        <div className="relative isolate">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,rgba(5,150,105,0.06),transparent_42%),radial-gradient(circle_at_85%_15%,rgba(14,165,233,0.05),transparent_38%)]" />

          {!hideFiltersHeader ? (
            <>
          {/* En-tête + filtres portée */}
          <div className="border-b border-slate-200 p-5 sm:p-6">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold tracking-tight">
                  Filtres dynamiques
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-700 ring-1 ring-cyan-100">
                  <Sparkles className="size-3" />
                  Live
                </span>
                {ownerScoped ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">
                    Portefeuille partiel
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-slate-500">
                Choisis la période, la portée et les comptes. Les indicateurs en dessous suivent ce périmètre.
              </p>
              {!payload.performanceSnapshots && !payload.sessionDataHealth.ok ? (
                <p className="text-xs text-amber-700">
                  {payload.sessionDataHealth.message ??
                    "Historique de séance incomplet — indicateurs indisponibles."}
                </p>
              ) : null}

              <div className="flex w-full flex-wrap items-center gap-2">
                <div className="flex rounded-xl bg-slate-100 p-1 ring-1 ring-slate-200">
                  {(Object.keys(PRESET_LABELS) as PerformanceScopePreset[]).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        updateFilters({
                          preset,
                          includedAccountKeys: preset === "custom" ? filters.includedAccountKeys : [],
                          excludedAccountKeys: preset === "all" ? [] : filters.excludedAccountKeys,
                        })
                      }
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                        filters.preset === preset
                          ? "bg-white text-slate-950 shadow-sm"
                          : "text-slate-600 hover:bg-white hover:text-slate-950"
                      }`}
                    >
                      {PRESET_LABELS[preset]}
                    </button>
                  ))}
                </div>

                {owners.length > 1 ? (
                  <select
                    value={filters.owner ?? ""}
                    onChange={(e) =>
                      updateFilters({ owner: e.target.value || null })
                    }
                    className="min-w-52 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:ring-cyan-400/50"
                  >
                    <option value="">Tous propriétaires</option>
                    {owners.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : null}

                {portfolios.length > 0 ? (
                  <select
                    value={filters.portfolioKey ?? ""}
                    onChange={(e) =>
                      updateFilters({ portfolioKey: e.target.value || null })
                    }
                    className="min-w-52 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:ring-cyan-400/50"
                  >
                    <option value="">Tous portefeuilles</option>
                    {portfolios.map((p) => (
                      <option key={p.portfolioKey} value={p.portfolioKey}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                ) : null}

                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 gap-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                  onClick={createPortfolioScope}
                  disabled={isSavingScope || !hasNonDefaultScopeFilter}
                >
                  <FolderPlus className="size-4" />
                  {isSavingScope ? "Création..." : "Sauvegarder le filtre"}
                </Button>

                {selectedPortfolio?.kind === "CUSTOM" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 gap-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                    onClick={renameSelectedPortfolioScope}
                    disabled={isRenamingScope}
                  >
                    <Pencil className="size-4" />
                    {isRenamingScope ? "Renommage..." : "Renommer"}
                  </Button>
                ) : null}

                {selectedPortfolio?.kind === "CUSTOM" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 gap-2 rounded-xl border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                    onClick={archiveSelectedPortfolioScope}
                    disabled={isArchivingScope}
                  >
                    <Archive className="size-4" />
                    {isArchivingScope ? "Archivage..." : "Archiver"}
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant="ghost"
                  className={`h-9 gap-2 rounded-xl border bg-white hover:bg-slate-50 hover:text-slate-950 ${
                    ownerScoped
                      ? "border-emerald-200 text-emerald-800"
                      : "border-slate-200 text-slate-700"
                  }`}
                  onClick={() => setScopeOpen((v) => !v)}
                >
                  <Filter className="size-4" />
                  {scopeSummary}
                  <ChevronDown
                    className={`size-4 transition ${scopeOpen ? "rotate-180" : ""}`}
                  />
                </Button>
              </div>
            </div>
          </div>

          {/* Panneau comptes */}
          {!payload.sessionDataHealth.ok ? (
            <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-xs text-rose-900 sm:px-6">
              <p className="font-semibold">
                Donnees de seance invalides - indicateurs non fiables
              </p>
              <p className="mt-1">
                {payload.sessionDataHealth.message ??
                  "Historisation des seances absente."}
              </p>
            </div>
          ) : null}

          {scopeOpen ? (
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Inclure / exclure des comptes
                </p>
                <button
                  type="button"
                  className="text-xs text-slate-500 hover:text-slate-950"
                  onClick={() =>
                    updateFilters({
                      preset: "all",
                      portfolioKey: null,
                      owner: null,
                      includedAccountKeys: [],
                      excludedAccountKeys: [],
                    })
                  }
                >
                  Réinitialiser
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {payload.accounts.map((acc) => {
                  const excluded = filters.excludedAccountKeys.includes(acc.accountKey);
                  const included =
                    filters.preset === "custom" &&
                    filters.includedAccountKeys.includes(acc.accountKey);
                  const cur = payload.currentByAccount[acc.accountKey];
                  return (
                    <label
                      key={acc.accountKey}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ring-1 transition ${
                        excluded
                          ? "bg-rose-50 ring-rose-200 opacity-60"
                          : included
                            ? "bg-cyan-50 ring-cyan-200"
                            : "bg-white ring-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <Switch
                        checked={!excluded}
                        onCheckedChange={() => toggleAccountExclusion(acc.accountKey)}
                        aria-label={`Inclure ${acc.label}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {acc.label}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {acc.isExternal ? `Externe · ${acc.provider}` : "Disnat"}
                          {acc.owner ? ` · ${acc.owner}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-slate-500">
                        {cur ? formatCurrency(cur.totalCad, "CAD") : "—"}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Astuce : preset « Disnat » exclut automatiquement les comptes externes pour
                isoler la performance Desjardins.
              </p>
            </div>
          ) : null}
            </>
          ) : null}

          {!filtersOnly ? (
            <>
          {/* Hero + matrice périodes */}
          <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-slate-500">{active.label}</p>
              </div>

              <div className="mt-3 flex items-end gap-3">
                {activeGainCadDisplay !== null && activeGainCadDisplay >= 0 ? (
                  <TrendingUp className="size-8 shrink-0 text-emerald-600/80" />
                ) : activeGainCadDisplay !== null && activeGainCadDisplay < 0 ? (
                  <TrendingDown className="size-8 shrink-0 text-rose-600/80" />
                ) : null}
                <div>
                  <p
                    className={`text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl ${signedGainClass(active.gainCad)}`}
                  >
                    {formatGain(active.gainCad)}
                  </p>
                  <p
                    className={`mt-1 text-xl tabular-nums ${signedGainClass(active.gainPct)}`}
                  >
                    {formatGainPct(active.gainPct, active.annualized)}
                    {active.annualized ? (
                      <span className="ml-1 align-middle text-xs font-normal text-slate-400">
                        annualisé
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>

              {yahooQuoteAge && sessionUsesLiveYahoo ? (
                <p
                  className={`mt-3 rounded-lg px-3 py-2 text-xs ring-1 ${
                    yahooQuoteAge.ageMinutes >= 15
                      ? "bg-amber-50 font-medium text-amber-900 ring-amber-200"
                      : "bg-slate-50 text-slate-600 ring-slate-200"
                  }`}
                >
                  Cours Yahoo · il y a {yahooQuoteAge.shortLabel}
                  {yahooQuoteAge.ageMinutes >= 15
                    ? " — écart possible vs Disnat ; actualise les cours."
                    : " — la Séance utilise ce prix (pas le flux Disnat)."}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>
                  {active.accountsIncluded} compte{active.accountsIncluded > 1 ? "s" : ""}
                </span>
                {active.baselineDate ? (
                  <span>Réf. {active.baselineDate}</span>
                ) : null}
                {yahooQuoteAge && payload.quotesAsOf ? (
                  <span className="tabular-nums">
                    Yahoo {new Date(payload.quotesAsOf).toLocaleString("fr-CA", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                ) : null}
                {payload.usdToCad !== null ? (
                  <span>USD→CAD {payload.usdToCad.toFixed(4)}</span>
                ) : null}
              </div>

              {active.note ? (
                <p
                  className={`mt-3 rounded-lg px-3 py-2 text-xs ring-1 ${
                    active.incomplete
                      ? "bg-amber-50 text-amber-800 ring-amber-200"
                      : "bg-slate-50 text-slate-600 ring-slate-200"
                  }`}
                >
                  {active.note}
                </p>
              ) : null}

              {showReconciliationDetails && selectedReconciliation ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Conciliation (mêmes dates de rapport)
                    </p>
                    <select
                      value={activeRecoReportDate}
                      onChange={(e) => setRecoReportDate(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      {reportDates.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-215 text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          <th className="py-1.5 pr-2">Date rapport</th>
                          <th className="py-1.5 pr-2 text-right">App $</th>
                          <th className="py-1.5 pr-2 text-right">Réf. $</th>
                          <th className="py-1.5 pr-2 text-right">Écart $</th>
                          <th className="py-1.5 pr-2 text-right">App %</th>
                          <th className="py-1.5 pr-2 text-right">Réf. %</th>
                          <th className="py-1.5 pr-2 text-right">Écart %</th>
                          <th className="py-1.5 text-right">Couverture</th>
                          <th className="py-1.5 pl-2">Diagnostic</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reconciliationRows.map((r) => {
                          const isSelected = r.reportDate === selectedReconciliation.reportDate;
                          return (
                            <tr
                              key={r.reportDate}
                              className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 ${
                                isSelected ? "bg-white" : ""
                              }`}
                              onClick={() => setRecoReportDate(r.reportDate)}
                            >
                              <td className="py-1.5 pr-2 font-medium text-slate-700">{r.reportDate}</td>
                              <td className={`py-1.5 pr-2 text-right tabular-nums ${signedGainClass(r.appGainCad)}`}>
                                {formatGain(r.appGainCad)}
                              </td>
                              <td className={`py-1.5 pr-2 text-right tabular-nums ${signedGainClass(r.refGainCad)}`}>
                                {formatGain(r.refGainCad)}
                              </td>
                              <td className={`py-1.5 pr-2 text-right tabular-nums ${signedGainClass(r.deltaCad)}`}>
                                {formatGain(r.deltaCad)}
                              </td>
                              <td className={`py-1.5 pr-2 text-right tabular-nums ${signedGainClass(r.appGainPct)}`}>
                                {formatGainPct(r.appGainPct)}
                              </td>
                              <td className={`py-1.5 pr-2 text-right tabular-nums ${signedGainClass(r.refGainPct)}`}>
                                {formatGainPct(r.refGainPct)}
                              </td>
                              <td className={`py-1.5 pr-2 text-right tabular-nums ${signedGainClass(r.deltaPct)}`}>
                                {formatGainPct(r.deltaPct)}
                              </td>
                              <td className={`py-1.5 text-right tabular-nums ${r.incomplete ? "text-amber-700" : "text-slate-600"}`}>
                                {r.accountsUsed}/{r.accountsExpected}
                              </td>
                              <td className="py-1.5 pl-2 text-slate-600">
                                {r.reasons.join(" · ")}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {selectedReconciliation ? (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                      <div className="mb-2 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void copyAuditPromptForAi("full");
                          }}
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Copier audit IA
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void copyAuditPromptForAi("compact");
                          }}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Copier audit IA (compact)
                        </button>
                        {copyAuditState === "ok" ? (
                          <span className="text-[11px] font-medium text-emerald-700">
                            Copié
                          </span>
                        ) : null}
                        {copyAuditState === "ok-compact" ? (
                          <span className="text-[11px] font-medium text-emerald-700">
                            Copié (compact)
                          </span>
                        ) : null}
                        {copyAuditState === "error" ? (
                          <span className="text-[11px] font-medium text-rose-700">
                            Copie impossible
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span>
                          <span className="font-semibold">Date:</span>{" "}
                          {selectedReconciliation.reportDate}
                        </span>
                        <span>
                          <span className="font-semibold">Méthode app:</span>{" "}
                          {selectedReconciliation.appMethod}
                        </span>
                        <span>
                          <span className="font-semibold">Période:</span>{" "}
                          {selectedReconciliation.periodStart ?? "—"} →{" "}
                          {selectedReconciliation.periodEnd ?? "—"}
                        </span>
                        <span>
                          <span className="font-semibold">Baseline (cible):</span>{" "}
                          {selectedReconciliation.baselineLookup ?? "—"}
                        </span>
                        <span>
                          <span className="font-semibold">Baseline (réelle):</span>{" "}
                          {selectedReconciliation.baselineActualDate ?? "—"}
                          {selectedReconciliation.baselineActualDate &&
                          selectedReconciliation.baselineActualDate !==
                            selectedReconciliation.baselineLookup ? (
                            <span className="text-amber-700"> (décalée)</span>
                          ) : null}
                        </span>
                        <span>
                          <span className="font-semibold">Fin (réelle):</span>{" "}
                          {selectedReconciliation.endActualDate ?? "—"}
                          {selectedReconciliation.endActualDate &&
                          selectedReconciliation.endActualDate !==
                            selectedReconciliation.periodEnd ? (
                            <span className="text-amber-700"> (décalée)</span>
                          ) : null}
                        </span>
                        <span>
                          <span className="font-semibold">Flux nets:</span>{" "}
                          {selectedReconciliation.flowsCad != null
                            ? formatCurrency(selectedReconciliation.flowsCad, "CAD")
                            : "—"}
                        </span>
                      </div>
                      {selectedReconciliation.appNote ? (
                        <p className="mt-2 text-amber-700">
                          Note app: {selectedReconciliation.appNote}
                        </p>
                      ) : null}
                      {selectedReconciliation.missingAccountLabels.length > 0 ? (
                        <p className="mt-2 text-amber-700">
                          Comptes sans snapshot complet: {selectedReconciliation.missingAccountLabels.join(", ")}
                        </p>
                      ) : null}
                      {selectedReconciliation.staleAccountLabels.length > 0 ? (
                        <p className="mt-2 text-amber-700">
                          Comptes exclus (snapshot périmé de plus de {TITRES_HISTORY_MAX_GAP_TRADING_DAYS} jours ouvrés): {selectedReconciliation.staleAccountLabels.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Matrice périodes — vue simultanée */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {periodResults.map((row) => {
                const isActive = row.periodId === filters.activePeriod;
                return (
                  <button
                    key={row.periodId}
                    type="button"
                    onClick={() => updateFilters({ activePeriod: row.periodId })}
                    className={`group relative overflow-hidden rounded-2xl p-3 text-left ring-1 transition hover:scale-[1.02] ${
                      isActive
                        ? `${signedGainBg(row.gainCad)} ring-2 ring-slate-300`
                        : "bg-slate-50 ring-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      {row.shortLabel}
                    </p>
                    <p
                      className={`mt-1 text-lg font-semibold tabular-nums ${signedGainClass(row.gainCad)}`}
                    >
                      {formatGain(row.gainCad, true)}
                    </p>
                    <p className={`text-xs tabular-nums ${signedGainClass(row.gainPct)}`}>
                      {formatGainPct(row.gainPct, row.annualized)}
                    </p>
                    {row.incomplete && row.gainCad !== null ? (
                      <span
                        className="absolute right-2 top-2 size-1.5 rounded-full bg-amber-400"
                        title={row.note ?? "Données partielles"}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bandeau périodes (navigation rapide) */}
          <div className="flex gap-1 overflow-x-auto border-t border-slate-200 bg-slate-50 px-3 py-2">
            {PERIOD_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => updateFilters({ activePeriod: id })}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filters.activePeriod === id
                    ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                    : "text-slate-500 hover:bg-white hover:text-slate-700"
                }`}
              >
                {resolvePeriodMeta(id, payload.asOfNow).label}
              </button>
            ))}
          </div>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function PerformanceIndicatorCardSkeleton() {
  return (
    <Card className="overflow-hidden border-slate-200 bg-slate-100">
      <CardContent className="h-64 animate-pulse p-6" />
    </Card>
  );
}
