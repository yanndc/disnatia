import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatCurrencyDetailed } from "@/lib/utils";
import { signedGainClass } from "./performance-indicator-logic";
import type {
  SessionTickerLists,
  SessionTickerMiniReport,
  SessionTickerRow,
} from "./session-ticker-report-queries";

function formatSessionDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("fr-CA", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
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
          </table>
        </div>
      )}
    </div>
  );
}

function SessionBlock({
  label,
  sessionDate,
  lists,
}: {
  label: string;
  sessionDate: string;
  lists: SessionTickerLists;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-semibold text-slate-800">{label}</span>
        <span className="text-xs text-slate-500">{formatSessionDate(sessionDate)}</span>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <TickerTable
          title="Hausse"
          rows={lists.gainers}
          emptyHint="Aucun titre en hausse."
        />
        <TickerTable
          title="Baisse"
          rows={lists.losers}
          emptyHint="Aucun titre en baisse."
        />
      </div>
    </div>
  );
}

export function SessionTickerMiniReport({ report }: { report: SessionTickerMiniReport }) {
  const hasAny =
    report.current.gainers.length +
      report.current.losers.length +
      report.previous.gainers.length +
      report.previous.losers.length >
    0;

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
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
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasAny ? (
          <p className="text-sm text-slate-500">
            Aucune variation de séance disponible. Actualise les cours ou attends la clôture
            pour alimenter l’historique.
          </p>
        ) : (
          <>
            <SessionBlock
              label={report.currentSessionLabel}
              sessionDate={report.currentSessionDate}
              lists={report.current}
            />
            <SessionBlock
              label={report.previousSessionLabel}
              sessionDate={report.previousSessionDate}
              lists={report.previous}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
