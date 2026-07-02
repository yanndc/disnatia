"use client";

import { useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyExposureKpiCard } from "@/features/portfolio/currency-exposure-kpi-card";
import { PortfolioCompositionKpiCard } from "@/features/portfolio/portfolio-composition-kpi-card";
import {
  PERFORMANCE_FILTERS_CHANGED_EVENT,
  PERFORMANCE_FILTERS_STORAGE_KEY,
  PerformanceIndicatorCard,
} from "@/features/portfolio/performance-indicator-card";
import {
  defaultPerformanceFilters,
  resolveActiveAccountKeys,
  signedGainClass,
} from "@/features/portfolio/performance-indicator-logic";
import { TopPositionsKpiCard } from "@/features/portfolio/top-positions-kpi-card";
import { type PerformanceFilterState, type PerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-types";
import { formatAggregatedTickerLabel, resolveAggregationGroupMeta } from "@/features/portfolio/ticker-aggregation-groups";
import { formatCurrency, formatPercent, normalizeCurrency } from "@/lib/utils";

function toCadEquivalent(value: number, currency: string, usdToCad: number | null): number {
  if (normalizeCurrency(currency) === "USD" && usdToCad !== null) return value * usdToCad;
  return value;
}

function parseStoredFilters(payload: PerformanceIndicatorPayload): PerformanceFilterState {
  const base = defaultPerformanceFilters(payload);
  if (typeof window === "undefined") return base;
  try {
    const raw = localStorage.getItem(PERFORMANCE_FILTERS_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<PerformanceFilterState>;
    return {
      ...base,
      ...parsed,
      selectedYear:
        parsed.selectedYear && payload.availableYears.includes(parsed.selectedYear)
          ? parsed.selectedYear
          : base.selectedYear,
    };
  } catch {
    return base;
  }
}

function latestSnapshotByAccount(payload: PerformanceIndicatorPayload): Map<string, { asOf: string; totalValueNative: number; currency: string }> {
  const byAccount = new Map<string, { asOf: string; totalValueNative: number; currency: string }>();
  for (const snap of payload.snapshots) {
    const prev = byAccount.get(snap.accountKey);
    if (!prev || snap.asOf > prev.asOf) {
      byAccount.set(snap.accountKey, {
        asOf: snap.asOf,
        totalValueNative: snap.totalValueNative,
        currency: snap.currency,
      });
    }
  }
  return byAccount;
}

type TickerRow = {
  ticker: string;
  securityName: string;
  currency: string;
  changePerShare: number;
  dayGainCad: number;
};

function buildSessionRows(payload: PerformanceIndicatorPayload, accountKeys: Set<string>): TickerRow[] {
  const buckets = new Map<string, { ticker: string; securityName: string; currency: string; quantity: number; gainNative: number }>();
  for (const row of payload.enrichedHoldings) {
    if (!accountKeys.has(row.accountKey)) continue;
    if (row.quoteChangePerShare === null || row.displayDayGainLoss === null) continue;
    const key = `${row.ticker}|${row.currency}`;
    const prev = buckets.get(key);
    if (prev) {
      prev.quantity += row.quantity;
      prev.gainNative += row.displayDayGainLoss;
      if (row.securityName.length > prev.securityName.length) prev.securityName = row.securityName;
    } else {
      buckets.set(key, {
        ticker: row.ticker,
        securityName: row.securityName || row.ticker,
        currency: row.currency,
        quantity: row.quantity,
        gainNative: row.displayDayGainLoss,
      });
    }
  }

  const rows: TickerRow[] = [];
  for (const b of buckets.values()) {
    if (!Number.isFinite(b.gainNative) || b.quantity <= 0) continue;
    rows.push({
      ticker: b.ticker,
      securityName: b.securityName,
      currency: b.currency,
      changePerShare: b.gainNative / b.quantity,
      dayGainCad: toCadEquivalent(b.gainNative, b.currency, payload.usdToCad),
    });
  }
  return rows;
}

export function OverviewFilteredSections({
  payload,
  baseNonFinancialAssetsCad,
}: {
  payload: PerformanceIndicatorPayload;
  baseNonFinancialAssetsCad: number;
}) {
  const [filters, setFilters] = useState<PerformanceFilterState>(() => parseStoredFilters(payload));

  useEffect(() => {
    const sync = () => setFilters(parseStoredFilters(payload));
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

  const activeAccountKeys = useMemo(
    () =>
      resolveActiveAccountKeys(
        payload.accounts,
        filters.preset,
        filters.includedAccountKeys,
        filters.excludedAccountKeys,
        filters.owner,
        filters.portfolioKey ?? null,
        payload.portfolioScopes ?? [],
      ),
    [payload, filters],
  );

  const activeSet = useMemo(() => new Set(activeAccountKeys), [activeAccountKeys]);

  const selectedAccounts = useMemo(
    () => payload.accounts.filter((a) => activeSet.has(a.accountKey)),
    [payload.accounts, activeSet],
  );

  const disnatKeys = useMemo(
    () => selectedAccounts.filter((a) => !a.isExternal).map((a) => a.accountKey),
    [selectedAccounts],
  );

  const externalKeys = useMemo(
    () => selectedAccounts.filter((a) => a.isExternal).map((a) => a.accountKey),
    [selectedAccounts],
  );

  const allocation = useMemo(() => {
    const positionsCad = disnatKeys.reduce((s, k) => s + (payload.currentByAccount[k]?.positionsCad ?? 0), 0);
    const cashCad = disnatKeys.reduce((s, k) => s + (payload.currentByAccount[k]?.cashCad ?? 0), 0);
    const externalCad = externalKeys.reduce((s, k) => s + (payload.currentByAccount[k]?.totalCad ?? 0), 0);
    const useGlobalNonFinancial =
      filters.preset === "all" &&
      !filters.owner &&
      !filters.portfolioKey &&
      filters.includedAccountKeys.length === 0 &&
      filters.excludedAccountKeys.length === 0;
    const nonFinancialCad = useGlobalNonFinancial ? baseNonFinancialAssetsCad : 0;
    return {
      positionsCad,
      cashCad,
      externalCad,
      nonFinancialCad,
      totalCad: positionsCad + cashCad + externalCad + nonFinancialCad,
    };
  }, [payload.currentByAccount, disnatKeys, externalKeys, filters, baseNonFinancialAssetsCad]);

  const currencyExposure = useMemo(() => {
    const byCurrency = new Map<string, number>();
    for (const acc of selectedAccounts) {
      if (acc.isExternal) continue;
      const cur = payload.currentByAccount[acc.accountKey];
      if (!cur) continue;
      const valueNative = (cur.positionsNative ?? 0) + (cur.cashNative ?? 0);
      byCurrency.set(acc.currency, (byCurrency.get(acc.currency) ?? 0) + valueNative);
    }
    return [...byCurrency.entries()].map(([currency, value]) => ({ currency, value }));
  }, [selectedAccounts, payload.currentByAccount]);

  const topPositions = useMemo(() => {
    const buckets = new Map<string, { marketValueCad: number; tickers: Set<string>; groupLabel: string | null }>();
    for (const row of payload.holdings) {
      if (!activeSet.has(row.accountKey)) continue;
      const { mapKey, groupLabel, token } = resolveAggregationGroupMeta(row.ticker);
      const marketCad = toCadEquivalent(row.marketValueNative, row.currency, payload.usdToCad);
      const prev = buckets.get(mapKey);
      if (prev) {
        prev.marketValueCad += marketCad;
        prev.tickers.add(token);
        if (groupLabel) prev.groupLabel = groupLabel;
      } else {
        buckets.set(mapKey, {
          marketValueCad: marketCad,
          tickers: new Set([token]),
          groupLabel,
        });
      }
    }
    return [...buckets.values()]
      .map((row) => ({
        ticker: formatAggregatedTickerLabel(row),
        marketValue: row.marketValueCad,
      }))
      .toSorted((a, b) => b.marketValue - a.marketValue)
      .slice(0, 8);
  }, [payload.holdings, payload.usdToCad, activeSet]);

  const sessionRows = useMemo(() => buildSessionRows(payload, new Set(disnatKeys)), [payload, disnatKeys]);
  const gainers = useMemo(() => sessionRows.filter((r) => r.dayGainCad > 0).toSorted((a, b) => b.dayGainCad - a.dayGainCad).slice(0, 6), [sessionRows]);
  const losers = useMemo(() => sessionRows.filter((r) => r.dayGainCad < 0).toSorted((a, b) => a.dayGainCad - b.dayGainCad).slice(0, 6), [sessionRows]);
  const sessionTotal = useMemo(() => sessionRows.reduce((s, r) => s + r.dayGainCad, 0), [sessionRows]);

  const control = useMemo(() => {
    const latestByAccount = latestSnapshotByAccount(payload);
    const disnatReferenceTotalCad = disnatKeys.reduce((sum, accountKey) => {
      const snap = latestByAccount.get(accountKey);
      if (!snap) return sum;
      return sum + toCadEquivalent(snap.totalValueNative, snap.currency, payload.usdToCad);
    }, 0);

    const disnatLiveTotalCad = disnatKeys.reduce(
      (sum, accountKey) => sum + (payload.currentByAccount[accountKey]?.totalCad ?? 0),
      0,
    );

    const driftPct =
      disnatReferenceTotalCad > 0
        ? ((disnatLiveTotalCad - disnatReferenceTotalCad) / disnatReferenceTotalCad) * 100
        : null;

    return {
      disnatReferenceTotalCad,
      disnatLiveTotalCad,
      driftCad: disnatLiveTotalCad - disnatReferenceTotalCad,
      driftPct,
      isHigh: driftPct !== null && Math.abs(driftPct) > 5,
    };
  }, [payload, disnatKeys]);

  const compositionDetail = `${selectedAccounts.length} comptes filtrés · ${disnatKeys.length} Disnat · ${externalKeys.length} externes`;

  return (
    <div className="space-y-8">
      <OverviewSection title="Performance" description="Rendement et variation par période (source de filtres globale)">
        <PerformanceIndicatorCard payload={payload} />
      </OverviewSection>

      <OverviewSection title="Allocation" description="Répartition du portefeuille pour le périmètre filtré">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <PortfolioCompositionKpiCard
            totalValue={allocation.totalCad}
            positionsValue={allocation.positionsCad}
            cashValue={allocation.cashCad}
            externalValueCad={allocation.externalCad}
            nonFinancialAssetsCad={allocation.nonFinancialCad}
            detail={compositionDetail}
          />
          <CurrencyExposureKpiCard currencyExposure={currencyExposure} />
          <TopPositionsKpiCard topPositions={topPositions} totalValue={allocation.totalCad} />
        </div>
      </OverviewSection>

      <OverviewSection title="Marche" description="Mouvement des titres du périmètre filtré">
        <div className="grid gap-4 lg:grid-cols-2">
          <SessionListCard title="Hausse" rows={gainers} emptyHint="Aucun titre en hausse." />
          <SessionListCard title="Baisse" rows={losers} emptyHint="Aucun titre en baisse." />
        </div>
        <Card className="border-slate-200 bg-white">
          <CardContent className="py-3 text-right text-sm">
            <span className="text-slate-600">Total séance filtré: </span>
            <span className={`tabular-nums font-semibold ${signedGainClass(sessionTotal)}`}>
              {formatCurrency(sessionTotal, "CAD")}
            </span>
          </CardContent>
        </Card>
      </OverviewSection>

      <OverviewSection title="Controle" description="Reconciliation Disnat pour le périmètre filtré">
        <section className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
          <div className="mt-1 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
            <MetricChip label="Reference fichier" value={formatCurrency(control.disnatReferenceTotalCad, "CAD")} />
            <MetricChip
              label="Ecart"
              value={formatCurrency(control.driftCad, "CAD")}
              tone={Math.abs(control.driftCad) > 0 ? "warning" : "neutral"}
            />
            <MetricChip
              label="Ecart %"
              value={control.driftPct === null ? "Non disponible" : formatPercent(control.driftPct)}
              tone={control.isHigh ? "warning" : "neutral"}
            />
          </div>
        </section>
      </OverviewSection>
    </div>
  );
}

function SessionListCard({
  title,
  rows,
  emptyHint,
}: {
  title: string;
  rows: TickerRow[];
  emptyHint: string;
}) {
  const Icon = title === "Hausse" ? TrendingUp : TrendingDown;

  return (
    <Card className="border-slate-200 bg-white">
      <CardContent className="py-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Icon className="size-4 text-slate-500" />
          {title}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{emptyHint}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {rows.map((row) => (
              <li key={`${row.ticker}|${row.currency}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{row.ticker}</p>
                  <p className="truncate text-xs text-slate-500" title={row.securityName}>{row.securityName}</p>
                </div>
                <div className="text-right">
                  <p className={`tabular-nums text-sm ${signedGainClass(row.dayGainCad)}`}>
                    {formatCurrency(row.dayGainCad, "CAD")}
                  </p>
                  <p className={`tabular-nums text-xs ${signedGainClass(row.changePerShare)}`}>
                    {formatCurrency(row.changePerShare, row.currency)} / action
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function OverviewSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h3 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500 sm:text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}

function MetricChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div
      className={
        tone === "warning"
          ? "rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2"
          : "rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2"
      }
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
