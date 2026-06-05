"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatCurrencyDetailed } from "@/lib/utils";
import {
  nextTradingDayIso,
  previousTradingDayIso,
} from "@/lib/market/equity-session";
import { signedGainClass } from "./performance-indicator-logic";
import type {
  SessionTickerMiniReport,
  SessionTickerRow,
  SessionTickerView,
} from "./session-ticker-report-queries";

function formatSessionDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("fr-CA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Toronto",
  });
}

function sumDayGainCad(rows: SessionTickerRow[]): number {
  return rows.reduce((acc, row) => acc + row.dayGainCad, 0);
}

function TickerTable({
  title,
  rows,
  emptyHint,
}: {
  title: string;
  rows: SessionTickerRow[];
  emptyHint: string;
}) {
  const subtotalPnl = sumDayGainCad(rows);

  return (
    <div className="min-w-0 flex-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h4>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">{emptyHint}</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[280px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-2">Symbole</th>
                <th className="hidden py-1.5 pr-2 sm:table-cell">Nom</th>
                <th className="py-1.5 pr-2 text-right">Δ $</th>
                <th className="py-1.5 text-right">P&L jour</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.ticker}-${row.currency}`}
                  className="border-b border-slate-50 last:border-0"
                >
                  <td className="py-1.5 pr-2 font-medium text-slate-800">
                    {row.ticker}
                  </td>
                  <td
                    className="hidden max-w-[8rem] truncate py-1.5 pr-2 text-slate-500 sm:table-cell"
                    title={row.securityName}
                  >
                    {row.securityName}
                  </td>
                  <td
                    className={`py-1.5 pr-2 text-right tabular-nums ${signedGainClass(row.changePerShare)}`}
                  >
                    {formatCurrencyDetailed(
                      row.changePerShare,
                      row.currency,
                      2,
                    )}
                  </td>
                  <td
                    className={`py-1.5 text-right tabular-nums ${signedGainClass(row.dayGainCad)}`}
                  >
                    {formatCurrency(row.dayGainCad, "CAD")}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 text-[11px] font-semibold text-slate-700">
                <td className="py-2 pr-2" colSpan={2}>
                  Sous-total ({rows.length})
                </td>
                <td className="py-2 pr-2 text-right tabular-nums text-slate-400">—</td>
                <td
                  className={`py-2 text-right tabular-nums ${signedGainClass(subtotalPnl)}`}
                >
                  {formatCurrency(subtotalPnl, "CAD")}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function SessionBlock({ view }: { view: SessionTickerView }) {
  const allRows = [...view.lists.gainers, ...view.lists.losers];
  const netPnl = sumDayGainCad(allRows);
  const hasRows = allRows.length > 0;

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <TickerTable
          title="Hausse"
          rows={view.lists.gainers}
          emptyHint="Aucun titre en hausse."
        />
        <TickerTable
          title="Baisse"
          rows={view.lists.losers}
          emptyHint="Aucun titre en baisse."
        />
      </div>
      {hasRows ? (
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-200 pt-3 text-sm">
          <span className="font-semibold text-slate-700">
            Total séance ({allRows.length} titres)
          </span>
          <span className={`tabular-nums font-semibold ${signedGainClass(netPnl)}`}>
            {formatCurrency(netPnl, "CAD")}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function SessionTickerMiniReport({ report }: { report: SessionTickerMiniReport }) {
  const [view, setView] = useState(report.view);
  const [maxSessionDate, setMaxSessionDate] = useState(report.maxSessionDate);
  const [minSessionDate, setMinSessionDate] = useState(report.minSessionDate);
  const [loading, setLoading] = useState(false);

  const canGoBack = view.sessionDate > minSessionDate;
  const canGoForward = view.sessionDate < maxSessionDate;

  const loadSession = useCallback(async (sessionDate: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/portfolio/session-ticker-report?sessionDate=${encodeURIComponent(sessionDate)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok: boolean;
        view: SessionTickerView;
        maxSessionDate: string;
        minSessionDate: string;
      };
      if (data.ok) {
        setView(data.view);
        setMaxSessionDate(data.maxSessionDate);
        setMinSessionDate(data.minSessionDate);
      }
    } catch {
      /* conserve la vue actuelle */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setView(report.view);
    setMaxSessionDate(report.maxSessionDate);
    setMinSessionDate(report.minSessionDate);
  }, [report]);

  function goBack() {
    if (!canGoBack || loading) return;
    void loadSession(previousTradingDayIso(view.sessionDate, 1));
  }

  function goForward() {
    if (!canGoForward || loading) return;
    void loadSession(nextTradingDayIso(view.sessionDate));
  }

  const hasAny = view.lists.gainers.length + view.lists.losers.length > 0;

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base text-slate-800">
              Rapport titres par séance
            </CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Symbole, nom, variation $/action (devise du titre), P&L du jour en CAD — trié du
              plus fort au plus faible.
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <TrendingUp className="size-4" />
            </div>
            <div className="flex size-8 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
              <TrendingDown className="size-4" />
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 sm:justify-start">
          <Button
            type="button"
            variant="secondary"
            className="size-9 shrink-0 px-0"
            onClick={goBack}
            disabled={!canGoBack || loading}
            aria-label="Séance précédente"
          >
            <ChevronLeft className="size-4" />
          </Button>

          <div
            className={`min-w-0 flex-1 text-center sm:flex-initial sm:text-left ${loading ? "opacity-60" : ""}`}
          >
            <p className="text-sm font-semibold text-slate-800">{view.sessionLabel}</p>
            <p className="text-xs text-slate-500">{formatSessionDate(view.sessionDate)}</p>
          </div>

          <Button
            type="button"
            variant="secondary"
            className="size-9 shrink-0 px-0"
            onClick={goForward}
            disabled={!canGoForward || loading}
            aria-label="Séance suivante"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <p className="text-sm text-slate-500">
            Aucune variation pour cette séance. Navigue vers une autre date ou actualise les
            cours pour alimenter l&apos;historique.
          </p>
        ) : (
          <SessionBlock view={view} />
        )}
      </CardContent>
    </Card>
  );
}
