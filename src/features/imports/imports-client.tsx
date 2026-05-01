"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Upload } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseDisnatCsv, buildPortfolioSnapshot } from "@/lib/csv/disnat";
import type { ParsedDisnatRow } from "@/types/portfolio";

const importSchema = z.object({
  file: z.instanceof(File, { message: "Sélectionne un fichier CSV." }),
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
    notes: string | null;
    _count: { positions: number; accounts: number };
  }[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedDisnatRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [imports, setImports] = useState(initialImports);
  const form = useForm<ImportForm>({
    resolver: zodResolver(importSchema),
  });

  const snapshot = useMemo(() => buildPortfolioSnapshot(rows), [rows]);
  const canSave = file && (snapshot.positions.length > 0 || snapshot.accounts.length > 0);

  async function handleFile(selectedFile: File | null) {
    setFile(selectedFile);
    setRows([]);
    setHeaders([]);
    setMessages([]);

    if (!selectedFile) {
      return;
    }

    form.setValue("file", selectedFile, { shouldValidate: true });
    const text = await selectedFile.text();
    const parsed = parseDisnatCsv(text);
    setRows(parsed.rows);
    setHeaders(parsed.headers);
    setMessages([
      ...parsed.errors.map((error) => `CSV: ${error.message}`),
      ...buildPortfolioSnapshot(parsed.rows).warnings,
    ]);
  }

  async function saveImport() {
    const valid = await form.trigger();
    if (!valid || !file) {
      return;
    }

    setIsSaving(true);
    setMessages([]);

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/imports", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    setIsSaving(false);

    if (!response.ok) {
      setMessages([payload.error ?? "Import impossible.", ...(payload.details ?? [])]);
      return;
    }

    setMessages(["Import sauvegardé et portefeuille recalculé."]);
    const historyResponse = await fetch("/api/imports");
    const historyPayload = await historyResponse.json();
    setImports(historyPayload.imports ?? []);
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm text-slate-500">Import CSV Disnat</p>
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
              Dépose un CSV ici ou clique pour sélectionner
            </span>
            <span className="mt-1 text-xs text-slate-500">
              {file ? file.name : "Format .csv exporté depuis Disnat"}
            </span>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
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
            <span>{snapshot.positions.length} positions normalisées</span>
            <span>{snapshot.accounts.length} comptes détectés</span>
          </div>

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
                    {item.rawRowCount} lignes · {item._count.positions} positions
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                  {item.status}
                </span>
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
