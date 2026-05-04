"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  buildPortfolioSnapshot,
  parseDisnatCsv,
  validateDisnatInvestmentExportFile,
} from "@/lib/csv/disnat";
import { importFileToParseText } from "@/lib/csv/import-file-text";

type Account = { accountKey: string; label: string; owner?: string };

type State =
  | { phase: "idle" }
  | { phase: "dragging" }
  | { phase: "validating" }
  | { phase: "needs_account"; file: File; error?: string }
  | { phase: "saving"; file: File; accountKey: string }
  | { phase: "done"; inserted: number; skipped: number }
  | { phase: "error"; message: string };

export function TransactionDropzone({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ phase: "idle" });
  const [selectedAccount, setSelectedAccount] = useState("");

  const reset = useCallback(() => {
    setState({ phase: "idle" });
    setSelectedAccount("");
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  async function processFile(file: File) {
    setState({ phase: "validating" });
    try {
      const text = await importFileToParseText(file);
      const parsed = parseDisnatCsv(text);
      const gate = validateDisnatInvestmentExportFile({
        rawText: text,
        headers: parsed.headers,
        importKind: parsed.importKind,
      });
      if (!gate.ok) {
        setState({ phase: "error", message: gate.message });
        return;
      }
      const snap = buildPortfolioSnapshot(parsed.rows);
      if (snap.importKind !== "TRANSACTIONS" && snap.transactions.length === 0) {
        setState({ phase: "error", message: "Ce fichier ne contient pas de transactions." });
        return;
      }
      setState({ phase: "needs_account", file });
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : "Erreur de lecture." });
    }
  }

  async function save() {
    if (state.phase !== "needs_account" || !selectedAccount) return;
    const { file } = state;
    setState({ phase: "saving", file, accountKey: selectedAccount });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("accountKey", selectedAccount);
    const acc = accounts.find((a) => a.accountKey === selectedAccount);
    if (acc) formData.append("accountLabel", acc.label);

    try {
      const res = await fetch("/api/imports", { method: "POST", body: formData });
      const payload = await res.json().catch(() => ({})) as {
        error?: string;
        txInserted?: number;
        txSkipped?: number;
      };
      if (!res.ok) {
        setState({ phase: "needs_account", file, error: payload.error ?? `Erreur ${res.status}` });
        return;
      }
      setState({ phase: "done", inserted: payload.txInserted ?? 0, skipped: payload.txSkipped ?? 0 });
      router.refresh();
    } catch {
      setState({ phase: "needs_account", file, error: "Erreur réseau." });
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setState({ phase: "idle" });
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  if (state.phase === "done") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        <span className="text-emerald-800">
          {state.inserted} transaction{state.inserted > 1 ? "s" : ""} ajoutée{state.inserted > 1 ? "s" : ""}
          {state.skipped > 0 ? `, ${state.skipped} doublon${state.skipped > 1 ? "s" : ""} ignoré${state.skipped > 1 ? "s" : ""}` : ""}.
        </span>
        <button onClick={reset} className="ml-auto text-emerald-600 hover:text-emerald-800">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm">
        <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
        <span className="text-rose-800">{state.message}</span>
        <button onClick={reset} className="ml-auto text-rose-500 hover:text-rose-700">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (state.phase === "needs_account" || state.phase === "saving") {
    const isSaving = state.phase === "saving";
    const errorMsg = state.phase === "needs_account" ? state.error : undefined;
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm space-y-3">
        <div className="flex items-center gap-2 text-amber-800 font-medium">
          <Upload className="h-4 w-4" />
          <span>{state.file.name}</span>
          <button onClick={reset} className="ml-auto text-amber-500 hover:text-amber-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        {errorMsg && <p className="text-rose-700 text-xs">{errorMsg}</p>}
        <div className="flex items-center gap-2">
          <select
            className="flex-1 rounded border border-amber-300 bg-white px-2 py-1.5 text-xs text-slate-700"
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            disabled={isSaving}
          >
            <option value="">Sélectionne un compte…</option>
            {accounts.map((a) => (
              <option key={a.accountKey} value={a.accountKey}>
                {a.owner ? `${a.owner} — ` : ""}{a.label}
              </option>
            ))}
          </select>
          <button
            onClick={save}
            disabled={!selectedAccount || isSaving}
            className="flex items-center gap-1.5 rounded bg-slate-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Importer
          </button>
        </div>
      </div>
    );
  }

  const isDragging = state.phase === "dragging";
  const isValidating = state.phase === "validating";

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setState({ phase: "dragging" }); }}
      onDragLeave={() => setState({ phase: "idle" })}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 text-sm transition-colors ${
        isDragging
          ? "border-slate-400 bg-slate-100"
          : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100"
      }`}
    >
      <input ref={inputRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={onFileChange} />
      {isValidating ? (
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      ) : (
        <Upload className="h-4 w-4 shrink-0 text-slate-400" />
      )}
      <span className="text-slate-500">
        {isValidating ? "Validation…" : isDragging ? "Dépose le fichier ici" : "Dépose ou clique pour importer un fichier Historique"}
      </span>
    </div>
  );
}
