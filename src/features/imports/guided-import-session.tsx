"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  buildPortfolioSnapshot,
  parseDisnatCsv,
  validateDisnatInvestmentExportFile,
} from "@/lib/csv/disnat";
import { importFileToParseText } from "@/lib/csv/import-file-text";
import {
  attributionFactsFromSnapshot,
  bestAttributionSuggestion,
  fileAttributionSignature,
  suggestAccountAttribution,
  type AttributionAccount,
  type AttributionSuggestion,
} from "@/lib/csv/account-attribution";
import type {
  ImportSessionAccount,
  ImportSessionPayload,
} from "@/features/portfolio/import-session-types";
import {
  groupAccountsByOwnerLikeDisnat,
  sortAccountsLikeDisnat,
} from "@/features/portfolio/disnat-account-order";
import { cn } from "@/lib/utils";

type Step = "accounts" | "files" | "review" | "done";

type QueuedFile = {
  id: string;
  fileName: string;
  file: File;
  signature: string;
  txCount: number;
  fromIso: string | null;
  toIso: string | null;
  tickers: string[];
  suggestions: AttributionSuggestion[];
  accountKey: string;
  error?: string;
};

type ImportReportRow = {
  fileName: string;
  accountLabel: string;
  ok: boolean;
  inserted: number;
  skipped: number;
  message?: string;
};

const CONFIDENCE_LABEL: Record<AttributionSuggestion["confidence"], string> = {
  EXACTE: "Attribution exacte",
  PROBABLE: "Attribution probable",
  AMBIGUE: "Ambigu — à confirmer",
  AUCUNE: "Aucun signal",
};

