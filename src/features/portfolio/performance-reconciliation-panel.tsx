"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PerformanceReconciliationPayload } from "@/features/portfolio/performance-reconciliation";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<string, string> = {
  ok: "text-emerald-700",
  warning: "text-amber-700",
  error: "text-rose-700",
  unknown: "text-slate-400",
};

function formatPct(value: number | null): string {
  if (value === null) return "—";
  return `${value.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

function formatGap(value: number | null): string {
  if (value === null) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pt`;
}

/**
 * Réconciliation des rendements : valeurs publiées par Disnat (« Rendement de portefeuille »)
 * vs TWR calculés par l'app, par client et par période.
 */
export function PerformanceReconciliationPanel({
  initial,
}: {
  initial: PerformanceReconciliationPayload;
}) {
  const [data, setData] = useState(initial);
  const [referenceDate, setReferenceDate] = useState(
    initial.referenceDate ?? initial.asOfNow,
  );
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    if (!csv.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/performance/references", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ referenceDate, csv }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        saved?: number;
        reconciliation?: PerformanceReconciliationPayload;
      };
      if (!response.ok || !payload.reconciliation) {
        setMessage(payload.error ?? "Enregistrement impossible.");
        return;
      }
      setData(payload.reconciliation);
      setCsv("");
      setMessage(`${payload.saved ?? 0} valeur(s) enregistrée(s) au ${referenceDate}.`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/performance/references?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        reconciliation?: PerformanceReconciliationPayload;
      };
      if (payload.reconciliation) setData(payload.reconciliation);
      if (payload.error) setMessage(payload.error);
    } finally {
      setBusy(false);
    }
  }

  const periods = data.clients[0]?.periods.map((cell) => cell.label) ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Rendement : app vs Disnat</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Colle le tableau de Disnat (<em>Rendement de portefeuille → Rendement par client</em>) :
            une ligne par client, puis 6 pourcentages (1 mois, 3 mois, 1 an, 3 ans, année à date,
            depuis le début). Les codes clients viennent du préfixe des comptes (« 5KFZE », « 5L3AP »).
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Date de référence Disnat
              </label>
              <Input
                type="date"
                value={referenceDate}
                onChange={(event) => setReferenceDate(event.target.value)}
                className="h-9 w-44 text-xs"
              />
            </div>
            <div className="min-w-[18rem] flex-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Tableau collé
              </label>
              <textarea
                value={csv}
                onChange={(event) => setCsv(event.target.value)}
                placeholder={"5KFZE;1,47;1,19;19,99;25,97;15,84;22,80\n5L3AP;2,41;2,48;20,64;-;18,12;24,70"}
                className="h-16 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-600 outline-none focus:border-slate-400"
              />
            </div>
            <Button
              onClick={() => void save()}
              disabled={busy || !csv.trim()}
              className="h-9 gap-1.5 text-xs"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Enregistrer
            </Button>
          </div>

          {message ? <p className="text-xs text-slate-600">{message}</p> : null}

          {data.referenceDate ? (
            <p className="text-xs text-slate-500">
              Référence comparée : <strong>{data.referenceDate}</strong> · {data.referenceCount}{" "}
              valeur(s) · TWR app au {data.asOfNow}
            </p>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Aucune référence Disnat enregistrée : colle le tableau ci-dessus pour activer la
              comparaison.
            </p>
          )}

          {data.clients.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun compte Disnat trouvé pour comparer.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="pb-2">Client</th>
                    {periods.map((label) => (
                      <th key={label} className="pb-2 text-right">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.clients.map((client) => (
                    <tr key={client.clientCode}>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-slate-800">{client.clientCode}</div>
                        <div className="text-[10px] text-slate-400">
                          {client.ownerLabels.join(", ") || "—"} · {client.accountCount} compte(s)
                        </div>
                      </td>
                      {client.periods.map((cell) => (
                        <td key={cell.period} className="py-2 text-right tabular-nums">
                          <div className={cn("font-medium", TONE_CLASS[cell.tone])}>
                            {formatPct(cell.appPct)}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            Disnat {formatPct(cell.disnatPct)}
                          </div>
                          <div className={cn("text-[10px]", TONE_CLASS[cell.tone])}>
                            {formatGap(cell.gapPts)}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-500">
            Les valeurs de l&apos;app suivent la <strong>méthode officielle Disnat</strong> : TRI
            annualisé sur les mouvements monétaires datés (`docs/`). Le calcul porte sur la{" "}
            <strong>valeur des titres</strong> : l&apos;encaisse n&apos;est pas reconstituée aux
            bornes, d&apos;où un écart résiduel attendu de l&apos;ordre de 1 à 2 points sur les
            périodes courtes (1, 3, 12 mois).
          </p>

          {data.references.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
              {data.references.map((reference) => (
                <span
                  key={reference.id}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                >
                  {reference.clientCode} · {reference.period} · {formatPct(reference.valuePct)}
                  <button
                    type="button"
                    onClick={() => void remove(reference.id)}
                    disabled={busy}
                    aria-label={`Supprimer ${reference.clientCode} ${reference.period}`}
                    className="text-slate-400 hover:text-rose-600 disabled:opacity-40"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <CheckCircle2 className="size-3 text-emerald-500" />
            Vert ≤ 0,5 pt · ambre ≤ 2 pts · rouge au-delà.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

