"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  Filter,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  computeAllPeriodResults,
  computePeriodResult,
  defaultPerformanceFilters,
  PERFORMANCE_PERIODS,
  signedGainBg,
  signedGainClass,
} from "./performance-indicator-logic";
import type {
  PerformanceFilterState,
  PerformanceIndicatorPayload,
  PerformancePeriodId,
  PerformanceScopePreset,
} from "./performance-indicator-types";

const STORAGE_KEY = "disnatia.overview.performanceFilters";

type StoredFilters = Partial<
  Pick<
    PerformanceFilterState,
    | "preset"
    | "owner"
    | "includedAccountKeys"
    | "excludedAccountKeys"
    | "selectedYear"
    | "activePeriod"
  >
>;

function loadStoredFilters(): StoredFilters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredFilters;
  } catch {
    return null;
  }
}

function saveStoredFilters(filters: PerformanceFilterState) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        preset: filters.preset,
        owner: filters.owner,
        includedAccountKeys: filters.includedAccountKeys,
        excludedAccountKeys: filters.excludedAccountKeys,
        selectedYear: filters.selectedYear,
        activePeriod: filters.activePeriod,
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
  "week",
  "month",
  "ytd",
  "year",
  "all",
];

function formatGain(value: number | null, compact = false): string {
  if (value === null) return "—";
  const prefix = value > 0 ? "+" : "";
  if (compact && Math.abs(value) >= 100_000) {
    return `${prefix}${(value / 1000).toFixed(1)}k $`;
  }
  return `${prefix}${formatCurrency(value, "CAD")}`;
}

