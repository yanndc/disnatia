"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { TX_CATEGORY_LABELS, TX_CATEGORY_COLORS } from "@/lib/csv/tx-category";
import type { TxCategory } from "@/generated/prisma/enums";
import { TransactionDropzone } from "./transaction-dropzone";

type TxRow = {
  id: string;
  accountKey: string | null;
  accountName: string | null;
  tradeDate: Date | string | null;
  settlementDate: Date | string | null;
  transactionType: string | null;
  txCategory: TxCategory | null;
  ticker: string | null;
  securityName: string | null;
  market: string | null;
  currency: string | null;
  assetClass: string | null;
  quantity: number | null;
  price: number | null;
  amount: number | null;
  fees: number | null;
};

const ALL_CATEGORIES = Object.keys(TX_CATEGORY_LABELS) as TxCategory[];

export function TransactionsClient({
  initialRows,
  total,
  accounts,
  owners,
  initialFilters,
}: {
  initialRows: TxRow[];
  total: number;
  accounts: { accountKey: string; label: string; owner?: string }[];
  owners: string[];
  initialFilters?: { accountKey?: string; owner?: string; txCategory?: string; ticker?: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();

  const [owner, setOwner] = useState(initialFilters?.owner ?? "");
  const [accountKey, setAccountKey] = useState(initialFilters?.accountKey ?? "");
  const [txCategory, setTxCategory] = useState(initialFilters?.txCategory ?? "");
  const [ticker, setTicker] = useState(initialFilters?.ticker ?? "");

  const visibleAccounts = owner ? accounts.filter((a) => a.owner === owner) : accounts;

  function applyFilters(overrides?: { accountKey?: string; owner?: string; txCategory?: string; ticker?: string }) {
    const own = overrides?.owner ?? owner;
    const ak = overrides?.accountKey ?? accountKey;
    const cat = overrides?.txCategory ?? txCategory;
    const tic = overrides?.ticker ?? ticker;
    const params = new URLSearchParams();
    if (own) params.set("owner", own);
    if (ak) params.set("accountKey", ak);
    if (cat) params.set("txCategory", cat);
    if (tic) params.set("ticker", tic);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  function normCurrency(raw?: string | null) {
    if (!raw) return "CAD";
    const up = raw.toUpperCase();
    if (up === "US") return "USD";
    if (up === "CAN") return "CAD";
    return up;
  }

  function fmt(v: number | null, currency?: string | null) {
    if (v === null || v === undefined) return "—";
    return new Intl.NumberFormat("fr-CA", {
      style: "currency",
      currency: normCurrency(currency),
      minimumFractionDigits: 2,
    }).format(v);
  }

  function fmtDate(v: Date | string | null) {
    if (!v) return "—";
    return new Date(v).toLocaleDateString("fr-CA");
  }

  return (
    <div>
      {/* Zone de drop */}
      <div className="px-4 pt-4 pb-2">
        <TransactionDropzone accounts={accounts} />
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 border-b border-slate-100 px-4 py-3">
        {owners.length > 1 && (
          <select
            className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setAccountKey("");
              applyFilters({ owner: e.target.value, accountKey: "" });
            }}
          >
            <option value="">Tous les portefeuilles</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}

        <select
          className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
          value={accountKey}
          onChange={(e) => {
            setAccountKey(e.target.value);
            applyFilters({ accountKey: e.target.value });
          }}
        >
          <option value="">{owner ? "Tous ses comptes" : "Tous les comptes"}</option>
          {visibleAccounts.map((a) => (
            <option key={a.accountKey} value={a.accountKey}>
              {a.label}
            </option>
          ))}
        </select>

        <select
          className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
          value={txCategory}
          onChange={(e) => {
            setTxCategory(e.target.value);
            applyFilters({ txCategory: e.target.value });
          }}
        >
          <option value="">Toutes les catégories</option>
          {ALL_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {TX_CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Ticker…"
          className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 w-24"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyFilters()}
        />

        <button
          onClick={() => applyFilters()}
          className="rounded bg-slate-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          Filtrer
        </button>

        {(owner || accountKey || txCategory || ticker) && (
          <button
            onClick={() => {
              setOwner("");
              setAccountKey("");
              setTxCategory("");
              setTicker("");
              applyFilters({ owner: "", accountKey: "", txCategory: "", ticker: "" });
            }}
            className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
          >
            Effacer
          </button>
        )}

        <span className="ml-auto self-center text-xs text-slate-400">
          {total} ligne{total > 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Date règl.</th>
              <th className="px-3 py-2">Catégorie</th>
              <th className="px-3 py-2">Type brut</th>
              <th className="px-3 py-2">Ticker</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Qté</th>
              <th className="px-3 py-2 text-right">Prix</th>
              <th className="px-3 py-2 text-right">Montant</th>
              <th className="px-3 py-2">Devise</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {initialRows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(row.settlementDate ?? row.tradeDate)}</td>
                <td className="px-3 py-2">
                  {row.txCategory ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${TX_CATEGORY_COLORS[row.txCategory]}`}
                    >
                      {TX_CATEGORY_LABELS[row.txCategory]}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{row.transactionType ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs font-medium text-slate-800">
                  {row.ticker ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 max-w-[220px] truncate">
                  {row.securityName ?? "—"}
                </td>
                <td className="px-3 py-2 text-right text-xs text-slate-600">
                  {row.quantity !== null ? row.quantity : "—"}
                </td>
                <td className="px-3 py-2 text-right text-xs text-slate-600">
                  {row.price !== null ? fmt(row.price, row.currency) : "—"}
                </td>
                <td
                  className={`px-3 py-2 text-right text-xs font-medium ${
                    (row.amount ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {fmt(row.amount, row.currency)}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{row.currency ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {initialRows.length === 0 && (
          <p className="p-8 text-center text-sm text-slate-400">
            Aucune transaction trouvée pour ces filtres.
          </p>
        )}
      </div>
    </div>
  );
}
