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
import { describeDisnatPage } from "@/lib/csv/disnat-diagnostics";
import { parseDisnatSummaryHtml } from "@/lib/csv/disnat-summary";

type AccountImportResult = {
  label: string;
  status: "ok" | "duplicate" | "error";
  detail: string;
};

const MAX_HTML_CHARS = 8_000_000;

/** Échappe une valeur pour l'insérer dans un attribut HTML (href du favori). */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Import depuis la page Disnat sauvegardée (un bloc par compte, compte lu dans le HTML). */
export function DisnatHtmlPanel({
  bookmarkletHref,
}: {
  bookmarkletHref: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<DisnatHtmlParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<AccountImportResult[]>([]);
  const [copied, setCopied] = useState(false);
  /** Message d'appoint quand la page collée n'est pas un historique (vue d'ensemble, coquille vide…). */
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);

  async function copyBookmarklet() {
    if (!bookmarkletHref) return;
    try {
      await navigator.clipboard.writeText(bookmarkletHref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copie le code du favori :", bookmarkletHref);
    }
  }

  const analyze = useCallback((html: string) => {
    setText(html);
    setResults([]);
    const result = html.trim().length > 0 ? parseDisnatHistoryHtml(html) : null;
    setParsed(result);
    if (!result || result.ok) {
      setFallbackNote(null);
      return;
    }
    // Page sans historique : on dit ce qu'elle contient (vue d'ensemble lue ? coquille vide ?).
    const summary = parseDisnatSummaryHtml(html);
    const money = (value: number) =>
      value.toLocaleString("fr-CA", { style: "currency", currency: "CAD" });
    setFallbackNote(
      summary
        ? `Page « Vue d'ensemble » : encaisse ${money(summary.cashCad)}, titres ${money(
            summary.securitiesCad,
          )}, total ${money(
            summary.totalCad,
          )}. Pour l'enregistrer, clique le favori « Envoyer à DisnatIA » sur cette page Disnat.`
        : `Page non reconnue — ${describeDisnatPage(html).hint}.`,
    );
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
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-slate-500">
            <li>
              Ouvre{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-700">
                https://tmw.secure.vmd.ca/s9web/secure/portfolio/account?clientId=5KFZE
              </code>{" "}
              (niveau client, tous les comptes). Si l&apos;URL contient{" "}
              <code className="rounded bg-slate-100 px-1 text-[11px]">&amp;accountId=…</code>,
              supprime ce paramètre.
            </li>
            <li>
              Onglet <strong>Vue d&apos;ensemble → Historique</strong>, choisis la période
              (ex. 3 mois).
            </li>
            <li>
              <strong>Ctrl+S → « Page web, HTML seul »</strong>, puis dépose le fichier ci-dessous
              (ou colle son contenu).
            </li>
          </ol>
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-500">
            <strong>Lien qui ne fonctionne pas ?</strong> Passe par{" "}
            <em>Mes comptes → Vue d&apos;ensemble → Vue d&apos;ensemble</em> : l&apos;onglet
            « Vue d&apos;ensemble » est déjà sélectionné et l&apos;URL devient{" "}
            <code className="rounded bg-white px-1 text-[11px] text-slate-700">
              https://tmw.secure.vmd.ca/s9web/secure/portfolio/account?clientId=ALL&amp;accountId=ALL
            </code>
            .<br />
            Le numéro de compte est lu dans chaque bloc (<code className="text-[11px]">REER (5KFZEU3)</code>),
            donc aucune attribution à faire. Les comptes sans transaction sur la période sont
            simplement ignorés (à attester avec le bouton vert).
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
          {fallbackNote ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              {fallbackNote}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Favori : « Envoyer à DisnatIA »</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-slate-600">
          {bookmarkletHref ? (
            <>
              <p>
                Sur la page Disnat (onglet <strong>Historique</strong>), un clic sur le favori
                envoie la page à DisnatIA et l&apos;importe — sans fichier ni copier-coller. Sur la
                page <strong>Vue d&apos;ensemble</strong> d&apos;un client, il enregistre plutôt son
                encaisse officielle.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {/* React neutralise les href `javascript:` : on rend l'ancre brute pour que le
                    glisser-déposer capture bien le script. */}
                <span
                  draggable
                  className="inline-flex cursor-grab items-center gap-1.5 rounded-md bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  title="Glisse ce lien dans la barre de favoris"
                  dangerouslySetInnerHTML={{
                    __html: `<a href="${escapeHtmlAttr(bookmarkletHref)}" style="color:inherit;text-decoration:none">Envoyer à DisnatIA</a>`,
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={() => void copyBookmarklet()}
                  className="h-9 gap-1.5 text-xs"
                >
                  <ClipboardPaste className="size-3.5" />
                  {copied ? "Copié" : "Copier le code"}
                </Button>
                <span className="text-[11px] text-slate-500">
                  Glisse le bouton noir dans ta barre de favoris.
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Si le glisser ne marche pas : « Copier le code », puis <kbd>Ctrl+D</kbd> →{" "}
                <em>Modifier</em> → dans l&apos;URL du favori, tape <code>java</code> puis colle le
                reste (Chrome supprime <code>javascript:</code> au collage).
              </p>
              <ol className="list-decimal space-y-1 pl-4 text-[11px] text-slate-500">
                <li>Disnat → Mes comptes → Historique (la période voulue), puis clique le favori.</li>
                <li>DisnatIA importe chaque compte et affiche le récapitulatif dans une alerte.</li>
                <li>
                  Encaisse : Disnat → Vue d&apos;ensemble d&apos;un client précis (pas « Tous les
                  comptes »), puis clique le favori. À refaire depuis le favori de cette page
                  (l&apos;ancien lien n&apos;envoie pas l&apos;URL du client).
                </li>
              </ol>
              <p className="text-[11px] text-slate-400">
                Le jeton d&apos;import est intégré au lien : l&apos;app est mono-utilisateur derrière
                le verrou de site. Aucun identifiant Disnat n&apos;est stocké ni transmis.
              </p>
            </>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              Favori désactivé : ajoute <code>DISNAT_IMPORT_TOKEN</code> dans les variables
              d&apos;environnement (et <code>NEXT_PUBLIC_APP_URL</code> en production), puis
              redéploie.
            </p>
          )}
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