function formatIso(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("fr-CA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 0 }).format(value);
}

function accountLabel(account: ImportSessionAccount): string {
  const type = account.accountType ?? account.accountName;
  const number = account.accountNumber ? ` ${account.accountNumber}` : "";
  const owner = account.owner ? `${account.owner} · ` : "";
  return `${owner}${type}${number} (${account.currency})`;
}

function toAttributionAccount(account: ImportSessionAccount): AttributionAccount {
  return {
    accountKey: account.accountKey,
    label: account.accountName,
    accountName: account.accountName,
    accountNumber: account.accountNumber,
    accountType: account.accountType,
    owner: account.owner,
    currency: account.currency,
    holdings: account.holdings,
  };
}

function statusBadgeClass(status: ImportSessionAccount["coverage"]["status"]): string {
  if (status === "A_JOUR") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (status === "A_CONFIRMER") return "bg-amber-50 text-amber-700 ring-amber-100";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function statusLabel(status: ImportSessionAccount["coverage"]["status"]): string {
  if (status === "A_JOUR") return "À jour";
  if (status === "A_CONFIRMER") return "À confirmer";
  return "Sans données";
}

/**
 * Session d'import guidée.
 *
 * Déroulé : **1. état des comptes** (dont l'attestation « rien n'a changé » pour les comptes
 * dormants) → **2. dépôt des fichiers** avec attribution proposée → **3. récap** →
 * **4. import séquentiel** avec rapport par fichier. Rien n'est écrit avant l'étape 4.
 */
export function GuidedImportSession() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<ImportSessionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("accounts");
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [parseBusy, setParseBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [report, setReport] = useState<ImportReportRow[]>([]);

  const applySession = useCallback((payload: ImportSessionPayload) => {
    setSession(payload);
  }, []);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/portfolio/import-session");
      if (!response.ok) throw new Error(`Erreur ${response.status}`);
      applySession((await response.json()) as ImportSessionPayload);
    } catch (cause) {
      setLoadError(
        cause instanceof Error ? cause.message : "Impossible de charger la session.",
      );
    } finally {
      setLoading(false);
    }
  }, [applySession]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/portfolio/import-session")
      .then((response) => {
        if (!response.ok) throw new Error(`Erreur ${response.status}`);
        return response.json() as Promise<ImportSessionPayload>;
      })
      .then((payload) => {
        if (!cancelled) applySession(payload);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(
            cause instanceof Error ? cause.message : "Impossible de charger la session.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const accountsByKey = useMemo(() => {
    const map = new Map<string, ImportSessionAccount>();
    for (const account of session?.accounts ?? []) map.set(account.accountKey, account);
    return map;
  }, [session]);

  /** Comptes groupés par propriétaire, dans l'ordre de l'export Disnat. */
  const accountGroups = useMemo(
    () => groupAccountsByOwnerLikeDisnat(sortAccountsLikeDisnat(session?.accounts ?? [])),
    [session],
  );

  const usableFiles = queue.filter((item) => !item.error);
  const missingAccount = usableFiles.filter((item) => !item.accountKey);
  const canImport = usableFiles.length > 0 && missingAccount.length === 0 && !importBusy;

  /** Atteste « rien n'a changé » pour un seul compte (aucun montant n'est écrit). */
  async function confirmAccount(accountKey: string) {
    if (!session) return;
    setConfirmingKey(accountKey);
    setConfirmMessage(null);
    try {
      const response = await fetch("/api/portfolio/import-session/confirmations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountKeys: [accountKey],
          dataAsOf: session.expectedSessionIso,
          note: "Confirmation depuis la session guidée : aucune transaction sur la période.",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        dataAsOf?: string;
        confirmations?: unknown[];
      };
      if (!response.ok) {
        setConfirmMessage(payload.error ?? `Erreur ${response.status}`);
        return;
      }
      setConfirmMessage(
        `Compte attesté comme inchangé jusqu'au ${formatIso(payload.dataAsOf ?? session.expectedSessionIso)}.`,
      );
      await loadSession();
      router.refresh();
    } catch {
      setConfirmMessage("Erreur réseau lors de la confirmation.");
    } finally {
      setConfirmingKey(null);
    }
  }

  async function handleFiles(files: File[]) {
    if (!session || files.length === 0) return;
    setParseBusy(true);
    const attributionAccounts = session.accounts.map(toAttributionAccount);
    const ruleBySignature = new Map(
      session.attributionRules.map((rule) => [rule.signature, rule.accountKey]),
    );
    const parsedFiles: QueuedFile[] = [];

    for (const file of files) {
      const base: QueuedFile = {
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        fileName: file.name,
        file,
        signature: "",
        txCount: 0,
        fromIso: null,
        toIso: null,
        tickers: [],
        suggestions: [],
        accountKey: "",
      };

      try {
        const text = await importFileToParseText(file);
        const parsed = parseDisnatCsv(text);
        const gate = validateDisnatInvestmentExportFile({
          rawText: text,
          headers: parsed.headers,
          importKind: parsed.importKind,
        });
        if (!gate.ok) {
          parsedFiles.push({ ...base, error: gate.message });
          continue;
        }

        const snapshot = buildPortfolioSnapshot(parsed.rows, parsed.ownerMap);
        if (snapshot.transactions.length === 0) {
          parsedFiles.push({
            ...base,
            error: "Ce fichier ne contient aucune transaction (export portefeuille ?).",
          });
          continue;
        }

        const signature = fileAttributionSignature(file.name, parsed.headers);
        const facts = attributionFactsFromSnapshot(file.name, snapshot, parsed.headers);
        const suggestions = suggestAccountAttribution(facts, attributionAccounts, {
          rememberedAccountKey: ruleBySignature.get(signature) ?? null,
        });
        const best = bestAttributionSuggestion(suggestions);
        const dates = snapshot.transactions
          .map((transaction) => transaction.tradeDate)
          .filter((date): date is Date => date instanceof Date)
          .map((date) => date.toISOString().slice(0, 10))
          .toSorted();

        parsedFiles.push({
          ...base,
          signature,
          txCount: snapshot.transactions.length,
          fromIso: dates[0] ?? null,
          toIso: dates.at(-1) ?? null,
          tickers: [
            ...new Set(
              snapshot.transactions
                .map((transaction) => transaction.ticker)
                .filter((ticker): ticker is string => Boolean(ticker)),
            ),
          ],
          suggestions,
          accountKey: best && best.confidence !== "AMBIGUE" ? best.accountKey : "",
        });
      } catch (cause) {
        parsedFiles.push({
          ...base,
          error: cause instanceof Error ? cause.message : "Fichier illisible.",
        });
      }
    }

    setQueue((previous) => [...previous, ...parsedFiles]);
    setParseBusy(false);
  }

  function onInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void handleFiles(files);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void handleFiles(Array.from(event.dataTransfer.files ?? []));
  }

  function setAccountForFile(id: string, accountKey: string) {
    setQueue((previous) =>
      previous.map((item) => (item.id === id ? { ...item, accountKey } : item)),
    );
  }

  function removeFile(id: string) {
    setQueue((previous) => previous.filter((item) => item.id !== id));
  }

  async function runImport() {
    if (!canImport) return;
    setImportBusy(true);
    setReport([]);
    const rows: ImportReportRow[] = [];

    for (const item of usableFiles) {
      const account = accountsByKey.get(item.accountKey);
      const label = account ? accountLabel(account) : item.accountKey;
      const formData = new FormData();
      formData.append("file", item.file);
      formData.append("accountKey", item.accountKey);
      if (account) formData.append("accountLabel", account.accountName);

      try {
        const response = await fetch("/api/imports", { method: "POST", body: formData });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          txInserted?: number;
          txSkipped?: number;
        };
        if (!response.ok) {
          rows.push({
            fileName: item.fileName,
            accountLabel: label,
            ok: false,
            inserted: 0,
            skipped: 0,
            message: payload.error ?? `Erreur ${response.status}`,
          });
          setReport([...rows]);
          continue;
        }

        rows.push({
          fileName: item.fileName,
          accountLabel: label,
          ok: true,
          inserted: payload.txInserted ?? 0,
          skipped: payload.txSkipped ?? 0,
        });
        setReport([...rows]);

        if (item.signature && item.accountKey) {
          await fetch("/api/portfolio/import-session/attribution", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              signature: item.signature,
              accountKey: item.accountKey,
              sampleFileName: item.fileName,
            }),
          }).catch(() => {});
        }
      } catch {
        rows.push({
          fileName: item.fileName,
          accountLabel: label,
          ok: false,
          inserted: 0,
          skipped: 0,
          message: "Erreur réseau.",
        });
        setReport([...rows]);
      }
    }

    setImportBusy(false);
    setQueue([]);
    setStep("done");
    await loadSession();
    router.refresh();
  }

  if (loading && !session) {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500 shadow-sm">
        <Loader2 className="size-4 animate-spin" />
        Chargement de l&apos;état des comptes…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-6 text-sm text-rose-700 shadow-sm">
        <CircleAlert className="size-4" />
        {loadError ?? "Session indisponible."}
        <button
          type="button"
          onClick={() => void loadSession()}
          className="ml-auto rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200"
        >
          Réessayer
        </button>
      </div>
    );
  }

  const steps: { id: Step; label: string }[] = [
    { id: "accounts", label: "1. Comptes" },
    { id: "files", label: "2. Fichiers" },
    { id: "review", label: "3. Récap & import" },
    { id: "done", label: "4. Rapport" },
  ];

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-4xl border border-slate-200 bg-white text-slate-950 shadow-sm">
        <div className="relative isolate p-6 sm:p-8">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.08),transparent_34%)]" />
          <div className="flex items-start gap-3">
            <div className="mt-1 flex size-10 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
              <ShieldCheck className="size-5" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Session d&apos;import guidée
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-500">
                Un seul passage : vérifier les comptes (ou attester « rien n&apos;a
                changé »), déposer les fichiers, valider l&apos;attribution, importer.
                Aucune écriture avant l&apos;étape 3.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {session.summary.transactionCount} transactions en base ·{" "}
                {formatIso(session.summary.transactionFrom)} →{" "}
                {formatIso(session.summary.transactionTo)} · journée du{" "}
                {formatIso(session.todayIso)}
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            {steps.map((item) => (
              <span
                key={item.id}
                className={cn(
                  "rounded-full px-3 py-1 font-medium ring-1",
                  step === item.id
                    ? "bg-slate-950 text-white ring-slate-950"
                    : "bg-slate-50 text-slate-500 ring-slate-200",
                )}
              >
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {step === "accounts" ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">État des comptes</h3>
              <p className="mt-1 text-xs text-slate-500">
                {session.summary.toConfirm} à confirmer · {session.summary.upToDate} à
                jour · {session.summary.withoutData} sans données. Dernière séance
                attendue : {formatIso(session.expectedSessionIso)}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStep("files")}
                className="flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Déposer les fichiers
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          </div>

          {confirmMessage ? (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {confirmMessage}
            </p>
          ) : null}

          <div className="mt-1 text-[11px] text-slate-400">
            Un compte dormant (aucune opération) : clique « Rien n&apos;a changé » sur sa ligne.
            Aucun montant n&apos;est écrit.
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-2 font-medium">Compte</th>
                  <th className="py-2 font-medium">Solde</th>
                  <th className="py-2 font-medium">Dernier import</th>
                  <th className="py-2 font-medium">Dernière opération</th>
                  <th className="py-2 font-medium">Attestation</th>
                  <th className="py-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accountGroups.map((group) => (
                  <Fragment key={group.owner ?? "__sans_proprietaire"}>
                    <tr className="bg-slate-50/80">
                      <td colSpan={6} className="px-2 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          <span>{group.owner ?? "Sans propriétaire"}</span>
                          <span className="font-medium normal-case tabular-nums text-slate-500">
                            {formatMoney(group.totalValue)} $
                          </span>
                        </div>
                      </td>
                    </tr>
                    {group.accounts.map((account) => {
                      return (
                        <tr key={account.accountKey} className="align-top">
                          <td className="py-2">
                            <div className="font-medium text-slate-800">
                              {account.accountType ?? account.accountName}
                            </div>
                            <div className="font-mono text-[10px] text-slate-400">
                              {account.accountNumber ?? account.accountKey}
                            </div>
                          </td>
                          <td className="py-2 tabular-nums text-slate-600">
                            <span className="mr-1 text-[10px] uppercase text-slate-400">
                              {account.currency}
                            </span>
                            {formatMoney(account.totalValue)} $
                            <div className="text-[10px] font-normal text-slate-400">
                              relevé {formatIso(account.snapshotAsOf)}
                            </div>
                          </td>
                      <td className="py-2 text-slate-600">
                        {formatIso(account.snapshotAsOf)}
                      </td>
                      <td className="py-2 text-slate-600">
                        {formatIso(account.lastTransactionDate)}
                      </td>
                      <td className="py-2 text-slate-600">
                        {formatIso(account.lastConfirmationDataAsOf)}
                      </td>
                      <td className="py-2">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 font-medium ring-1",
                            statusBadgeClass(account.coverage.status),
                          )}
                        >
                          {statusLabel(account.coverage.status)}
                        </span>
                        {account.coverage.staleTradingDays > 0 ? (
                          <span className="ml-1 text-slate-400">
                            {account.coverage.staleTradingDays} séance(s)
                          </span>
                        ) : null}
                        {account.coverage.freshnessSource === "SNAPSHOT_CLIENT" &&
                        account.coverage.freshnessIso ? (
                          <div className="text-[10px] text-slate-400">
                            capture client {formatIso(account.coverage.freshnessIso)}
                          </div>
                        ) : null}
                        <div className="mt-1">
                          <button
                            type="button"
                            onClick={() => void confirmAccount(account.accountKey)}
                            disabled={confirmingKey === account.accountKey}
                            title="Attester qu'aucune transaction n'a eu lieu sur ce compte (aucun montant n'est écrit)"
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium disabled:opacity-50",
                              account.coverage.requiresConfirmation
                                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                            )}
                          >
                            {confirmingKey === account.accountKey ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="size-3" />
                            )}
                            Rien n&apos;a changé
                          </button>
                        </div>
                      </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {step === "files" ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Dépôt des historiques
              </h3>
              <p className="mt-1 max-w-2xl text-xs text-slate-500">
                Dépose tous les fichiers de la période d&apos;un coup (CSV ou Excel). Le
                compte est proposé automatiquement ; un nom de fichier contenant le
                numéro de compte ou le type (CELI, REER…) rend l&apos;attribution exacte.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep("review")}
              disabled={usableFiles.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
            >
              Récap ({usableFiles.length})
              <ArrowRight className="size-3.5" />
            </button>
          </div>

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500 hover:border-slate-300 hover:bg-slate-100"
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={onInputChange}
            />
            {parseBusy ? (
              <Loader2 className="size-4 animate-spin text-slate-400" />
            ) : (
              <Upload className="size-4 text-slate-400" />
            )}
            {parseBusy
              ? "Lecture des fichiers…"
              : "Dépose plusieurs fichiers ici, ou clique pour les sélectionner"}
          </div>

          {queue.length === 0 ? (
            <p className="mt-4 rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
              Aucun fichier en attente.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {queue.map((item) => {
                const selected = item.suggestions.find(
                  (suggestion) => suggestion.accountKey === item.accountKey,
                );
                const best = selected ?? item.suggestions[0];
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "rounded-2xl border px-3 py-3 text-xs",
                      item.error
                        ? "border-rose-200 bg-rose-50"
                        : item.accountKey
                          ? "border-slate-200 bg-white"
                          : "border-amber-200 bg-amber-50",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <FileSpreadsheet className="size-3.5 text-slate-400" />
                      <span className="font-medium text-slate-800">{item.fileName}</span>
                      {item.error ? (
                        <span className="text-rose-700">{item.error}</span>
                      ) : (
                        <span className="text-slate-500">
                          {item.txCount} transaction(s) · {formatIso(item.fromIso)} →{" "}
                          {formatIso(item.toIso)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeFile(item.id)}
                        className="ml-auto rounded px-2 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        Retirer
                      </button>
                    </div>

                    {item.error ? null : (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select
                          value={item.accountKey}
                          onChange={(event) =>
                            setAccountForFile(item.id, event.target.value)
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
                          aria-label={`Compte pour ${item.fileName}`}
                        >
                          <option value="">Choisir un compte…</option>
                          {session.accounts.map((account) => (
                            <option key={account.accountKey} value={account.accountKey}>
                              {accountLabel(account)}
                            </option>
                          ))}
                        </select>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 font-medium ring-1",
                            best?.confidence === "EXACTE"
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                              : best?.confidence === "PROBABLE"
                                ? "bg-cyan-50 text-cyan-700 ring-cyan-100"
                                : "bg-amber-50 text-amber-700 ring-amber-100",
                          )}
                        >
                          {CONFIDENCE_LABEL[best?.confidence ?? "AUCUNE"]}
                        </span>
                        <span className="text-slate-500">
                          {best?.reasons.length
                            ? best.reasons.join(" · ")
                            : "Aucun signal : choisis le compte manuellement."}
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {step === "review" ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Récap avant import
              </h3>
              <p className="mt-1 max-w-2xl text-xs text-slate-500">
                Vérifie l&apos;attribution fichier → compte. Les transactions déjà en base
                sont ignorées (empreinte compte + opération), donc réimporter une période
                plus large est sans danger.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStep("files")}
                disabled={importBusy}
                className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-40"
              >
                ← Fichiers
              </button>
              <button
                type="button"
                onClick={() => void runImport()}
                disabled={!canImport}
                className="flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
              >
                {importBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                Importer {usableFiles.length} fichier(s)
              </button>
            </div>
          </div>

          {missingAccount.length > 0 ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {missingAccount.length} fichier(s) sans compte : retourne à l&apos;étape 2
              pour les attribuer.
            </p>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-2 font-medium">Fichier</th>
                  <th className="py-2 font-medium">Compte</th>
                  <th className="py-2 font-medium">Période</th>
                  <th className="py-2 font-medium">Transactions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usableFiles.map((item) => {
                  const account = accountsByKey.get(item.accountKey);
                  return (
                    <tr key={item.id}>
                      <td className="py-2 font-medium text-slate-800">{item.fileName}</td>
                      <td className="py-2 text-slate-600">
                        {account ? (
                          accountLabel(account)
                        ) : (
                          <span className="text-amber-700">À attribuer</span>
                        )}
                      </td>
                      <td className="py-2 text-slate-600">
                        {formatIso(item.fromIso)} → {formatIso(item.toIso)}
                      </td>
                      <td className="py-2 text-slate-600">{item.txCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {importBusy ? (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Import en cours… {report.length}/{usableFiles.length} fichier(s) traité(s).
            </p>
          ) : null}
        </section>
      ) : null}

      {step === "done" ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-slate-900">Rapport d&apos;import</h3>
          <p className="mt-1 text-xs text-slate-500">
            {report.filter((row) => row.ok).length} fichier(s) importé(s) ·{" "}
            {report.reduce((total, row) => total + row.inserted, 0)} transaction(s)
            ajoutée(s) · {report.reduce((total, row) => total + row.skipped, 0)} doublon(s)
            ignoré(s). Les attributions retenues sont mémorisées pour la prochaine session.
          </p>

          <ul className="mt-4 space-y-1 text-xs">
            {report.map((row) => (
              <li
                key={`${row.fileName}-${row.accountLabel}`}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2",
                  row.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700",
                )}
              >
                {row.ok ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  <CircleAlert className="size-3.5" />
                )}
                <span className="font-medium">{row.fileName}</span>
                <span>→ {row.accountLabel}</span>
                <span className="ml-auto">
                  {row.ok
                    ? `${row.inserted} ajoutée(s), ${row.skipped} doublon(s)`
                    : row.message}
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => {
              setReport([]);
              setConfirmMessage(null);
              setStep("accounts");
            }}
            className="mt-4 rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Nouvelle session
          </button>
        </section>
      ) : null}
    </div>
  );
}
