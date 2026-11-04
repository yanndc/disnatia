import Link from "next/link";
import { ArrowRight, Scale } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getDisnatDriftSummary, type DriftTone } from "@/features/portfolio/disnat-drift";
import { formatCurrency } from "@/lib/utils";

const TONE_CLASS: Record<DriftTone, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  error: "bg-rose-50 text-rose-700 ring-rose-200",
};

const TONE_LABEL: Record<DriftTone, string> = {
  ok: "concilié",
  warning: "à surveiller",
  error: "écart",
};

/**
 * Preuve de conciliation : valeur recalculée (transactions × cours + encaisse)
 * comparée au dernier export portefeuille Disnat, global et par compte.
 */
export async function DisnatDriftCard() {
  const summary = await getDisnatDriftSummary().catch(() => null);
  if (!summary || summary.accounts.length === 0) return null;

  const { global } = summary;
  const worst = summary.accounts.slice(0, 3);

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950">
            <Scale className="size-4 text-cyan-600" />
            Écart vs Disnat
          </h2>
          <Link
            href="/imports?tab=reconciliation"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            Détail <ArrowRight className="size-3" />
          </Link>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ring-1 ${TONE_CLASS[global.tone]}`}
          >
            {global.deltaCad > 0 ? "+" : ""}
            {formatCurrency(global.deltaCad, "CAD")}
            {global.deltaPct !== null
              ? ` (${global.deltaPct > 0 ? "+" : ""}${global.deltaPct.toLocaleString("fr-CA", {
                  maximumFractionDigits: 2,
                })} %)`
              : ""}
          </span>
          <span className="text-slate-500">{TONE_LABEL[global.tone]}</span>
          <span className="text-slate-400">
            recalculé {formatCurrency(global.liveCad, "CAD")} · fichier{" "}
            {formatCurrency(global.disnatCad, "CAD")}
            {summary.referenceAsOf ? ` au ${summary.referenceAsOf}` : ""}
          </span>
        </div>

        <ul className="mt-3 divide-y divide-slate-100 text-xs">
          {worst.map((account) => (
            <li key={account.accountKey} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="text-slate-700">
                <span className="font-medium">{account.label}</span>
                <span className="text-slate-400"> · {account.owner ?? "—"}</span>
              </span>
              <span className={`tabular-nums ${account.tone === "ok" ? "text-slate-500" : "text-rose-600"}`}>
                {account.deltaCad > 0 ? "+" : ""}
                {formatCurrency(account.deltaCad, "CAD")}
                {account.deltaPct !== null
                  ? ` (${account.deltaPct > 0 ? "+" : ""}${account.deltaPct.toLocaleString("fr-CA", {
                      maximumFractionDigits: 2,
                    })} %)`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-slate-400">
          Vert ≤ 0,5 % · ambre ≤ 2 % · rouge au-delà. Un import portefeuille met la référence à jour.
        </p>
      </CardContent>
    </Card>
  );
}
