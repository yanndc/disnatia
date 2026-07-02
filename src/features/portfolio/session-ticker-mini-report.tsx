"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatCurrency, formatCurrencyDetailed } from "@/lib/utils";
import {
  formatTorontoCalendarDate,
  nextTradingDayIso,
  previousTradingDayIso,
} from "@/lib/market/equity-session";
import { signedGainBg, signedGainClass } from "./performance-indicator-logic";
import type {
  SessionTickerDiagnostics,
  SessionTickerMiniReport,
  SessionTickerRow,
  SessionTickerView,
} from "./session-ticker-report-queries";
import { SessionTickerHistoryChart } from "./session-ticker-history-chart";

type InlineToast = {
  id: number;
  variant: "info" | "success" | "error";
  message: string;
};

function toastClasses(variant: InlineToast["variant"]): string {
  if (variant === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (variant === "error") {
    return "border-rose-200 bg-rose-50 text-rose-900";
  }
  return "border-slate-200 bg-white text-slate-800";
}

function formatSessionDate(iso: string): string {
  return formatTorontoCalendarDate(iso);
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
          <table className="w-full min-w-70 text-left text-xs">
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
                    className="hidden max-w-32 truncate py-1.5 pr-2 text-slate-500 sm:table-cell"
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
  const netPnl = view.totalGainCad;
  const hasRows = allRows.length > 0 || netPnl !== null;

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
      {hasRows && netPnl !== null ? (
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

export function SessionTickerMiniReport({
  report,
  accountKeys,
}: {
  report: SessionTickerMiniReport;
  accountKeys?: string[];
}) {
  const [view, setView] = useState(report.view);
  const [maxSessionDate, setMaxSessionDate] = useState(report.maxSessionDate);
  const [minSessionDate, setMinSessionDate] = useState(report.minSessionDate);
  const [sessionDataHealth, setSessionDataHealth] = useState(report.sessionDataHealth);
  const [previousSessionDate, setPreviousSessionDate] = useState(
    report.previousSessionDate,
  );
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<InlineToast[]>([]);
  const toastSeq = useRef(1);
  const lastDiagnosticsSessionDate = useRef<string | null>(null);

  const pushToast = useCallback(
    (variant: InlineToast["variant"], message: string, durationMs = 4000) => {
      const id = toastSeq.current++;
      setToasts((prev) => [...prev, { id, variant, message }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, durationMs);
    },
    [],
  );

  const publishDiagnostics = useCallback(
    (diagnostics: SessionTickerDiagnostics | undefined) => {
      if (!diagnostics) return;
      for (const line of diagnostics.processing) {
        pushToast("info", line, 5500);
      }
      if (diagnostics.attemptedHoldingsRepair) {
        pushToast("success", "Holdings reconstruits et persistés pour la séance.", 5000);
      }
    },
    [pushToast],
  );

  const canGoBack = view.sessionDate > minSessionDate;
  const canGoForward = view.sessionDate < maxSessionDate;

  const loadSession = useCallback(async (sessionDate: string) => {
    setLoading(true);
    pushToast("info", "Chargement de la séance en cours...", 2200);
    try {
      const params = new URLSearchParams({
        sessionDate,
      });
      if (accountKeys && accountKeys.length > 0) {
        params.set("accountKeys", accountKeys.join(","));
      }
      const res = await fetch(`/api/portfolio/session-ticker-report?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        ok: boolean;
        view: SessionTickerView;
        maxSessionDate: string;
        minSessionDate: string;
        sessionDataHealth?: SessionTickerMiniReport["sessionDataHealth"];
        previousSessionDate?: string;
        diagnostics?: SessionTickerDiagnostics;
        code?: string;
        message?: string;
      };
      if (!res.ok || !data.ok || !data.view) {
        if (data.diagnostics?.processing?.length) {
          for (const line of data.diagnostics.processing) {
            pushToast("error", line, 6500);
          }
        }
        pushToast(
          "error",
          data.message ?? "Impossible de charger la séance demandée.",
          6500,
        );
        return;
      }

      if (data.ok && data.view) {
        setView({
          ...data.view,
          lists: {
            gainers: data.view.lists?.gainers ?? [],
            losers: data.view.lists?.losers ?? [],
          },
        });
        setMaxSessionDate(data.maxSessionDate);
        setMinSessionDate(data.minSessionDate);
        if (data.sessionDataHealth) setSessionDataHealth(data.sessionDataHealth);
        if (data.previousSessionDate) setPreviousSessionDate(data.previousSessionDate);
        publishDiagnostics(data.view.diagnostics ?? data.diagnostics);
      }
    } catch {
      pushToast("error", "Erreur réseau pendant le chargement de la séance.", 6500);
      /* conserve la vue actuelle */
    } finally {
      setLoading(false);
    }
  }, [accountKeys, publishDiagnostics, pushToast]);

  useEffect(() => {
    if (lastDiagnosticsSessionDate.current === report.view.sessionDate) return;
    lastDiagnosticsSessionDate.current = report.view.sessionDate;
    publishDiagnostics(report.view.diagnostics);
  }, [publishDiagnostics, report.view.diagnostics, report.view.sessionDate]);

  useEffect(() => {
    const lines = report.view.diagnostics?.processing ?? [];
    const hasMissingHoldingsDiagnostic = lines.some((line) =>
      line.toLowerCase().includes("holdings absents"),
    );
    if (!hasMissingHoldingsDiagnostic) return;
    const id = window.setTimeout(() => {
      void loadSession(report.view.sessionDate);
    }, 0);
    return () => window.clearTimeout(id);
  }, [loadSession, report.view.diagnostics, report.view.sessionDate]);

  function goBack() {
    if (!canGoBack || loading) return;
    void loadSession(previousTradingDayIso(view.sessionDate, 1));
  }

  function goForward() {
    if (!canGoForward || loading) return;
    void loadSession(nextTradingDayIso(view.sessionDate));
  }

  const allRows = [...view.lists.gainers, ...view.lists.losers];
  const sessionTotalCad = view.totalGainCad;
  const sessionTitleCount = allRows.length;
  const comparesToPerformancePrev = view.sessionDate === previousSessionDate;

  return (
    <>
      <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        {!sessionDataHealth.ok ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900">
            <p className="font-semibold">
              Données de séance invalides — total peut différer de Performance
            </p>
            <p className="mt-1">
              {sessionDataHealth.message ?? "Historisation des séances absente."}
            </p>
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base text-slate-800">
              Rapport titres par séance
            </CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Symbole, nom, variation $/action (devise du titre), P&L du jour en CAD — trié du
              plus fort au plus faible.
              {view.sessionDate === maxSessionDate && view.sessionDate !== previousSessionDate ? (
                <>
                  {" "}
                  « Préc. » (Performance) = séance du{" "}
                  {formatSessionDate(previousSessionDate)} — flèche ← pour comparer.
                </>
              ) : null}
              {comparesToPerformancePrev ? (
                <> Aligné sur « Préc. » dans Performance dynamique.</>
              ) : null}
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

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-center gap-2 sm:justify-start">
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
              className={`min-w-0 text-center sm:text-left ${loading ? "opacity-60" : ""}`}
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

          <div
            className={cn(
              "shrink-0 rounded-xl border px-3 py-2",
              signedGainBg(sessionTotalCad),
              loading ? "opacity-60" : "",
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Total séance
            </p>
            <p
              className={cn(
                "text-lg font-semibold tabular-nums leading-tight",
                signedGainClass(sessionTotalCad),
              )}
            >
              {sessionTotalCad !== null ? formatCurrency(sessionTotalCad, "CAD") : "—"}
            </p>
            {sessionTitleCount > 0 ? (
              <p className="text-[10px] text-slate-500">
                {sessionTitleCount} titre{sessionTitleCount > 1 ? "s" : ""}
              </p>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className={loading ? "pointer-events-none opacity-60" : undefined}>
        {report.history.length > 1 ? (
          <div className="mb-4">
            <SessionTickerHistoryChart
              history={report.history}
              activeSessionDate={view.sessionDate}
            />
          </div>
        ) : null}
        <SessionBlock view={view} />
        {!loading &&
        view.lists.gainers.length + view.lists.losers.length === 0 ? (
          <p className="mt-3 text-center text-xs text-slate-400">
            Aucune variation enregistrée pour cette séance — historique de clôtures incomplet ou
            positions inchangées.
          </p>
        ) : null}
      </CardContent>
      </Card>

      {toasts.length > 0 ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,28rem)] flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`rounded-lg border px-3 py-2 text-xs shadow-sm ${toastClasses(toast.variant)}`}
            >
              {toast.message}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
