"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { EnrichedPosition } from "@/features/portfolio/live-enrichment";
import { TX_CATEGORY_LABELS } from "@/lib/csv/tx-category";
import type { TxCategory } from "@/generated/prisma/enums";

type ApiRow = {
  id: string;
  tradeDate: string | null;
  settlementDate: string | null;
  transactionType: string | null;
  txCategory: TxCategory | null;
  ticker: string | null;
  securityName: string | null;
  market: string | null;
  currency: string | null;
  priceDevise: string | null;
  assetClass: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  fees: number | null;
};

function normCurrency(raw?: string | null) {
  if (!raw) return "CAD";
  const up = raw.toUpperCase();
  if (up === "US") return "USD";
  if (up === "CAN") return "CAD";
  return up;
}

function fmtMoney(v: number | null | undefined, currency?: string | null) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: normCurrency(currency),
    minimumFractionDigits: 2,
  }).format(v);
}

function fmtDate(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("fr-CA");
}

function fmtQty(v: number | null) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 6 }).format(v);
}

export function PositionTransactionsModal({
  position,
  open,
  onClose,
}: {
  position: EnrichedPosition | null;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [rows, setRows] = useState<ApiRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open) {
      if (!d.open) d.showModal();
    } else if (d.open) {
      d.close();
    }
  }, [open]);

  const load = useCallback(async () => {
    if (!position || !position.accountKey) return;
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const params = new URLSearchParams({
        accountKey: position.accountKey,
        ticker: position.ticker,
        currency: position.currency,
      });
      const res = await fetch(`/api/portfolio/position-transactions?${params}`);
      const data = (await res.json()) as { rows?: ApiRow[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Échec du chargement");
        return;
      }
      setRows(data.rows ?? []);
    } catch {
      setError("Réseau ou serveur indisponible");
    } finally {
      setLoading(false);
    }
  }, [position]);

  useEffect(() => {
    if (open && position) void load();
  }, [open, position, load]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    const syncParent = () => onClose();
    d.addEventListener("close", syncParent);
    return () => d.removeEventListener("close", syncParent);
  }, [onClose]);

  if (!position) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(1000px,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-0 shadow-xl outline-none backdrop:bg-slate-900/40"
    >
      <div className="flex max-h-[85vh] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-slate-950">
              Opérations · {position.ticker}
            </h2>
            <p className="mt-0.5 max-w-xl text-xs text-slate-600 line-clamp-2">
              {position.securityName || "—"} · {position.accountName}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Lignes importées reliées à cette position (même agrégation que le calcul des quantités).
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="ghost" className="h-8 px-2 text-xs" onClick={() => void load()}>
              Actualiser
            </Button>
            <Button type="button" variant="secondary" className="h-8 px-2 text-xs" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : rows && rows.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune opération trouvée pour cette ligne.</p>
          ) : rows ? (
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="sticky top-0 bg-white text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2 font-medium">Date règl.</th>
                  <th className="px-2 py-2 font-medium">Type</th>
                  <th className="px-2 py-2 font-medium">Cat.</th>
                  <th className="px-2 py-2 font-medium">Symbole</th>
                  <th className="px-2 py-2 font-medium">Qté</th>
                  <th className="px-2 py-2 font-medium">Prix</th>
                  <th className="px-2 py-2 font-medium">Montant</th>
                  <th className="px-2 py-2 font-medium">Frais</th>
                  <th className="px-2 py-2 font-medium">Classe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const catLabel = r.txCategory ? TX_CATEGORY_LABELS[r.txCategory] ?? r.txCategory : "—";
                  const cur = r.currency ?? position.currency;
                  return (
                    <tr key={r.id} className="text-slate-800">
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-600">
                        {fmtDate(r.settlementDate ?? r.tradeDate)}
                      </td>
                      <td className="max-w-[140px] px-2 py-2 text-slate-700">
                        <span className="line-clamp-2" title={r.transactionType ?? ""}>
                          {r.transactionType ?? "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-slate-600">{catLabel}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-medium">{r.ticker ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{fmtQty(r.quantity)}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{fmtMoney(r.price, cur)}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{fmtMoney(r.amount, cur)}</td>
                      <td className="whitespace-nowrap px-2 py-2 tabular-nums">{fmtMoney(r.fees, cur)}</td>
                      <td className="max-w-[100px] px-2 py-2 text-slate-600">{r.assetClass ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