function formatGainPct(value: number | null): string {
  if (value === null) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatPercent(value)}`;
}

export function PerformanceIndicatorCard({
  payload,
}: {
  payload: PerformanceIndicatorPayload;
}) {
  const [filters, setFilters] = useState<PerformanceFilterState>(() => {
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
  });
  const [scopeOpen, setScopeOpen] = useState(false);

  useEffect(() => {
    saveStoredFilters(filters);
  }, [filters]);

  const owners = useMemo(() => {
    const set = new Set<string>();
    for (const a of payload.accounts) {
      if (a.owner) set.add(a.owner);
    }
    return [...set].toSorted();
  }, [payload.accounts]);

  const periodResults = useMemo(
    () => computeAllPeriodResults(payload, filters),
    [payload, filters],
  );

  const active = useMemo(
    () => computePeriodResult(payload, filters, filters.activePeriod),
    [payload, filters],
  );

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
    if (filters.owner) parts.push(filters.owner.split(" ")[0] ?? filters.owner);
    if (filters.excludedAccountKeys.length > 0) {
      parts.push(`${filters.excludedAccountKeys.length} exclu(s)`);
    }
    if (filters.preset === "custom" && filters.includedAccountKeys.length > 0) {
      parts.push(`${filters.includedAccountKeys.length} compte(s)`);
    }
    return parts.join(" · ");
  }, [filters]);

  if (payload.accounts.length === 0) return null;

  return (
    <Card className="overflow-hidden border-slate-800 bg-slate-950 text-white shadow-lg ring-1 ring-white/10">
      <CardContent className="p-0">
        <div className="relative isolate">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,rgba(16,185,129,0.22),transparent_42%),radial-gradient(circle_at_85%_15%,rgba(56,189,248,0.18),transparent_38%)]" />

          {/* En-tête + filtres portée */}
          <div className="flex flex-col gap-4 border-b border-white/10 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30">
                <Activity className="size-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold tracking-tight">
                    Performance dynamique
                  </h3>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-200">
                    <Sparkles className="size-3" />
                    Live
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  Gains et pertes en $ et % · filtres par période, portée et comptes
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
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
                        : "text-slate-300 hover:bg-white/10 hover:text-white"
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
                  className="rounded-xl border-0 bg-white/5 px-3 py-2 text-xs text-slate-200 ring-1 ring-white/10 focus:ring-cyan-400/50"
                >
                  <option value="">Tous propriétaires</option>
                  {owners.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : null}

              <Button
                type="button"
                variant="ghost"
                className="h-9 gap-2 rounded-xl bg-white/5 text-slate-200 ring-1 ring-white/10 hover:bg-white/10 hover:text-white"
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

          {/* Panneau comptes */}
          {scopeOpen ? (
            <div className="border-b border-white/10 bg-black/20 px-5 py-4 sm:px-6">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Inclure / exclure des comptes
                </p>
                <button
                  type="button"
                  className="text-xs text-slate-400 hover:text-white"
                  onClick={() =>
                    updateFilters({
                      preset: "all",
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
                          ? "bg-rose-500/10 ring-rose-400/20 opacity-60"
                          : included
                            ? "bg-cyan-500/10 ring-cyan-400/30"
                            : "bg-white/5 ring-white/10 hover:bg-white/10"
                      }`}
                    >
                      <Switch
                        checked={!excluded}
                        onCheckedChange={() => toggleAccountExclusion(acc.accountKey)}
                        aria-label={`Inclure ${acc.label}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-100">
                          {acc.label}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {acc.isExternal ? `Externe · ${acc.provider}` : "Disnat"}
                          {acc.owner ? ` · ${acc.owner}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-slate-400">
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

          {/* Hero + matrice périodes */}
          <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-slate-400">
                  {active.label}
                  {filters.activePeriod === "year" ? ` · ${filters.selectedYear}` : ""}
                </p>
                {filters.activePeriod === "year" ? (
                  <select
                    value={filters.selectedYear}
                    onChange={(e) =>
                      updateFilters({ selectedYear: Number(e.target.value) })
                    }
                    className="rounded-lg border-0 bg-white/10 px-2 py-1 text-xs text-white ring-1 ring-white/10"
                  >
                    {payload.availableYears.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>

              <div className="mt-3 flex items-end gap-3">
                {active.gainCad !== null && active.gainCad >= 0 ? (
                  <TrendingUp className="size-8 shrink-0 text-emerald-400/80" />
                ) : active.gainCad !== null && active.gainCad < 0 ? (
                  <TrendingDown className="size-8 shrink-0 text-rose-400/80" />
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
                    {formatGainPct(active.gainPct)}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>
                  {active.accountsIncluded} compte{active.accountsIncluded > 1 ? "s" : ""}
                </span>
                {active.baselineDate ? (
                  <span>Réf. {active.baselineDate}</span>
                ) : null}
                {active.method === "live-quotes" && payload.quotesAsOf ? (
                  <span>
                    Cours{" "}
                    {new Date(payload.quotesAsOf).toLocaleString("fr-CA", {
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
                <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90 ring-1 ring-amber-400/20">
                  {active.note}
                </p>
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
                        ? `${signedGainBg(row.gainCad)} ring-2 ring-white/30`
                        : "bg-white/5 ring-white/10 hover:bg-white/10"
                    }`}
                  >
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      {PERFORMANCE_PERIODS[row.periodId].shortLabel}
                    </p>
                    <p
                      className={`mt-1 text-lg font-semibold tabular-nums ${signedGainClass(row.gainCad)}`}
                    >
                      {formatGain(row.gainCad, true)}
                    </p>
                    <p className={`text-xs tabular-nums ${signedGainClass(row.gainPct)}`}>
                      {formatGainPct(row.gainPct)}
                    </p>
                    {row.incomplete && row.gainCad !== null ? (
                      <span className="absolute right-2 top-2 size-1.5 rounded-full bg-amber-400" title="Données partielles" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bandeau périodes (navigation rapide) */}
          <div className="flex gap-1 overflow-x-auto border-t border-white/10 bg-black/25 px-3 py-2">
            {PERIOD_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => updateFilters({ activePeriod: id })}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  filters.activePeriod === id
                    ? "bg-white/15 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                {PERFORMANCE_PERIODS[id].label}
              </button>
            ))}
          </div>
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
