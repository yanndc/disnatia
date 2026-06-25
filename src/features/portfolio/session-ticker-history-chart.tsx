"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/utils";
import { signedGainClass } from "./performance-indicator-logic";
import type { SessionTickerHistoryPoint } from "./session-ticker-report-queries";

function formatAxis(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value));
}

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

export function SessionTickerHistoryChart({
  history,
  activeSessionDate,
}: {
  history: SessionTickerHistoryPoint[];
  activeSessionDate: string;
}) {
  const chartData = history.map((point) => ({
    ...point,
    shortDate: formatShortDate(point.sessionDate),
  }));

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Résultat journalier portefeuille
          </p>
          <p className="text-xs text-slate-500">
            Même total final que dans le rapport par séance, sur les 30 dernières séances.
          </p>
        </div>
      </div>

      <div className="h-52 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="shortDate"
              tick={{ fill: "#64748b", fontSize: 12 }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={false}
              minTickGap={18}
            />
            <YAxis
              tickFormatter={formatAxis}
              tick={{ fill: "#64748b", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <ReferenceLine y={0} stroke="#cbd5e1" />
            <Tooltip
              cursor={{ fill: "#f8fafc" }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as
                  | (SessionTickerHistoryPoint & { shortDate: string })
                  | undefined;
                if (!active || !row) return null;
                return (
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
                    <p className="font-semibold text-slate-950">{formatLongDate(row.sessionDate)}</p>
                    <p className={`mt-1 tabular-nums font-medium ${signedGainClass(row.totalGainCad)}`}>
                      {formatCurrency(row.totalGainCad, "CAD")}
                    </p>
                    {row.isLive ? <p className="mt-1 text-slate-500">Séance courante</p> : null}
                  </div>
                );
              }}
            />
            <Bar dataKey="totalGainCad" radius={[6, 6, 0, 0]}>
              {chartData.map((point) => {
                const isActive = point.sessionDate === activeSessionDate;
                const fill = point.totalGainCad >= 0 ? "#0f766e" : "#dc2626";
                return (
                  <Cell
                    key={point.sessionDate}
                    fill={fill}
                    fillOpacity={isActive ? 1 : 0.72}
                    stroke={isActive ? "#0f172a" : fill}
                    strokeWidth={isActive ? 1.25 : 0}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}