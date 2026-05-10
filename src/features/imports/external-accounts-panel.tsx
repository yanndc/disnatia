"use client";

import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EXTERNAL_ACCOUNT_PROVIDERS,
  externalProviderPreset,
} from "@/lib/portfolio/external-account-providers";
import { formatCurrency } from "@/lib/utils";
import { readMetaString } from "@/lib/portfolio/external-account-metadata";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";

export type ExternalAccountDto = {
  id: string;
  accountKey: string;
  provider: string;
  displayLabel: string;
  owner: string | null;
  currency: string;
  portalUrl: string | null;
  metadata: unknown;
  snapshotCount: number;
  latestSnapshot: { asOfDate: string; totalValue: number } | null;
};

const numNonNeg = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? 0 : Number(v)),
  z.number().finite().nonnegative(),
);

const createFormSchema = z.object({
  provider: z.enum(["desjardins_erc_reer_collectif", "other"]),
  displayLabel: z.string().min(1, "Nom requis").max(240),
  currency: z.enum(["CAD", "USD"]),
  portalUrl: z.string().optional(),
  sourceSummary: z.string().max(4000).optional(),
  transactionUpdateInstructions: z.string().max(8000).optional(),
  owner: z.string().max(200).optional(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date AAAA-MM-JJ"),
  totalValue: numNonNeg,
  notes: z.string().max(2000).optional(),
});

type CreateForm = z.infer<typeof createFormSchema>;

const snapshotFormSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalValue: numNonNeg,
  notes: z.string().max(2000).optional(),
});

type SnapshotForm = z.infer<typeof snapshotFormSchema>;

