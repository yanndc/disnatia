"use client";

import { useMemo, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildPortfolioSnapshot,
  disnatPreviewCellDisplay,
  parseDisnatCsv,
  validateDisnatInvestmentExportFile,
} from "@/lib/csv/disnat";
import { importFileToParseText } from "@/lib/csv/import-file-text";
import type { ParsedDisnatRow } from "@/types/portfolio";
import {
  ExternalAccountsPanel,
  type ExternalAccountDto,
} from "@/features/imports/external-accounts-panel";
import {
  NonFinancialAssetsPanel,
  type NonFinancialAssetDto,
} from "@/features/imports/non-financial-assets-panel";
import { PerformanceIndicatorCard } from "@/features/portfolio/performance-indicator-card";
import type { PerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-types";
import { cn } from "@/lib/utils";

type KnownAccount = {
  accountKey: string;
  accountName: string;
  accountNumber: string | null;
  accountType: string | null;
  currency: string;
  totalValue: number;
};

const importSchema = z.object({
  file: z.instanceof(File, {
    message: "Sélectionne un fichier CSV ou Excel (.csv, .xlsx).",
  }),
});

type ImportForm = z.infer<typeof importSchema>;

type ImportsTab = "external" | "assets" | "disnat" | "reconciliation" | "followup";

/** Plage d’années civiles couverte par les dates d’opération du fichier (min / max). L’horodatage d’import est affiché à part, sans répéter son année ici. */
function dataYearsInFileLabel(dataFromIso: string | null, dataToIso: string | null): string {
  if (!dataFromIso && !dataToIso) {
    return "—";
  }
  const yFrom = dataFromIso ? new Date(dataFromIso).getFullYear() : null;
  const yTo = dataToIso ? new Date(dataToIso).getFullYear() : null;
  if (yFrom !== null && yTo !== null) {
    return yFrom === yTo ? `${yFrom}` : `${yFrom}–${yTo}`;
  }
  if (yFrom !== null) {
    return `≥${yFrom}`;
  }
  return `≤${yTo}`;
}

export function ImportsClient({
  initialTab,
  initialReconciliationPayload,
  initialImports,
  initialExternalAccounts,
  initialNonFinancialAssets,
}: {
  initialTab?: ImportsTab;
  initialReconciliationPayload: PerformanceIndicatorPayload | null;
  initialImports: {
    id: string;
    sourceFileName: string;
    sourceFileKept: boolean;
    importedAt: string;
    dataFromDate: string | null;
    dataToDate: string | null;
    rawRowCount: number;
    status: string;
    importType: string;
    notes: string | null;
    _count: { positions: number; accounts: number; transactions: number };
    linkedAccountKeys: string[];
  }[];
  initialExternalAccounts: ExternalAccountDto[];
  initialNonFinancialAssets: NonFinancialAssetDto[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedDisnatRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [imports, setImports] = useState(initialImports);
  const [historyAccountKey, setHistoryAccountKey] = useState("");
  const [disnatGate, setDisnatGate] = useState<
    { ok: true } | { ok: false; message: string } | null
  >(null);
  const [knownAccounts, setKnownAccounts] = useState<KnownAccount[]>([]);
  const [selectedAccountKey, setSelectedAccountKey] = useState<string>("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyResult, setHistoryResult] = useState<string | null>(null);
  const [ownerMap, setOwnerMap] = useState<Map<string, string>>(() => new Map());
  const [tab, setTab] = useState<ImportsTab>(initialTab ?? "disnat");
  const form = useForm<ImportForm>({
    resolver: zodResolver(importSchema),
  });

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data: { accounts: KnownAccount[] }) => setKnownAccounts(data.accounts ?? []))
      .catch(() => {});
  }, []);

  const snapshot = useMemo(
    () => buildPortfolioSnapshot(rows, ownerMap),
    [rows, ownerMap],
  );

  const importHistoryRows = useMemo(() => {
    if (!historyAccountKey) return imports;
    return imports.filter((i) => (i.linkedAccountKeys ?? []).includes(historyAccountKey));
  }, [imports, historyAccountKey]);
  const isTransactionsFile =
    snapshot.importKind === "TRANSACTIONS" || snapshot.transactions.length > 0;
  const needsAccountSelection = isTransactionsFile;
  const canSave =
    !!file &&
    disnatGate?.ok === true &&
    (!needsAccountSelection || !!selectedAccountKey) &&
    (snapshot.positions.length > 0 ||
      snapshot.accounts.length > 0 ||
      snapshot.transactions.length > 0);

  async function handleFile(selectedFile: File | null) {
    setFile(selectedFile);
    setRows([]);
    setHeaders([]);
    setMessages([]);
    setDisnatGate(null);
    setSelectedAccountKey("");
    setOwnerMap(new Map());

    if (!selectedFile) {
      return;
    }

    form.setValue("file", selectedFile, { shouldValidate: true });

    let text: string;
    try {
      text = await importFileToParseText(selectedFile);
    } catch (cause) {
      const msg =
        cause instanceof Error ? cause.message : "Impossible de lire le fichier.";
      setDisnatGate({ ok: false, message: msg });
      setMessages([msg]);
      return;
    }

    const parsed = parseDisnatCsv(text);
    const gate = validateDisnatInvestmentExportFile({
      rawText: text,
      headers: parsed.headers,
      importKind: parsed.importKind,
    });
    setDisnatGate(gate);
    setRows(parsed.rows);
    setHeaders(parsed.headers);
    setOwnerMap(parsed.ownerMap);
    setMessages([
      ...(gate.ok ? [] : [gate.message]),
      ...parsed.errors.map((error) => `Fichier: ${error.message}`),
      ...buildPortfolioSnapshot(parsed.rows, parsed.ownerMap).warnings,
    ]);
  }

  async function runBackfillHoldings() {
    setBackfillBusy(true);
    setBackfillResult(null);
    try {
      const response = await fetch("/api/portfolio/backfill-holdings", { method: "POST" });
      type BackfillJson = { message?: string; error?: string };
      let payload: BackfillJson = {};
      try {
        payload = (await response.json()) as BackfillJson;
      } catch {
        payload = {};
      }
      if (!response.ok) {
        setBackfillResult(payload.error ?? `Échec (${response.status}).`);
        return;
      }
      setBackfillResult(payload.message ?? "Recalcul terminé.");
    } catch (cause) {
      setBackfillResult(
        cause instanceof Error ? cause.message : "Erreur réseau.",
      );
    } finally {
      setBackfillBusy(false);
    }
  }

  async function runBackfillMarketHistory() {
    setHistoryBusy(true);
    setHistoryResult(null);
    try {
      const response = await fetch("/api/portfolio/backfill-market-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          force: true,
          recomputeDailyValues: true,
          recomputeSessionGains: true,
        }),
      });
      type HistoryJson = {
        summary?: string;
        message?: string;
        ok?: boolean;
        integrityOk?: boolean;
        tickersProcessed?: number;
        tickersSkipped?: number;
        pricesUpserted?: number;
        dailyValuesUpserted?: number;
        sessionGainsUpserted?: number;
        integrity?: {
          expectedSessionDate?: string;
          issues?: string[];
        };
      };
      let payload: HistoryJson = {};
      try {
        payload = (await response.json()) as HistoryJson;
      } catch {
        payload = {};
      }
      if (!response.ok) {
        setHistoryResult(
          payload.summary ??
            payload.message ??
            `Échec HTTP (${response.status}).`,
        );
        return;
      }
      setHistoryResult(
        payload.summary ??
          payload.message ??
          `${payload.tickersProcessed ?? 0} titre(s), ${payload.pricesUpserted ?? 0} clôtures, ${payload.dailyValuesUpserted ?? 0} valeurs jour.`,
      );
    } catch (cause) {
      setHistoryResult(
        cause instanceof Error ? cause.message : "Erreur réseau.",
      );
    } finally {
      setHistoryBusy(false);
    }
  }

  async function deleteImport(id: string) {
    setDeletingId(id);
    try {
      await fetch(`/api/imports/${id}`, { method: "DELETE" });
      setImports((prev) => prev.filter((item) => item.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  async function saveImport() {
    const valid = await form.trigger();
    if (!valid || !file) {
      return;
    }

    setIsSaving(true);
    setMessages([]);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (selectedAccountKey) {
        formData.append("accountKey", selectedAccountKey);
        const acc = knownAccounts.find((a) => a.accountKey === selectedAccountKey);
        if (acc) {
          const label = [acc.accountType, acc.accountNumber, acc.currency]
            .filter(Boolean)
            .join(" · ");
          formData.append("accountLabel", label);
        }
      }

      const response = await fetch("/api/imports", {
        method: "POST",
        body: formData,
      });
      type ImportResponsePayload = {
        error?: string;
        details?: unknown;
        txInserted?: number;
        txSkipped?: number;
      };
      let payload: ImportResponsePayload | null = null;

      try {
        payload = (await response.json()) as ImportResponsePayload;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const detailsArray = Array.isArray(payload?.details)
          ? (payload?.details as string[])
          : [];
        const errorText =
          !payload?.error && !response.ok
            ? response.status >= 500
              ? `Erreur serveur (${response.status}). Regénère Prisma puis redémarre le serveur (pnpm prisma:generate, puis nouveau pnpm dev).`
              : `Import impossible (${response.status}).`
            : undefined;
        setMessages([
          payload?.error ?? errorText ?? "Import impossible.",
          ...detailsArray,
        ]);
        return;
      }

      const msgs = ["Import sauvegardé."];
      const txMode =
        snapshot.importKind === "TRANSACTIONS" || snapshot.transactions.length > 0;
      if (txMode && payload?.txInserted !== undefined) {
        if (payload.txSkipped && payload.txSkipped > 0) {
          msgs.push(`${payload.txInserted} transaction${payload.txInserted > 1 ? "s" : ""} ajoutée${payload.txInserted > 1 ? "s" : ""}, ${payload.txSkipped} doublon${payload.txSkipped > 1 ? "s" : ""} ignoré${payload.txSkipped > 1 ? "s" : ""}.`);
        } else {
          msgs.push(`${payload.txInserted} transaction${payload.txInserted > 1 ? "s" : ""} ajoutée${payload.txInserted > 1 ? "s" : ""}.`);
        }
      }
      if (!txMode || snapshot.positions.length > 0 || snapshot.accounts.length > 0) {
        if (snapshot.positions.length > 0) {
          msgs.push(
            `${snapshot.positions.length} position${snapshot.positions.length > 1 ? "s" : ""} enregistrée${snapshot.positions.length > 1 ? "s" : ""}.`,
          );
        }
        if (snapshot.accounts.length > 0 && snapshot.positions.length === 0) {
          msgs.push(
            `${snapshot.accounts.length} solde${snapshot.accounts.length > 1 ? "s" : ""} de compte enregistré${snapshot.accounts.length > 1 ? "s" : ""} (export synthèse).`,
          );
        }
        if (snapshot.accounts.length > 0 && snapshot.positions.length > 0) {
          msgs.push(
            `${snapshot.accounts.length} ligne${snapshot.accounts.length > 1 ? "s" : ""} de compte / encaisse synchronisée${snapshot.accounts.length > 1 ? "s" : ""}.`,
          );
        }
        if (snapshot.accounts.length > 0) {
          msgs.push(
            "Réconciliation : encaisse et totaux de ce fichier font foi pour comparer à Disnat (non recalculés depuis les opérations).",
          );
        }
      }
      setMessages(msgs);
      const historyResponse = await fetch("/api/imports");
      const historyPayload = await historyResponse.json();
      setImports(historyPayload.imports ?? []);
    } catch (cause) {
      setMessages([
        cause instanceof Error
          ? cause.message
          : "Erreur réseau lors de la sauvegarde.",
      ]);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {(
          [
            { id: "external" as const, label: "Comptes hors Disnat" },
            { id: "assets" as const, label: "Actifs non-boursiers" },
            { id: "disnat" as const, label: "Fichier Disnat" },
            { id: "reconciliation" as const, label: "Réconciliation" },
            { id: "followup" as const, label: "Historique et recalcul" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-slate-950 text-white"
                : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "external" ? (
        <ExternalAccountsPanel initialAccounts={initialExternalAccounts} />
      ) : null}

      {tab === "assets" ? (
        <NonFinancialAssetsPanel initialAssets={initialNonFinancialAssets} />
      ) : null}

      {tab === "disnat" ? (
        <>
      <section>
        <p className="text-sm text-slate-500">Import Disnat (CSV ou Excel)</p>
        <h2 className="text-2xl font-semibold text-slate-950">Imports</h2>
        <p className="mt-1 text-sm text-slate-500">
          Le mapping accepte plusieurs variantes de colonnes Disnat et signale les
          lignes ambiguës.
        </p>
      </section>

      <Card>
        <CardContent className="p-5">
          <label
            htmlFor="csv-file"
            className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center hover:bg-slate-100"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void handleFile(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <Upload className="size-8 text-slate-500" />
            <span className="mt-3 text-sm font-medium text-slate-950">
              Dépose un fichier ici ou clique pour sélectionner
            </span>
            <span className="mt-1 text-xs text-slate-500">
              {file
                ? file.name
                : ".csv ou .xlsx exporté depuis Disnat (1re feuille pour Excel)"}
            </span>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="sr-only"
              onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
            />
          </label>

          {form.formState.errors.file ? (
            <p className="mt-3 text-sm text-red-600">
              {form.formState.errors.file.message}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
            <span>{headers.length} colonnes détectées</span>
            <span>{rows.length} lignes lues</span>
            <span>type: {snapshot.importKind.toLowerCase()}</span>
            {snapshot.importKind === "PORTFOLIO" ? (
              <span>
                {snapshot.accounts.length} ligne{snapshot.accounts.length > 1 ? "s" : ""} de solde
                (encaisse + titres par compte, sans symboles)
              </span>
            ) : (
              <>
                <span>{snapshot.positions.length} positions normalisées</span>
                <span>{snapshot.accounts.length} comptes détectés</span>
              </>
            )}
            <span>{snapshot.transactions.length} transactions détectées</span>
          </div>
          {snapshot.importKind === "PORTFOLIO" ? (
            <p className="mt-2 text-xs text-slate-500">
              Ce fichier est une vue synthèse Disnat (encaisse + valeur des titres par compte). Les
              positions ligne à ligne viennent d&apos;un export « détail des titres » (symboles et
              qtés).
            </p>
          ) : null}

          {needsAccountSelection && disnatGate?.ok === true ? (
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Compte Disnat associé à ce fichier
              </label>
              {knownAccounts.length === 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  Aucun compte connu. Importez d&apos;abord un fichier portefeuille pour identifier vos
                  comptes.
                </p>
              ) : (
                <select
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                  value={selectedAccountKey}
                  onChange={(e) => setSelectedAccountKey(e.target.value)}
                >
                  <option value="">— Sélectionner un compte —</option>
                  {knownAccounts.map((acc) => {
                    const label = [acc.accountType, acc.accountNumber, acc.currency]
                      .filter(Boolean)
                      .join(" · ");
                    const display = label || acc.accountName;
                    return (
                      <option key={acc.accountKey} value={acc.accountKey}>
                        {display}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>
          ) : null}

          {messages.length > 0 ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
              {messages.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          ) : null}

          <Button className="mt-5" disabled={!canSave || isSaving} onClick={saveImport}>
            {isSaving ? "Sauvegarde..." : "Valider et sauvegarder l'import"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview des 20 premières lignes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[min(55vh,520px)] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {headers.map((header) => (
                    <th key={header} className="px-3 py-2 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 20).map((row, index) => (
                  <tr key={index}>
                    {headers.map((header) => (
                      <td key={header} className="px-3 py-2 text-slate-700">
                        {disnatPreviewCellDisplay(row, header)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-slate-500">
                Aucun fichier sélectionné.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
        </>
      ) : null}

      {tab === "followup" ? (
        <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historique de marché (performance)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            Télécharge les clôtures Yahoo pour chaque titre sur toute sa période de détention
            (plusieurs années) et recalcule les valeurs journalières du portefeuille. À lancer après
            le recalcul portefeuille ou lors d&apos;un nouvel import d&apos;historique.
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={historyBusy}
            onClick={() => void runBackfillMarketHistory()}
            className="gap-2"
          >
            <RefreshCw className={`size-4 ${historyBusy ? "animate-spin" : ""}`} />
            {historyBusy ? "Backfill historique…" : "Backfill historique de marché"}
          </Button>
          {historyResult ? (
            <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
              {historyResult}
            </pre>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recalcul portefeuille</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            Resynchronise les totaux / encaisse des comptes à partir des imports portefeuille déjà
            enregistrés, puis rejoue la projection des titres à partir de l&apos;historique de
            transactions. Opération idempotente, utile après un changement de logique ou pour corriger
            des symboles hérités.
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={backfillBusy}
            onClick={() => void runBackfillHoldings()}
            className="gap-2"
          >
            <RefreshCw className={`size-4 ${backfillBusy ? "animate-spin" : ""}`} />
            {backfillBusy ? "Recalcul…" : "Lancer le recalcul (backfill)"}
          </Button>
          {backfillResult ? (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
              {backfillResult}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historique des imports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 pb-3 pt-1">
            <span className="text-xs text-slate-500">Filtrer</span>
            <select
              aria-label="Filtrer l’historique par compte"
              className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
              value={historyAccountKey}
              onChange={(e) => setHistoryAccountKey(e.target.value)}
            >
              <option value="">Tous les comptes</option>
              {knownAccounts.map((a) => {
                const label =
                  [a.accountType, a.accountNumber, a.currency].filter(Boolean).join(" · ") ||
                  a.accountName;
                return (
                  <option key={a.accountKey} value={a.accountKey}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="divide-y divide-slate-100">
            {importHistoryRows.map((item) => {
              const dataYearsLabel = dataYearsInFileLabel(item.dataFromDate, item.dataToDate);
              return (
              <div key={item.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-slate-950">
                    {item.sourceFileName}
                  </p>
                  <p className="text-xs text-slate-500">
                    Import : {new Date(item.importedAt).toLocaleString("fr-CA")} · Fichier :{" "}
                    {dataYearsLabel} · {item.importType.toLowerCase()} · {item.rawRowCount} lignes ·{" "}
                    {item._count.positions} positions · {item._count.transactions} transactions
                  </p>
                  {item.notes ? (
                    <p className="mt-0.5 text-xs text-slate-400">{item.notes.split("\n")[0]}</p>
                  ) : null}
                  {item.sourceFileKept ? (
                    <p className="mt-0.5 text-xs text-slate-400">
                      Fichier source conservé en base (même base local / prod).
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                    {item.status}
                  </span>
                  <button
                    onClick={() => void deleteImport(item.id)}
                    disabled={deletingId === item.id}
                    className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40"
                    title="Supprimer cet import"
                  >
                    {deletingId === item.id ? "…" : "Supprimer"}
                  </button>
                </div>
              </div>
            );
            })}
            {imports.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Aucun import sauvegardé.
              </p>
            ) : importHistoryRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Aucun import pour ce compte.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
        </>
      ) : null}

      {tab === "reconciliation" ? (
        <>
          <section className="overflow-hidden rounded-4xl border border-slate-200 bg-white text-slate-950 shadow-sm">
            <div className="relative isolate p-6 sm:p-8">
              <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.08),transparent_34%),radial-gradient(circle_at_85%_10%,rgba(15,118,110,0.06),transparent_30%)]" />
              <div className="flex items-start gap-3">
                <div className="mt-1 flex size-10 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
                  <ShieldCheck className="size-5" />
                </div>
                <div>
                  <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                    Réconciliation Disnat
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm text-slate-500">
                    Détails de conciliation entre les calculs de l&apos;application et la référence
                    Disnat: écarts par date de rapport, couverture des comptes et aide au diagnostic.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {initialReconciliationPayload ? (
            <PerformanceIndicatorCard
              payload={initialReconciliationPayload}
              showReconciliationDetails
            />
          ) : (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base text-slate-800">Données indisponibles</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500">
                  Impossible de charger les données de réconciliation pour le moment.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
