"use client";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils";
import {
  aggregateSessionGainsForAccounts,
  signedGainClass,
} from "./performance-indicator-logic";
import type { PerformanceIndicatorPayload } from "./performance-indicator-types";

const DAYS_SHOWN = 10;

type DailyRow = {
  date: string;
  shortDate: string;
  gainCad: number;
  gainPct: number | null;
  cumulativePct: number;
};

function formatShortDate(iso: string) {
  const [, month, day] = iso.split("-");
  return `${month}/${day}`;
}

function formatLongDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("fr-CA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Toronto",
  });
}

function formatAxisCad(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value));
}

export function buildDailyPerformanceRows(
  payload: PerformanceIndicatorPayload,
  accountKeys: string[],
  daysShown = DAYS_SHOWN,
): DailyRow[] {
  const sessions = aggregateSessionGainsForAccounts(payload, accountKeys).slice(-daysShown);
  let cumulativeFactor = 1;
  return sessions.map((s) => {
    const gainPct = s.priorCad > 0 ? (s.gainCad / s.priorCad) * 100 : null;
    if (gainPct !== null) cumulativeFactor *= 1 + gainPct / 100;
    return {
      date: s.date,
      shortDate: formatShortDate(s.date),
      gainCad: s.gainCad,
      gainPct,
      cumulativePct: (cumulativeFactor - 1) * 100,
    };
  });
}

export function DailyPerformanceHistoryCard({
  payload,
  accountKeys,
}: {
  payload: PerformanceIndicatorPayload;
  accountKeys: string[];
}) {
  const rows = useMemo(() => buildDailyPerformanceRows(payload, accountKeys), [payload, accountKeys]);

  if (rows.length === 0) return null;

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-slate-900">
            Résultat par jour — {rows.length} dernières séances
          </h4>
          <p className="text-xs text-slate-500">
            Gain/perte total du périmètre filtré, séance par séance.
          </p>
        </div>

        <div className="h-56 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="shortDate"
                tick={{ fill: "#64748b", fontSize: 12 }}
                axisLine={{ stroke: "#e2e8f0" }}
                tickLine={false}
              />
              <YAxis
                yAxisId="cad"
                tickFormatter={formatAxisCad}
                tick={{ fill: "#64748b", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <YAxis
                yAxisId="pct"
                orientation="right"
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                tick={{ fill: "#64748b", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <ReferenceLine yAxisId="cad" y={0} stroke="#cbd5e1" />
              <Tooltip
                content={({ active, payload: tooltipPayload }) => {
                  const row = tooltipPayload?.[0]?.payload as DailyRow | undefined;
                  if (!active || !row) return null;
                  return (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
                      <p className="font-semibold text-slate-950">{formatLongDate(row.date)}</p>
                      <p className={`mt-1 tabular-nums font-medium ${signedGainClass(row.gainCad)}`}>
                        {formatCurrency(row.gainCad, "CAD")}
                        {row.gainPct !== null ? ` · ${formatPercent(row.gainPct)}` : ""}
                      </p>
                      <p className="mt-1 text-slate-500">
                        Cumul : {formatPercent(row.cumulativePct)}
                      </p>
                    </div>
                  );
                }}
              />
              <Bar yAxisId="cad" dataKey="gainCad" radius={[6, 6, 0, 0]}>
                {rows.map((row) => (
                  <Cell key={row.date} fill={row.gainCad >= 0 ? "#0f766e" : "#dc2626"} fillOpacity={0.75} />
                ))}
              </Bar>
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="cumulativePct"
                stroke="#334155"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-100 text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-1.5 pr-2">Date</th>
                <th className="py-1.5 pr-2 text-right">Résultat $</th>
                <th className="py-1.5 pr-2 text-right">Résultat %</th>
                <th className="py-1.5 text-right">Cumul %</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((row) => (
                <tr key={row.date} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-2 font-medium text-slate-700">{row.date}</td>
                  <td className={`py-1.5 pr-2 text-right tabular-nums ${signedGainClass(row.gainCad)}`}>
                    {formatCurrency(row.gainCad, "CAD")}
                  </td>
                  <td className={`py-1.5 pr-2 text-right tabular-nums ${signedGainClass(row.gainPct)}`}>
                    {row.gainPct === null ? "—" : formatPercent(row.gainPct)}
                  </td>
                  <td className={`py-1.5 text-right tabular-nums ${signedGainClass(row.cumulativePct)}`}>
                    {formatPercent(row.cumulativePct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