export function ExternalAccountsPanel({
  initialAccounts,
}: {
  initialAccounts: ExternalAccountDto[];
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const createForm = useForm<CreateForm>({
    resolver: zodResolver(createFormSchema) as Resolver<CreateForm>,
    defaultValues: {
      provider: "desjardins_erc_reer_collectif",
      displayLabel: "REER collectif — Desjardins / portail ERC",
      currency: "CAD",
      portalUrl: "https://www.erc-grs.dsf-dfs.com/",
      sourceSummary:
        "Régime enregistré d'épargne-retraite — Répartition de l'actif - Croissance | Directives de placement - Audacieux",
      asOfDate: new Date().toISOString().slice(0, 10),
      totalValue: 0,
      notes: "",
      transactionUpdateInstructions: "",
      owner: "",
    },
  });

  async function refreshAccounts() {
    try {
      const r = await fetch("/api/external-accounts");
      const data = (await r.json()) as { accounts?: ExternalAccountDto[] };
      if (data.accounts) setAccounts(data.accounts);
    } catch {
      /* ignore */
    }
  }

  async function onCreate(values: CreateForm) {
    setGlobalMessage(null);
    const preset = externalProviderPreset(values.provider);
    const portalUrl =
      values.portalUrl?.trim() ||
      preset?.defaultPortalUrl ||
      undefined;
    const res = await fetch("/api/external-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: values.provider,
        displayLabel: values.displayLabel.trim(),
        currency: values.currency,
        portalUrl: portalUrl || null,
        sourceSummary: values.sourceSummary?.trim() || null,
        transactionUpdateInstructions:
          values.transactionUpdateInstructions?.trim() || null,
        owner: values.owner?.trim() || null,
        initialSnapshot: {
          asOfDate: values.asOfDate,
          totalValue: values.totalValue,
          notes: values.notes?.trim() || null,
        },
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setGlobalMessage(
        typeof payload.error === "string" ? payload.error : "Création impossible.",
      );
      return;
    }
    setGlobalMessage(
      "Compte externe ajouté. Tu peux compléter l’historique avec de nouveaux snapshots.",
    );
    await refreshAccounts();
  }

  async function onDelete(id: string) {
    setDeletingId(id);
    setGlobalMessage(null);
    try {
      const res = await fetch(`/api/external-accounts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setGlobalMessage("Suppression impossible.");
        return;
      }
      await refreshAccounts();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card className="border-violet-200/80 bg-violet-50/30">
      <CardHeader>
        <CardTitle className="text-base text-slate-900">
          Comptes hors Disnat (snapshots manuels)
        </CardTitle>
        <p className="text-sm text-slate-600">
          Les assureurs et portails employeur n’offrent généralement pas d’API ouverte. Enregistre ici la
          valeur totale indiquée sur le site (ex. solde du REER collectif) avec la date du relevé — tu
          pourras suivre l’évolution en ajoutant des snapshots réguliers.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {globalMessage ? (
          <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
            {globalMessage}
          </p>
        ) : null}

        {accounts.length > 0 ? (
          <ul className="space-y-3 text-sm">
            {accounts.map((acc) => (
              <li
                key={acc.id}
                className="rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm"
              >
                <ExternalAccountCardBody
                  acc={acc}
                  deletingId={deletingId}
                  onDelete={onDelete}
                  onAccountsChanged={refreshAccounts}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Aucun compte externe pour l’instant.</p>
        )}

        <div className="rounded-xl border border-dashed border-violet-300 bg-white/80 p-4">
          <p className="mb-3 text-sm font-medium text-slate-800">Ajouter un compte</p>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={createForm.handleSubmit((v) => void onCreate(v))}
          >
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">Institution</span>
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                {...createForm.register("provider", {
                  onChange: (e) => {
                    const v = e.target.value as CreateForm["provider"];
                    const p = externalProviderPreset(v);
                    if (p?.defaultPortalUrl) {
                      createForm.setValue("portalUrl", p.defaultPortalUrl);
                    }
                  },
                })}
              >
                {EXTERNAL_ACCOUNT_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">Libellé affiché</span>
              <input
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                {...createForm.register("displayLabel")}
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Propriétaire (optionnel, pour le tableau de bord par personne)
              </span>
              <input
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                placeholder="ex. YANN DE CHAMPLAIN"
                {...createForm.register("owner")}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Devise</span>
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                {...createForm.register("currency")}
              >
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">URL du portail</span>
              <input
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                placeholder="https://…"
                {...createForm.register("portalUrl")}
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Profil / répartition (copier-coller du site, optionnel)
              </span>
              <textarea
                rows={2}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                {...createForm.register("sourceSummary")}
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Comment retrouver transactions / solde sur le site (optionnel, modifiable plus tard)
              </span>
              <textarea
                rows={3}
                placeholder="Ex. : Connexion → REER → Historique des transactions → filtre dernière paie…"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                {...createForm.register("transactionUpdateInstructions")}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Date du relevé</span>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                {...createForm.register("asOfDate")}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Valeur totale</span>
              <input
                type="number"
                step="0.01"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                {...createForm.register("totalValue")}
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">Notes (optionnel)</span>
              <input
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                {...createForm.register("notes")}
              />
            </label>
            {createForm.formState.errors.asOfDate ? (
              <p className="sm:col-span-2 text-sm text-red-600">
                {createForm.formState.errors.asOfDate.message}
              </p>
            ) : null}
            <div className="sm:col-span-2">
              <Button type="submit">Créer le compte et le premier snapshot</Button>
            </div>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

const editFormSchema = z.object({
  displayLabel: z.string().min(1).max(240),
  owner: z.string().max(200),
  currency: z.enum(["CAD", "USD"]),
  portalUrl: z
    .string()
    .max(2048)
    .refine(
      (s) => {
        const t = s.trim();
        if (t === "") return true;
        try {
          new URL(t);
          return true;
        } catch {
          return false;
        }
      },
      { message: "URL invalide (ex. https://…)" },
    ),
  sourceSummary: z.string().max(4000),
  transactionUpdateInstructions: z.string().max(8000),
});

type EditForm = z.infer<typeof editFormSchema>;

function editDefaults(acc: ExternalAccountDto): EditForm {
  return {
    displayLabel: acc.displayLabel,
    owner: acc.owner ?? "",
    currency: acc.currency === "USD" ? "USD" : "CAD",
    portalUrl: acc.portalUrl ?? "",
    sourceSummary: readMetaString(acc.metadata, "sourceSummary"),
    transactionUpdateInstructions: readMetaString(
      acc.metadata,
      "transactionUpdateInstructions",
    ),
  };
}

function ExternalAccountCardBody({
  acc,
  deletingId,
  onDelete,
  onAccountsChanged,
}: {
  acc: ExternalAccountDto;
  deletingId: string | null;
  onDelete: (id: string) => void;
  onAccountsChanged: () => void | Promise<void>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const editForm = useForm<EditForm>({
    resolver: zodResolver(editFormSchema) as Resolver<EditForm>,
    defaultValues: editDefaults(acc),
  });

  useEffect(() => {
    editForm.reset(editDefaults(acc));
  }, [acc, editForm]);

  async function onSaveEdit(values: EditForm) {
    editForm.clearErrors("root");
    const portalTrim = values.portalUrl.trim();
    const res = await fetch(`/api/external-accounts/${acc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayLabel: values.displayLabel.trim(),
        owner: values.owner.trim() === "" ? null : values.owner.trim(),
        currency: values.currency,
        portalUrl: portalTrim === "" ? null : portalTrim,
        sourceSummary: values.sourceSummary.trim() === "" ? null : values.sourceSummary.trim(),
        transactionUpdateInstructions:
          values.transactionUpdateInstructions.trim() === ""
            ? null
            : values.transactionUpdateInstructions.trim(),
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      editForm.setError("root", {
        message: typeof payload.error === "string" ? payload.error : "Échec de la sauvegarde.",
      });
      return;
    }
    setEditOpen(false);
    await onAccountsChanged();
  }

  const summary = readMetaString(acc.metadata, "sourceSummary");
  const instructions = readMetaString(acc.metadata, "transactionUpdateInstructions");

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">{acc.displayLabel}</p>
          <p className="text-xs text-slate-500">
            {EXTERNAL_ACCOUNT_PROVIDERS.find((p) => p.id === acc.provider)?.label ??
              acc.provider}{" "}
            · {acc.currency}
            {acc.owner ? (
              <>
                {" "}
                ·{" "}
                <span className="font-medium text-slate-700">
                  {sanitizePortfolioOwner(acc.owner) ?? acc.owner}
                </span>
              </>
            ) : (
              <> · Propriétaire : non renseigné</>
            )}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-400">{acc.accountKey}</p>
        </div>
        <div className="text-right">
          {acc.latestSnapshot ? (
            <>
              <p className="tabular-nums font-semibold text-slate-900">
                {formatCurrency(acc.latestSnapshot.totalValue, acc.currency)}
              </p>
              <p className="text-xs text-slate-500">
                au {acc.latestSnapshot.asOfDate} · {acc.snapshotCount} snapshot
                {acc.snapshotCount > 1 ? "s" : ""}
              </p>
            </>
          ) : (
            <p className="text-amber-700">Aucun snapshot</p>
          )}
        </div>
      </div>
      {acc.portalUrl ? (
        <a
          href={acc.portalUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-violet-700 underline-offset-2 hover:underline"
        >
          Ouvrir l’espace participant
        </a>
      ) : null}
      {summary ? <p className="mt-2 text-xs text-slate-600">{summary}</p> : null}
      {instructions ? (
        <div className="mt-2 rounded-md border border-sky-100 bg-sky-50/90 px-2 py-2 text-xs text-slate-800">
          <p className="font-medium text-sky-950">Mettre à jour depuis le portail</p>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">{instructions}</p>
        </div>
      ) : null}

      <button
        type="button"
        className="mt-2 text-xs font-medium text-violet-800 underline-offset-2 hover:underline"
        onClick={() => {
          setEditOpen((o) => !o);
          editForm.reset(editDefaults(acc));
        }}
      >
        {editOpen ? "Fermer l’édition" : "Modifier les détails du compte"}
      </button>

      {editOpen ? (
        <form
          className="mt-3 grid gap-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3 sm:grid-cols-2"
          onSubmit={editForm.handleSubmit((v) => void onSaveEdit(v))}
        >
          <label className="sm:col-span-2">
            <span className="mb-0.5 block text-xs font-medium text-slate-600">Libellé</span>
            <input
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              {...editForm.register("displayLabel")}
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-0.5 block text-xs font-medium text-slate-600">
              Propriétaire (tableau de bord par personne)
            </span>
            <input
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              placeholder="Identique au nom dans tes imports Disnat si tu veux fusionner les totaux"
              {...editForm.register("owner")}
            />
          </label>
          <label>
            <span className="mb-0.5 block text-xs font-medium text-slate-600">Devise</span>
            <select
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              {...editForm.register("currency")}
            >
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label className="sm:col-span-2">
            <span className="mb-0.5 block text-xs font-medium text-slate-600">
              URL (espace participant ou page utile)
            </span>
            <input
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              placeholder="https://…"
              {...editForm.register("portalUrl")}
            />
            {editForm.formState.errors.portalUrl ? (
              <p className="mt-1 text-xs text-red-600">{editForm.formState.errors.portalUrl.message}</p>
            ) : null}
          </label>
          <label className="sm:col-span-2">
            <span className="mb-0.5 block text-xs font-medium text-slate-600">
              Profil / répartition (optionnel)
            </span>
            <textarea
              rows={2}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              {...editForm.register("sourceSummary")}
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-0.5 block text-xs font-medium text-slate-600">
              Instructions pour retrouver transactions ou solde à jour
            </span>
            <textarea
              rows={4}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              placeholder="Étapes dans le site, onglets, libellés à chercher…"
              {...editForm.register("transactionUpdateInstructions")}
            />
          </label>
          {editForm.formState.errors.root ? (
            <p className="sm:col-span-2 text-xs text-red-600">
              {editForm.formState.errors.root.message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" className="h-9">
              Enregistrer
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              onClick={() => {
                setEditOpen(false);
                editForm.reset(editDefaults(acc));
              }}
            >
              Annuler
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-3 border-t border-slate-100 pt-3">
        <SnapshotInlineForm accountId={acc.id} currency={acc.currency} onSaved={onAccountsChanged} />
      </div>
      <Button
        type="button"
        variant="secondary"
        className="mt-3 h-9 text-red-700"
        disabled={deletingId === acc.id}
        onClick={() => void onDelete(acc.id)}
      >
        {deletingId === acc.id ? "Suppression..." : "Supprimer ce compte"}
      </Button>
    </>
  );
}

function SnapshotInlineForm({
  accountId,
  currency,
  onSaved,
}: {
  accountId: string;
  currency: string;
  onSaved: () => void | Promise<void>;
}) {
  const form = useForm<SnapshotForm>({
    resolver: zodResolver(snapshotFormSchema) as Resolver<SnapshotForm>,
    defaultValues: {
      asOfDate: new Date().toISOString().slice(0, 10),
      totalValue: 0,
      notes: "",
    },
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(values: SnapshotForm) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/external-accounts/${accountId}/snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asOfDate: values.asOfDate,
          totalValue: values.totalValue,
          notes: values.notes?.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(typeof payload.error === "string" ? payload.error : "Échec.");
        return;
      }
      setMsg("Snapshot enregistré.");
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-2 text-xs" onSubmit={form.handleSubmit(submit)}>
      <label>
        <span className="mb-0.5 block text-slate-500">Date</span>
        <input
          type="date"
          className="rounded border border-slate-300 px-2 py-1"
          {...form.register("asOfDate")}
        />
      </label>
      <label>
        <span className="mb-0.5 block text-slate-500">Valeur</span>
        <input
          type="number"
          step="0.01"
          className="w-28 rounded border border-slate-300 px-2 py-1"
          {...form.register("totalValue")}
        />
      </label>
      <label className="min-w-[8rem] flex-1">
        <span className="mb-0.5 block text-slate-500">Note</span>
        <input className="w-full rounded border border-slate-300 px-2 py-1" {...form.register("notes")} />
      </label>
      <Button type="submit" className="h-8 px-3 text-xs" variant="secondary" disabled={busy}>
        {busy ? "…" : "Ajouter"}
      </Button>
      <span className="text-slate-500">{currency}</span>
      {msg ? <span className="text-slate-700">{msg}</span> : null}
    </form>
  );
}
