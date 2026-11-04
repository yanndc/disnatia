"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardPaste, FileText, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  parseDisnatHistoryHtml,
  type DisnatHtmlAccount,
  type DisnatHtmlParseResult,
} from "@/lib/csv/disnat-html";

type AccountImportResult = {
  label: string;
  status: "ok" | "duplicate" | "error";
  detail: string;
};

const MAX_HTML_CHARS = 8_000_000;

/** Import depuis la page Disnat sauvegardée (un bloc par compte, compte lu dans le HTML). */
export function DisnatHtmlPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<DisnatHtmlParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<AccountImportResult[]>([]);

  const analyze = useCallback((html: string) => {
    setText(html);
    setResults([]);
    setParsed(html.trim().length > 0 ? parseDisnatHistoryHtml(html) : null);
  }, []);

  async function onFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const content = await file.text();
      analyze(content);
    } finally {
      setBusy(false);
    }
  }

  async function importAll(accounts: DisnatHtmlAccount[]) {
    setImporting(true);
    setResults([]);
    const collected: AccountImportResult[] = [];
    for (const account of accounts) {
      const formData = new FormData();
      formData.append(
        "file",
        new File([account.csv], `${account.accountNumber}_${account.currency}.csv`, {
          type: "text/csv",
        }),
      );
      formData.append("accountKey", account.accountKey);
      formData.append("accountLabel", account.label);
      try {
        const response = await fetch("/api/imports", { method: "POST", body: formData });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          txInserted?: number;
          txSkipped?: number;
        };
        if (response.ok) {
          collected.push({
            label: account.label,
            status: "ok",
            detail: `${payload.txInserted ?? 0} ajoutée(s)${
              payload.txSkipped ? `, ${payload.txSkipped} doublon(s) ignoré(s)` : ""
            }`,
          });
        } else if (response.status === 409) {
          collected.push({
            label: account.label,
            status: "duplicate",
            detail: payload.error ?? "Déjà importé",
          });
        } else {
          collected.push({
            label: account.label,
            status: "error",
            detail: payload.error ?? `Erreur ${response.status}`,
          });
        }
      } catch {
        collected.push({ label: account.label, status: "error", detail: "Erreur réseau" });
      }
      setResults([...collected]);
    }
    setImporting(false);
    router.refresh();
  }

  const accounts = parsed?.accounts ?? [];
  const overLimit = text.length > MAX_HTML_CHARS;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Importer la page Disnat (un bloc par compte)</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Dans Disnat : <strong>Détail du compte → Vue d&apos;ensemble → Historique</strong>, choisis
            la période, puis <strong>Ctrl+S → « Page web, HTML seul »</strong>. Dépose le fichier
            ci-dessous (ou colle son contenu). Le numéro de compte est lu dans chaque bloc, donc
            aucune attribution à faire.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void onFiles(event.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className="flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500 hover:border-slate-300 hover:bg-slate-100"
          >
            <input
              ref={inputRef}
              type="file"
              accept=".html,.htm,.txt"
              className="hidden"
              onChange={(event) => void onFiles(event.target.files)}
            />
            {busy ? (
              <Loader2 className="size-4 animate-spin text-slate-400" />
            ) : (
              <Upload className="size-4 text-slate-400" />
            )}
            <span>
              Déposer la page sauvegardée <span className="text-slate-400">(.html / .txt)</span>
            </span>
          </div>

          <textarea
            value={text.length > 20_000 ? "" : text}
            onChange={(event) => {
              const value = event.target.value;
              setText(value);
              // Évite d'analyser un HTML de plusieurs Mo à chaque frappe.
              if (value.length > 200_000) {
                setParsed(null);
                return;
              }
              analyze(value);
            }}
            placeholder="…ou colle ici le contenu de la page (Ctrl+A / Ctrl+C dans le fichier sauvegardé)"
            className="h-24 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-600 outline-none focus:border-slate-400"
            aria-label="Contenu HTML de la page Disnat"
          />
          {text.length > 20_000 ? (
            <p className="text-[11px] text-slate-400">
              {Math.round(text.length / 1024)} Ko lus depuis le fichier.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="gap-1.5 text-xs"
            >
              <FileText className="size-3.5" />
              Choisir un fichier
            </Button>
            <Button
              variant="secondary"
              onClick={() => analyze(text)}
              disabled={!text.trim() || overLimit}
              className="gap-1.5 text-xs"
            >
              <ClipboardPaste className="size-3.5" />
              Analyser le texte collé
            </Button>
            {parsed?.ok && accounts.length > 0 ? (
              <Button
                onClick={() => void importAll(accounts)}
                disabled={importing}
                className="gap-1.5 text-xs"
              >
                {importing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                Importer {accounts.length} compte(s) · {parsed.rowsTotal} transaction(s)
              </Button>
            ) : null}
          </div>

          {parsed && !parsed.ok && parsed.error ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{parsed.error}</p>
          ) : null}
        </CardContent>
      </Card>

      {parsed?.ok ? (
        <Card>
          <CardHeader>
            <CardTitle>Comptes détectés</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="pb-2">Compte</th>
                    <th className="pb-2">Période</th>
                    <th className="pb-2">Transactions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accounts.map((account) => (
                    <tr key={account.accountKey}>
                      <td className="py-2">
                        <div className="font-medium text-slate-800">{account.accountType}</div>
                        <div className="font-mono text-[10px] text-slate-400">
                          {account.accountNumber} · {account.currency}
                        </div>
                      </td>
                      <td className="py-2 tabular-nums text-slate-600">
                        {account.fromDate ?? "—"} → {account.toDate ?? "—"}
                      </td>
                      <td className="py-2 tabular-nums text-slate-700">{account.rows.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {parsed.skipped.length > 0 ? (
              <p className="text-[11px] text-slate-400">
                Ignoré :{" "}
                {parsed.skipped.map((item) => `${item.title} (${item.reason})`).join(" · ")}
              </p>
            ) : null}

            {results.length > 0 ? (
              <ul className="space-y-1 text-xs">
                {results.map((result) => (
                  <li key={result.label} className="flex flex-wrap items-center gap-2">
                    {result.status === "ok" ? (
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                    ) : null}
                    <span className="font-medium text-slate-700">{result.label}</span>
                    <span
                      className={
                        result.status === "error"
                          ? "text-rose-600"
                          : result.status === "duplicate"
                            ? "text-amber-700"
                            : "text-slate-500"
                      }
                    >
                      {result.detail}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
