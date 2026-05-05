"use client";

import { useMemo, useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Upload } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildPortfolioSnapshot,
  parseDisnatCsv,
  validateDisnatInvestmentExportFile,
} from "@/lib/csv/disnat";
import { importFileToParseText } from "@/lib/csv/import-file-text";
import type { ParsedDisnatRow } from "@/types/portfolio";

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

export function ImportsClient({
  initialImports,
}: {
  initialImports: {
    id: string;
    sourceFileName: string;
    importedAt: string;
    rawRowCount: number;
    status: string;
    importType: string;
    notes: string | null;
    _count: { positions: number; accounts: number; transactions: number };
  }[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedDisnatRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [imports, setImports] = useState(initialImports);
  const [disnatGate, setDisnatGate] = useState<
    { ok: true } | { ok: false; message: string } | null
  >(null);
  const [knownAccounts, setKnownAccounts] = useState<KnownAccount[]>([]);
  const [selectedAccountKey, setSelectedAccountKey] = useState<string>("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const form = useForm<ImportForm>({
    resolver: zodResolver(importSchema),
  });

  useEffect(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data: { accounts: KnownAccount[] }) => setKnownAccounts(data.accounts ?? []))
      .catch(() => {});
  }, []);

  const snapshot = useMemo(() => buildPortfolioSnapshot(rows), [rows]);
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
    setMessages([
      ...(gate.ok ? [] : [gate.message]),
      ...parsed.errors.map((error) => `Fichier: ${error.message}`),
      ...buildPortfolioSnapshot(parsed.rows).warnings,
    ]);
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
      if (payload?.txInserted !== undefined) {
        if (payload.txSkipped && payload.txSkipped > 0) {
          msgs.push(`${payload.txInserted} transaction${payload.txInserted > 1 ? "s" : ""} ajoutée${payload.txInserted > 1 ? "s" : ""}, ${payload.txSkipped} doublon${payload.txSkipped > 1 ? "s" : ""} ignoré${payload.txSkipped > 1 ? "s" : ""}.`);
        } else {
          msgs.push(`${payload.txInserted} transaction${payload.txInserted > 1 ? "s" : ""} ajoutée${payload.txInserted > 1 ? "s" : ""}.`);
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
    <div className="space-y-6">
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
            <span>{snapshot.positions.length} positions normalisées</span>
            <span>{snapshot.accounts.length} comptes détectés</span>
            <span>{snapshot.transactions.length} transactions détectées</span>
          </div>

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
          <div className="overflow-auto rounded-lg border border-slate-200">
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
                        {String(row[header] ?? "")}
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

      <Card>
        <CardHeader>
          <CardTitle>Historique des imports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-slate-100">
            {imports.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-slate-950">
                    {item.sourceFileName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(item.importedAt).toLocaleString("fr-CA")} ·{" "}
                    {item.importType.toLowerCase()} · {item.rawRowCount} lignes ·{" "}
                    {item._count.positions} positions ·{" "}
                    {item._count.transactions} transactions
                  </p>
                  {item.notes ? (
                    <p className="mt-0.5 text-xs text-slate-400">{item.notes.split("\n")[0]}</p>
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
            ))}
            {imports.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Aucun import sauvegardé.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
